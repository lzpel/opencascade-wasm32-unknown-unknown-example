#!/usr/bin/env bash
# Build the cadrum_web wasm crate with wasm-pack.
#
# cadrum links a C++ OCCT prebuilt and compiles a small C++ bridge (cxx_build)
# even when using the *prebuilt* OCCT. For wasm32-unknown-unknown that C++ TU
# must be compiled with the wasi-sdk clang + sysroot, so we mirror the toolchain
# env from cadrum's sandbox-wasm/makefile here.
#
# Portable: works on Linux (CI / GitHub Actions) and on Windows (Git-Bash/MSYS).
#
# Toolchain discovery:
#   wasi-sdk-33  -> $WASI_SDK_PATH, else ./wasi-sdk-33 / ../wasi-sdk-33 / /opt/wasi-sdk
#   wasm-pack    -> on PATH, else ../bin/wasm-pack(.exe)
#
# Usage:  bash build.sh        (run from <repo>/wasm/)
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

# --- locate wasm-pack ------------------------------------------------------
WASM_PACK="$(command -v wasm-pack || true)"
[ -z "$WASM_PACK" ] && [ -x "$HERE/../bin/wasm-pack" ]     && WASM_PACK="$HERE/../bin/wasm-pack"
[ -z "$WASM_PACK" ] && [ -x "$HERE/../bin/wasm-pack.exe" ] && WASM_PACK="$HERE/../bin/wasm-pack.exe"
[ -n "$WASM_PACK" ] || { echo "build.sh: wasm-pack not found on PATH." >&2; exit 1; }

SYSROOT="$(to_native "$WASI/share/wasi-sysroot")"

export PATH="$WASI/bin:$PATH"
export MSYS_NO_PATHCONV=1
export CXXSTDLIB=c++
export CMAKE_GENERATOR="Unix Makefiles"
export CC_wasm32_unknown_unknown=clang
export CXX_wasm32_unknown_unknown=clang++

WASI_EMU="-D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID"
export CXXFLAGS_wasm32_unknown_unknown="--target=wasm32-wasip1 --sysroot=$SYSROOT -fwasm-exceptions -fexceptions $WASI_EMU"
export CFLAGS_wasm32_unknown_unknown="--target=wasm32-wasip1 --sysroot=$SYSROOT $WASI_EMU"
# The OCCT C++ prebuilt is compiled with -fwasm-exceptions (the *new* wasm
# exception-handling model). rustc/LLVM default to the *legacy* EH encoding,
# and a wasm module may not mix the two ("module uses a mix of legacy and new
# exception handling instructions"). Force the Rust side onto the new model so
# the whole module is consistent:
#   +exception-handling          : enable the EH feature on the Rust codegen
#   -wasm-use-legacy-eh=false     : emit the new try_table/throw_ref encoding
# OCCT registers its whole type system (and the dispatch tables that drive STEP
# parsing) from C++ global constructors. Those run in __wasm_call_ctors, which
# wasm-bindgen's `--target web` glue does NOT call for a wasm32-unknown-unknown
# cdylib — so without intervention the first OCCT call dispatches through an
# uninitialized table ("null function or function signature mismatch"). Force
# the linker to export __wasm_call_ctors so the JS init can run it once.
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-L native=$SYSROOT/lib/wasm32-wasip1/eh -L native=$SYSROOT/lib/wasm32-wasip1 -l static=c++abi -l static=unwind -l static=c -C target-feature=+exception-handling -C llvm-args=-wasm-use-legacy-eh=false -C link-arg=--export=__wasm_call_ctors"

cd "$HERE"
"$WASM_PACK" build --target web -d pkg "$@"

# Normalize exception-handling encoding for browsers. clang's -fwasm-exceptions
# (OCCT C++) and rustc emit *different* EH encodings; a wasm module may not mix
# legacy + new EH instructions, and Chrome's stable validator rejects the mix
# ("module uses a mix of legacy and new exception handling instructions").
# `wasm-opt --translate-to-exnref` rewrites the whole module onto the single
# exnref model so it validates everywhere. (`-all` enables every feature so
# the EH/GC instructions parse.) Node tolerates the mix only behind a flag, so
# this step is what makes the browser path work.
WASM_OPT="$HERE/node_modules/.bin/wasm-opt"
if [ -x "$WASM_OPT" ] || [ -x "$WASM_OPT.cmd" ]; then
  "$WASM_OPT" -all --translate-to-exnref pkg/cadrum_web_bg.wasm -o pkg/cadrum_web_bg.wasm
  echo "build.sh: normalized EH via wasm-opt --translate-to-exnref"
else
  echo "build.sh: WARNING wasm-opt (binaryen) not found; browser EH may be mixed. Run: npm i --no-save binaryen" >&2
fi

# The cadrum wasm imports the WASI ABI (`wasi_snapshot_preview1`). wasm-pack
# emits bare imports a browser bundler cannot resolve. Drop in a minimal WASI
# shim and rewire the generated glue to use it. (Idempotent.)
cp -f "$HERE/wasi_shim.js" "$HERE/pkg/wasi_shim.js"
node "$(to_native "$HERE/patch_glue.mjs")"
