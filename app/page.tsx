"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("Loading wasm...");
  const [ready, setReady] = useState(false);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  // step_to_glb is loaded lazily from the wasm-pack ESM glue.
  const convertRef = useRef<((bytes: Uint8Array) => Uint8Array) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // wasm-pack --target web emits an ESM module with a default init() that
        // must be awaited before any exported function is called.
        const mod = await import("../wasm/pkg/cadrum_web.js");
        await mod.default();
        if (cancelled) return;
        convertRef.current = mod.step_to_glb;
        setReady(true);
        setStatus("Ready. Select a .step / .stp file.");
      } catch (e) {
        setStatus("Failed to load wasm: " + String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !convertRef.current) return;
    setStatus(`Converting ${file.name} (${file.size} bytes)...`);
    try {
      const buf = await file.arrayBuffer();
      const t0 = performance.now();
      const glb = convertRef.current(new Uint8Array(buf));
      const ms = (performance.now() - t0).toFixed(0);
      // Copy into a fresh ArrayBuffer to detach from wasm memory before Blob.
      const blob = new Blob([new Uint8Array(glb)], { type: "model/gltf-binary" });
      if (glbUrl) URL.revokeObjectURL(glbUrl);
      setGlbUrl(URL.createObjectURL(blob));
      setStatus(`Done: ${glb.length} GLB bytes in ${ms} ms.`);
    } catch (err) {
      setStatus("Conversion error: " + String(err));
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>cadrum wasm: STEP &rarr; GLB</h1>
      <p>
        Loads the cadrum <code>wasm32-unknown-unknown</code> prebuilt (rev1),
        converts an uploaded STEP file to GLB entirely in the browser, and
        renders it with Google <code>&lt;model-viewer&gt;</code>.
      </p>
      <p>
        <input type="file" accept=".step,.stp" disabled={!ready} onChange={onFile} />
      </p>
      <p>
        <strong>Status:</strong> {status}
      </p>
      {glbUrl && (
        <model-viewer
          src={glbUrl}
          camera-controls
          auto-rotate
          shadow-intensity="1"
          style={{ width: "100%", height: 500, background: "#eee" }}
        />
      )}
    </main>
  );
}
