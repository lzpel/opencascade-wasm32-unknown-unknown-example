// Post-process the wasm-pack `--target web` glue so it works in a browser
// bundler (Next.js/webpack).
//
// The cadrum wasm imports the `wasi_snapshot_preview1` module. wasm-pack emits
// bare `import * as importN from "wasi_snapshot_preview1"` statements that no
// bundler can resolve. We rewrite those to pull from our local ./wasi_shim.js,
// and inject a call that hands the wasm memory to the shim (needed by
// fd_write) right after instantiation.
//
// Idempotent: running twice is a no-op.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("./pkg/cadrum_web.js", import.meta.url);
let src = readFileSync(path, "utf8");

if (src.includes("./wasi_shim.js")) {
  console.log("patch_glue: already patched, skipping");
  process.exit(0);
}

// 1. Replace every `import * as importN from "wasi_snapshot_preview1"` line.
//    Collect the importN identifiers, drop the bare imports, and re-bind each
//    identifier to the single shim namespace.
const importIds = [];
src = src.replace(
  /^import \* as (import\d+) from "wasi_snapshot_preview1"\s*$/gm,
  (_m, id) => {
    importIds.push(id);
    return "";
  }
);

if (importIds.length === 0) {
  console.error("patch_glue: found no wasi_snapshot_preview1 imports — glue format changed?");
  process.exit(1);
}

const header =
  `import * as __wasi_shim from "./wasi_shim.js";\n` +
  importIds.map((id) => `const ${id} = __wasi_shim;`).join("\n") +
  "\n";

src = header + src;

// 2. After instantiation: (a) hand the wasm memory to the shim so fd_write can
//    read iovec buffers, and (b) run __wasm_call_ctors so OCCT's C++ global
//    constructors execute (they register the type system / dispatch tables).
src = src.replace(
  /(function __wbg_finalize_init\(instance, module\) \{\s*\n\s*wasmInstance = instance;\s*\n\s*wasm = instance\.exports;)/,
  `$1\n    __wasi_shim.__setWasiMemory(wasm.memory);\n    if (typeof wasm.__wasm_call_ctors === "function") wasm.__wasm_call_ctors();`
);

if (!src.includes("__setWasiMemory(wasm.memory)") || !src.includes("__wasm_call_ctors()")) {
  console.error("patch_glue: failed to inject init hooks — glue format changed?");
  process.exit(1);
}

writeFileSync(path, src);
console.log(`patch_glue: rewired ${importIds.length} wasi imports + injected memory hook`);
