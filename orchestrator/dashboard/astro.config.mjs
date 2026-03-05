import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Proxy API and SSE calls to the tmx daemon during dev
      proxy: {
        "/api": "http://127.0.0.1:18970",
      },
    },
  },
  output: "static",
});
