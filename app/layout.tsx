import type { ReactNode } from "react";

export const metadata = {
  title: "cadrum wasm STEP -> GLB",
  description: "Convert a STEP file to GLB in the browser via the cadrum wasm prebuilt",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Google <model-viewer> via CDN. No three.js dependency. */}
        <script
          type="module"
          src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"
        />
      </head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
