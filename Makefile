# GitHub Pages serves this project at a sub-path, so the static build must use
# it as the base URL (Trunk --public-url).
PUBLIC_URL ?= /opencascade-wasm32-unknown-unknown-example/
# cadrum's published cross image: wasi-sdk clang + sysroot and every wasm32 env
# var (CC/CXX/CFLAGS/CXXFLAGS/RUSTFLAGS, CARGO_BUILD_TARGET=wasm32) preset.
CROSS_IMAGE ?= ghcr.io/lzpel/cross-wasm32-unknown-unknown:latest

# Build the wasm site into ./dist. Assumes the wasm32 toolchain env is already
# set (it is, inside CROSS_IMAGE). Trunk is not in the image, so install it into
# ./target/bin — that lives in the mounted work tree, so a repeated build reuses
# it: `cargo install` no-ops when the same version is already there (~2.5 min
# saved). CARGO_BUILD_TARGET=wasm32 is preset in the image, so unset it for the
# install so Trunk builds for the host. wasm-bindgen + wasm-opt are fetched by
# Trunk on first run.
.PHONY: deploy
deploy:
	unset CARGO_BUILD_TARGET; cargo install --locked --root ./target trunk
	./target/bin/trunk build --release --public-url "$(PUBLIC_URL)"

# Wrapper: run `make deploy` inside cadrum's cross image, which supplies the
# wasi-sdk toolchain + all CC/CXX/CFLAGS/RUSTFLAGS env. CARGO_TARGET_DIR is
# redirected out of the mount so no root-owned target/ lands in the work tree.
# MSYS_NO_PATHCONV=1 stops Git-Bash/MSYS from rewriting the container paths
# (/src, /tmp/target) into Windows paths; it is an ignored no-op on Linux/CI.
# --pull=always keeps the mutable `latest` tag honest: a stale local cache (pre-cadrum-0.8.14)
# has an exnref sysroot and links a mixed-EH module that every wasm engine rejects.
.PHONY: deploy-cross
deploy-cross:
	MSYS_NO_PATHCONV=1 docker run --rm --pull=always -v "$(PWD)":/src -w /src -e CARGO_TARGET_DIR=/tmp/target $(CROSS_IMAGE) make deploy
