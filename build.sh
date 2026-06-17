#!/usr/bin/env bash
# Build/serve the cadrum_web wasm app with Trunk.
#
# cadrum links a C++ OCCT prebuilt and compiles a small C++ bridge (cxx_build)
# even when using the *prebuilt* OCCT. For wasm32-unknown-unknown that C++ TU
# must be compiled with the wasi-sdk clang + sysroot, so we set the same
# toolchain env cadrum's sandbox-wasm/makefile uses, then run Trunk (which
# drives `cargo build` + wasm-bindgen under the hood, same as wasm-pack did).
#
# wasm-opt is disabled via `data-wasm-opt="0"` in index.html (OCCT's exnref EH
# crashes binaryen), so there is nothing to configure here for that.
#
# Portable: works on Linux (CI / GitHub Actions) and Windows (Git-Bash/MSYS).
#
# Toolchain discovery:
#   wasi-sdk-33  -> $WASI_SDK_PATH, else ./wasi-sdk-33 / /opt/wasi-sdk
#   trunk        -> on PATH
#
# Usage:
#   bash build.sh                       # = trunk build --release  -> ./dist
#   bash build.sh serve                 # dev server with rebuild
#   bash build.sh build --release --public-url /cadrum-wasm-example/
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# On Windows, rustc/clang are native binaries and need Windows-style (C:/...)
# path arguments; on Linux pass paths through unchanged.
to_native() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) cygpath -m "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

# --- locate wasi-sdk -------------------------------------------------------
WASI="${WASI_SDK_PATH:-}"
if [ -z "$WASI" ]; then
  for c in "$HERE/wasi-sdk-33" "$HERE/../wasi-sdk-33" "/opt/wasi-sdk" "/opt/wasi-sdk-33"; do
    [ -d "$c" ] && WASI="$c" && break
  done
fi
[ -n "$WASI" ] && [ -d "$WASI" ] || { echo "build.sh: wasi-sdk not found. Set WASI_SDK_PATH." >&2; exit 1; }

# --- locate trunk ----------------------------------------------------------
command -v trunk >/dev/null 2>&1 || { echo "build.sh: trunk not found on PATH (cargo install trunk)." >&2; exit 1; }

SYSROOT="$(to_native "$WASI/share/wasi-sysroot")"

export PATH="$WASI/bin:$PATH"
export MSYS_NO_PATHCONV=1
export CXXSTDLIB=c++
export CC_wasm32_unknown_unknown=clang
export CXX_wasm32_unknown_unknown=clang++

# cadrum's build.rs compiles its cxx bridge TU for wasm32 with the cc crate, so
# hand it the wasi-sdk target/sysroot via the cc-crate env vars. The OCCT C++ is
# compiled with -fwasm-exceptions (the new exnref EH model); cadrum's build.rs
# already adds `-mllvm -wasm-use-legacy-eh=false` to keep the bridge on the same
# exnref encoding, so we only need to select the target + sysroot + exceptions.
WASI_EMU="-D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID"
export CXXFLAGS_wasm32_unknown_unknown="--target=wasm32-wasip1 --sysroot=$SYSROOT -fwasm-exceptions -fexceptions $WASI_EMU"
export CFLAGS_wasm32_unknown_unknown="--target=wasm32-wasip1 --sysroot=$SYSROOT $WASI_EMU"
# Link the exnref (eh) variant of libc++abi/libunwind/libc from the wasi-sdk
# sysroot. The final link is done by rustc for wasm32-unknown-unknown.
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-L native=$SYSROOT/lib/wasm32-wasip1/eh -L native=$SYSROOT/lib/wasm32-wasip1 -l static=c++abi -l static=unwind -l static=c"

cd "$HERE"
# Default to a release build into ./dist when no Trunk subcommand is given.
[ "$#" -eq 0 ] && set -- build --release
exec trunk "$@"
