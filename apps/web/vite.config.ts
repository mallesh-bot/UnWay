import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

// MapLibre 6 loads its worker from a separate module file. Copy the worker and
// its shared chunk into public/maplibre so they are served next to the app.
function maplibreWorker() {
  const copy = () => {
    const src = path.resolve("node_modules/maplibre-gl/dist");
    const dst = path.resolve("public/maplibre");
    fs.mkdirSync(dst, { recursive: true });
    for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  };
  return { name: "maplibre-worker", config: copy };
}

export default defineConfig({
  plugins: [maplibreWorker(), react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 2500 },
});
