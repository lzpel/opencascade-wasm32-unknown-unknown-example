"use client";

// Automated self-test route: on load it fetches a bundled STEP file from
// /public, runs it through the wasm step_to_glb, and validates the GLB header.
// Used to verify the webpack-bundled wasm path end-to-end (headless browser).
// Sets document.title to "SELFTEST:OK ..." or "SELFTEST:ERROR ..." so a
// headless run can read the result without DevTools scripting.

import { useEffect, useState } from "react";

export default function SelfTest() {
  const [msg, setMsg] = useState("running...");

  useEffect(() => {
    (async () => {
      try {
        const mod = await import("../../wasm/pkg/cadrum_web.js");
        await mod.default();
        // Public assets are served under basePath on GitHub Pages.
        const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
        const resp = await fetch(`${base}/colored_box_roundtrip.step`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        const glb = mod.step_to_glb(buf);
        const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
        const magic = dv.getUint32(0, true);
        const ver = dv.getUint32(4, true);
        const len = dv.getUint32(8, true);
        const ok = magic === 0x46546c67 && ver === 2 && len === glb.length;
        const out = `${ok ? "OK" : "BAD"} glbLen=${glb.length} magic=${magic.toString(16)} ver=${ver}`;
        document.title = "SELFTEST:" + out;
        setMsg(out);
      } catch (e) {
        document.title = "SELFTEST:ERROR " + ((e as any)?.message || String(e));
        setMsg("ERROR " + ((e as any)?.message || String(e)));
      }
    })();
  }, []);

  return <pre style={{ padding: 24 }}>selftest: {msg}</pre>;
}
