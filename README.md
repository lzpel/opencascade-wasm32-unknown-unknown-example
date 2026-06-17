# cadrum-wasm-example — STEP → GLB in the browser

A minimal [Trunk](https://trunkrs.dev/) app that loads a wasm build of
[cadrum](https://github.com/lzpel/cadrum) (pulled from GitHub), and **runs
entirely in the browser**:

- **On load** it generates the `examples/00_chijin.rs` geometry dynamically
  (no STEP file is shipped) and renders it with Google `<model-viewer>`.
- **Select a `.step` / `.stp` file** and it is converted to GLB and shown.

The UI is written in Rust (`web-sys`); `<model-viewer>` is loaded from a CDN, so
there is **no JS/TS build, no npm dependency, no bundler config**. This repo's
job is to canary the *current* cadrum `wasm32-unknown-unknown` path — it tracks
cadrum `main` via a git dependency (with `Cargo.lock` git-ignored so every build
re-resolves the latest commit).

## 🌐 Live site

**https://lzpel.github.io/cadrum-wasm-example/**

Built and deployed by GitHub Actions (`.github/workflows/deploy.yml`):
cross-compile with wasi-sdk-33 → `trunk build` → headless Node smoke test →
publish `dist/` to GitHub Pages.

## Files

```
Cargo.toml                    # cadrum = { git = ".../cadrum" } (tracks main); deps; release profile
src/main.rs                   # fn main() (entry) + step_to_glb / chijin_glb + web-sys UI
index.html                    # Trunk entry; <model-viewer> CDN; data-wasm-opt="0"
build.sh                      # set wasi-sdk toolchain env, then run `trunk`
run_node.mjs                  # headless smoke test against ./dist
.github/workflows/deploy.yml  # build → Node test → Pages
```

## Run locally

Prerequisites (same as CI): Rust + `wasm32-unknown-unknown` target,
[Trunk](https://trunkrs.dev/) (`cargo install trunk`), Node, and
[wasi-sdk 33](https://github.com/WebAssembly/wasi-sdk/releases) (point
`WASI_SDK_PATH` at it, or drop it in `./wasi-sdk-33`).

```sh
bash build.sh serve            # dev server with rebuild → http://localhost:8080
bash build.sh build --release  # static build → ./dist

# Headless: build the wasm and verify chijin GLB generation under Node (V8),
# which enforces the same wasm constraints a browser does.
bash build.sh build --release
node --experimental-wasm-exnref run_node.mjs   # → NODETEST:OK …
```

## Notes

- **wasm-opt is disabled** via `data-wasm-opt="0"` in `index.html`: OCCT-derived
  exnref exception handling makes wasm-opt (binaryen) crash in its Precompute
  pass. This only skips optimization.
- `build.sh` must hand the wasi-sdk clang + sysroot to the build: cadrum compiles
  its cxx bridge C++ for wasm32 (even with the prebuilt OCCT), so the toolchain
  env (`CC/CXX/CFLAGS/CXXFLAGS_wasm32...` + the `eh` libc++abi/unwind/libc link
  flags) is required downstream.
- `src/main.rs` runs OCCT's C++ global constructors at startup (mirroring
  `cadrum::wasm_start!`); without it the first OCCT call traps.
- The module uses wasm exception handling (exnref) — use an up-to-date
  Chrome / Edge / Firefox (Node needs `--experimental-wasm-exnref`).
