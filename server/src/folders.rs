//! Bounded folder search for the directory picker.
//!
//! The picker used to walk subfolders from the browser, one `/file` request per
//! folder. On a remote host that meant dozens of round trips per keystroke. The
//! host walks the tree in one request instead, under hard limits so a huge home
//! directory cannot pin a worker.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;

/// Deepest folder level below the root that is searched.
const MAX_DEPTH: usize = 3;
/// Most folders read from disk in one search.
const MAX_DIRS: usize = 400;
/// Most matches returned; more sets `truncated`.
const MAX_RESULTS: usize = 60;
/// Wall-clock budget for one search.
const BUDGET: Duration = Duration::from_millis(1500);

/// Folders that are almost never a project root. Hidden folders are skipped separately.
const SKIP: &[&str] = &[
    "node_modules",
    "target",
    "build",
    "dist",
    "venv",
    "__pycache__",
    ".git",
];

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// Paths relative to the root, shallowest first.
    pub results: Vec<String>,
    /// True when a limit stopped the search before the tree was exhausted.
    pub truncated: bool,
}

pub fn search(root: &Path, query: &str) -> SearchResult {
    let needle = query.trim().to_lowercase();
    let mut out = SearchResult::default();
    if needle.is_empty() || !root.is_dir() {
        return out;
    }

    let started = Instant::now();
    let mut listed = 0usize;
    let mut queue: VecDeque<(PathBuf, String, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), String::new(), 0));

    while let Some((dir, relative, depth)) = queue.pop_front() {
        if listed >= MAX_DIRS || started.elapsed() > BUDGET {
            out.truncated = true;
            break;
        }
        listed += 1;

        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<_> = entries
            .flatten()
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .collect();
        children.sort_by_key(|entry| entry.file_name());

        for entry in children {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || SKIP.contains(&name.as_str()) {
                continue;
            }
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if path.to_lowercase().contains(&needle) {
                if out.results.len() >= MAX_RESULTS {
                    out.truncated = true;
                    return out;
                }
                out.results.push(path.clone());
            }
            if depth + 1 < MAX_DEPTH {
                queue.push_back((entry.path(), path, depth + 1));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            let path = std::env::temp_dir().join(format!("tether-folders-{label}-{nanos}"));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn finds_matches_at_any_level_within_depth() {
        let tree = TempTree::new("nested");
        std::fs::create_dir_all(tree.0.join("work/alpha/beta")).unwrap();
        std::fs::create_dir_all(tree.0.join("Other")).unwrap();

        let found = search(&tree.0, "BETA");
        assert_eq!(found.results, vec!["work/alpha/beta".to_string()]);
        assert!(!found.truncated);
    }

    #[test]
    fn skips_hidden_and_build_folders() {
        let tree = TempTree::new("skip");
        std::fs::create_dir_all(tree.0.join(".cache/needle")).unwrap();
        std::fs::create_dir_all(tree.0.join("node_modules/needle")).unwrap();
        std::fs::create_dir_all(tree.0.join("src/needle")).unwrap();

        assert_eq!(search(&tree.0, "needle").results, vec!["src/needle".to_string()]);
    }

    #[test]
    fn does_not_search_below_max_depth() {
        let tree = TempTree::new("depth");
        std::fs::create_dir_all(tree.0.join("a/b/c/needle")).unwrap();

        assert!(search(&tree.0, "needle").results.is_empty());
    }

    #[test]
    fn empty_query_and_missing_root_return_nothing() {
        let tree = TempTree::new("empty");
        assert_eq!(search(&tree.0, "   "), SearchResult::default());
        assert_eq!(search(&tree.0.join("missing"), "x"), SearchResult::default());
    }
}
