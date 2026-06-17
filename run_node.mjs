// Headless smoke test for the cadrum_web wasm — runs the SAME wasm the browser
// loads, but under Node's V8. V8 enforces the same constraints a browser does,
// so wasm runtime bugs (unresolved WASI imports, mixed exception-handling
// encodings, unrun __wasm_call_ctors) surface here without opening a browser.
//
//   bash build.sh build --release   # produces ./dist
//   node --experimental-wasm-exnref run_node.mjs
//
// It loads the Trunk-built wasm, calls chijin_glb() (pure, no DOM), and checks
// the GLB header. Prints "NODETEST:OK …" and exits 0 on success. No STEP file
// and no npm dependencies are needed.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distUrl = new URL("./dist/", import.meta.url);
const files = readdirSync(distUrl);

// Trunk + wasm-bindgen `--target web` emit `<base>_bg.wasm` and `<base>.js`
// (the JS glue), with `<base>` hashed. Derive both from the wasm filename.
const wasmName = files.find((f) => f.endsWith("_bg.wasm"));
if (!wasmName) {
  console.error("run_node: no *_bg.wasm in ./dist — run `bash build.sh build --release` first.");
  process.exit(1);
}
const glueName = wasmName.replace(/_bg\.wasm$/, ".js");

// The glue is an ES module with a `.js` extension; tell Node to treat ./dist
// as ESM so dynamic import() parses it as a module.
writeFileSync(new URL("./package.json", distUrl), '{ "type": "module" }\n');

const mod = await import(new URL(glueName, distUrl));
// `--target web` init fetches the .wasm by URL; Node's fetch can't read file
// URLs, so hand it the bytes explicitly.
await mod.default({ module_or_path: readFileSync(fileURLToPath(new URL(wasmName, distUrl))) });

const glb = mod.chijin_glb();
const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
const magic = dv.getUint32(0, true);
const ver = dv.getUint32(4, true);
const len = dv.getUint32(8, true);
const ok = magic === 0x46546c67 && ver === 2 && len === glb.length;
console.log(`NODETEST:${ok ? "OK" : "BAD"} glbLen=${glb.length} magic=${magic.toString(16)} ver=${ver}`);
if (!ok) process.exit(1);
