use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web/"]
struct Assets;

#[derive(Clone, Debug)]
pub struct WebAssets {
    pub root: Option<PathBuf>,
    pub version: String,
    pub title: String,
}

pub struct Asset {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub cache: &'static str,
}

impl WebAssets {
    pub fn new(root: Option<PathBuf>) -> Self {
        Self {
            root,
            version: env!("CARGO_PKG_VERSION").to_string(),
            title: "opencode-tether".into(),
        }
    }

    pub fn read(&self, request_path: &str) -> Option<Asset> {
        let decoded = percent_decode_str(request_path).decode_utf8().ok()?;
        let relative = decoded.trim_start_matches('/');
        if relative.split('/').any(|part| part == ".." || part == ".") {
            return None;
        }

        if relative.is_empty() || relative == "index.html" {
            return self.read_index();
        }

        let mut candidates = Vec::new();
        {
            candidates.push(relative.to_string());
            if relative.ends_with('/') {
                candidates.push(format!("{relative}index.html"));
            }
        }

        for candidate in &candidates {
            if let Some(asset) = self.read_exact(candidate) {
                return Some(asset);
            }
        }

        if !relative.contains('.') || relative.starts_with("s/") {
            return self.read_index();
        }
        None
    }

    pub fn read_index(&self) -> Option<Asset> {
        let mut base = self.read_exact("index.html")?;
        let marker = format!(
            "<meta name=\"opencode-tether-host\" content='{{\"version\":\"{}\"}}' data-version=\"{}\">",
            html_escape(&self.version),
            html_escape(&self.version)
        );
        let title = format!("<title>{}</title>", html_escape(&self.title));
        let text = String::from_utf8_lossy(&base.bytes).to_string();
        let mut output = if let Some(pos) = text.find("</head>") {
            let mut out = String::with_capacity(text.len() + marker.len() + 64);
            out.push_str(&text[..pos]);
            out.push_str(&marker);
            if !text[..pos].contains("<title>") {
                out.push_str(&title);
            }
            out.push_str(&text[pos..]);
            out
        } else {
            format!("{marker}{text}")
        };
        if !output.contains("<title>") {
            output = output.replace("<head>", &format!("<head>{title}"));
        }
        base.bytes = output.into_bytes();
        base.mime = "text/html; charset=utf-8";
        base.cache = "no-cache";
        Some(base)
    }

    fn read_exact(&self, relative: &str) -> Option<Asset> {
        if let Some(root) = &self.root {
            if let Some(asset) = read_disk(root, relative) {
                return Some(asset);
            }
        }
        let file = Assets::get(relative)?;
        let mime = mime_guess::from_path(relative).first_or_octet_stream();
        let cache = if relative.starts_with("_app/immutable/") || relative.starts_with("assets/") {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };
        Some(Asset {
            bytes: file.data.into_owned(),
            mime: leak_mime(mime.essence_str()),
            cache,
        })
    }
}

fn read_disk(root: &Path, relative: &str) -> Option<Asset> {
    let path = root.join(relative);
    let canonical = path.canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    if !canonical.starts_with(&root) {
        return None;
    }
    let metadata = std::fs::metadata(&canonical).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let bytes = std::fs::read(&canonical).ok()?;
    let mime = mime_guess::from_path(&canonical).first_or_octet_stream();
    let cache = if relative.starts_with("_app/immutable/") || relative.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Some(Asset {
        bytes,
        mime: leak_mime(mime.essence_str()),
        cache,
    })
}

fn leak_mime(value: &str) -> &'static str {
    match value {
        "text/html" => "text/html; charset=utf-8",
        "text/css" => "text/css; charset=utf-8",
        "text/javascript" => "text/javascript; charset=utf-8",
        "application/javascript" => "text/javascript; charset=utf-8",
        "application/json" => "application/json",
        "image/svg+xml" => "image/svg+xml",
        "image/png" => "image/png",
        "image/x-icon" => "image/x-icon",
        "image/vnd.microsoft.icon" => "image/x-icon",
        "application/manifest+json" => "application/manifest+json",
        "font/woff2" => "font/woff2",
        "application/octet-stream" => "application/octet-stream",
        "text/plain" => "text/plain; charset=utf-8",
        other => Box::leak(other.to_string().into_boxed_str()),
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_built_assets() {
        let web = WebAssets::new(None);
        let index = web.read_index().expect("index.html should be embedded");
        let text = String::from_utf8(index.bytes).unwrap();
        assert!(text.contains("opencode-tether-host"));
        assert!(text.contains("<title>"));
    }

    #[test]
    fn rejects_traversal() {
        let web = WebAssets::new(None);
        assert!(web.read("/../Cargo.toml").is_none());
    }
}
