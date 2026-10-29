# Contributing

This is an unofficial hobby project. Small, focused pull requests are welcome.

## Ground rules

- Be kind. This is not affiliated with opencode; do not ask the opencode maintainers to support it.
- Keep the branding unofficial. Do not present the app as an official opencode client.
- Do not commit credentials, keystores, `keystore.properties`, `.env` files, screenshots containing private sessions, or generated build output.
- Prefer the existing stack: Svelte 5 runes, shadcn-svelte components, Tauri v2, Rust/axum.

## Before opening a PR

```sh
npm --prefix apps/tether run check
npm --prefix apps/tether run build
cargo test --manifest-path server/Cargo.toml --all-targets
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
```

If you changed the host API or auth, add or update tests. If you changed the UI, include a screenshot at 390×844 and 1440×900, and mention whether you tested touch targets and safe areas.

## Commit style

Short imperative subject, for example:

```
fix host ws auth for terminal tickets
add model favorites
```

## Release secrets

Maintainers own the Android keystore and the GPG key. Do not add them to the repository. See [docs/releases.md](docs/releases.md).
