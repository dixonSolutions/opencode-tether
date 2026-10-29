use std::path::{Path, PathBuf};

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let source = manifest.join("../apps/tether/build");
    let embedded = manifest.join("web");

    if source.join("index.html").exists() {
        let _ = std::fs::remove_dir_all(&embedded);
        if let Err(error) = copy_dir(&source, &embedded) {
            println!("cargo:warning=could not copy apps/tether/build into server/web: {error}");
        }
    } else if !embedded.join("index.html").exists() {
        let _ = std::fs::create_dir_all(&embedded);
        let _ = std::fs::write(
            embedded.join("index.html"),
            "<!doctype html><meta charset=\"utf-8\"><title>opencode-tether</title><p>Build the web app first: <code>npm --prefix apps/tether run build</code>.</p>",
        );
        println!("cargo:warning=apps/tether/build was missing; wrote a placeholder. Run `npm --prefix apps/tether run build` for the real UI.");
    }
    println!("cargo:rerun-if-changed=../apps/tether/build");
    println!("cargo:rerun-if-changed=build.rs");
}
