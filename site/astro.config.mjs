import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://termux.party",
  // Astro 7 defaults to 'jsx', which strips whitespace between inline elements
  // ("a <strong>stable</strong> launcher" → "a<strong>stable</strong>launcher").
  // The pages rely on that whitespace, so keep the Astro 5 behaviour.
  compressHTML: true,
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
  },
});
