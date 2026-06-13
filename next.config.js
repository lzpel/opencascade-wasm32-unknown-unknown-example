/** @type {import('next').NextConfig} */

// On GitHub Pages this project is served from a sub-path
// (https://lzpel.github.io/cadrum-wasm-example/), so the CI build sets
// PAGES_BASE_PATH=/cadrum-wasm-example. Locally the var is unset → base path "",
// so `npm run dev` / `npm run build` work at the root with no extra config.
const basePath = process.env.PAGES_BASE_PATH || "";

const nextConfig = {
  // Produce a fully static site under ./out (index.html + /selftest/index.html).
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  // Expose the base path to client code (the self-test fetches a /public asset).
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // wasm-pack --target web ships a .wasm fetched at runtime by the generated
  // ESM glue; webpack bundles it as an asset, so no special wasm config is
  // needed. Disable image optimization for static export.
  images: { unoptimized: true },
};

module.exports = nextConfig;
