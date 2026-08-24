# GitHub Pages serves this project at a sub-path, so the static build must use it as the base URL (Trunk --public-url).
PUBLIC_URL ?= /opencascade-wasm32-unknown-unknown-example/
export MSYS_NO_PATHCONV=1

# Build the wasm site into ./dist. Assumes the wasm32 toolchain env is alreadyset.
deploy:
	# Trunk is not in the image, so install it into ./target/bin
	unset CARGO_BUILD_TARGET; cargo install --locked --root ./target trunk
	./target/bin/trunk build --release --public-url "$(PUBLIC_URL)"

# Wrapper: run `make deploy` inside cadrum's cross image, which supplies the wasi-sdk toolchain + all CC/CXX/CFLAGS/RUSTFLAGS env.
deploy-cross:
	docker run --rm --pull=always -v "$(PWD)":/src -w /src -e CARGO_TARGET_DIR=/tmp/target ghcr.io/lzpel/cross-wasm32-unknown-unknown:latest make deploy
