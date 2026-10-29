use std::path::Path;

fn main() {
    let web = Path::new(env!("CARGO_MANIFEST_DIR")).join("../apps/tether/build");
    if !web.join("index.html").exists() {
        let _ = std::fs::create_dir_all(&web);
        let _ = std::fs::write(
            web.join("index.html"),
            "<!doctype html><meta charset=\"utf-8\"><title>opencode-tether</title><p>Build the web app first: <code>npm --prefix apps/tether run build</code>.</p>",
        );
        println!("cargo:warning=apps/tether/build was missing; wrote a placeholder. Run `npm --prefix apps/tether run build` for the real UI.");
    }
    println!("cargo:rerun-if-changed=../apps/tether/build/index.html");
}
