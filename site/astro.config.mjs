import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://termux.party",
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
  },
});
