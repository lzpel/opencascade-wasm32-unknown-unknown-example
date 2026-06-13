# cadrum-wasm-example — build & test the STEP→GLB wasm from the command line.
#
# `make test` builds the wasm and runs it under Node (V8) — the same engine
# constraints as a browser — so wasm runtime bugs (unresolved WASI imports,
# mixed exception-handling encodings, unrun __wasm_call_ctors) surface here
# without ever opening a browser. See README.

.PHONY: wasm test site clean

# Build the wasm crate (wasm-pack + EH normalization + glue patch).
wasm:
	cd wasm && npm install && bash build.sh

# Build the wasm, then run the headless conversion smoke test in Node.
test: wasm
	node --experimental-wasm-exnref run_node.mjs

# Build the static site into ./out (Next.js static export).
site:
	npm install && npm run build

clean:
	rm -rf wasm/pkg wasm/target .next out node_modules wasm/node_modules
