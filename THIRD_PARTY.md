# Third-party notices

opencode-tether is MIT licensed. It depends on and redistributes work from these projects. Their licenses apply to their code/assets.

## Runtime and UI

| Project | License | Use |
| --- | --- | --- |
| [opencode](https://opencode.ai) | MIT | API, server, and the box mark used to identify the service |
| [Svelte](https://svelte.dev) / [SvelteKit](https://svelte.dev) | MIT | web framework |
| [shadcn-svelte](https://shadcn-svelte.com) | MIT | UI component source |
| [bits-ui](https://bits-ui.com) | MIT | accessible primitives |
| [Tailwind CSS](https://tailwindcss.com) | MIT | styling |
| [Tauri](https://tauri.app) | MIT or Apache-2.0 | native shell |
| [WebKitGTK](https://webkitgtk.org) | LGPL-2.1+ / BSD-style | desktop web engine (runtime, not bundled by this repo) |
| [xterm.js](https://xtermjs.org) | MIT | terminal |
| [marked](https://marked.js.org) | MIT | markdown parsing |
| [highlight.js](https://highlightjs.org) | BSD-3-Clause | code highlighting |
| [DOMPurify](https://github.com/cure53/DOMPurify) | MPL-2.0 or Apache-2.0 | HTML sanitization |
| [Lucide](https://lucide.dev) | ISC | icons |
| [Inter](https://rsms.me/inter/) | SIL OFL-1.1 | UI font |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | SIL OFL-1.1 | terminal/code font |
| [mode-watcher](https://github.com/svecosystem/mode-watcher) | MIT | theme state |
| [svelte-sonner](https://github.com/wobsoriano/svelte-sonner) | MIT | toasts |

## Rust

The host uses the Rust crates listed in `server/Cargo.lock`, including axum, tokio, reqwest, tower, argon2, hmac, sha2, rust-embed, clap, tracing, tokio-tungstenite, serde, and their transitive dependencies. Most are dual MIT/Apache-2.0; the lockfile is the source of truth for exact versions.

The Tauri shell uses Tauri and its official plugins, plus serde and serde_json. See `apps/tether/src-tauri/Cargo.lock`.

## Assets

The icon is derived from the opencode box mark, combined with an original tether-link motif. See [docs/branding.md](docs/branding.md). The project is unofficial and does not claim the opencode trademark.

## Full texts

License texts for dependencies are available in each package's distribution. If you redistribute a built binary, include this notice and the upstream license texts required by the dependencies you ship.
