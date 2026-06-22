import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);
const interLatinFontPath = require.resolve(
  "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
);

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [
    {
      name: "blackbaud-next-fonts",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "inter-latin-wght-normal.woff2",
          source: readFileSync(interLatinFontPath),
        });
      },
    },
  ],
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: "../../chrome/dist/next",
    sourcemap: false,
    lib: {
      entry: "src/main.tsx",
      formats: ["iife"],
      name: "BlackbaudNextApp",
      fileName: () => "next.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "next.css";
          }

          return "[name][extname]";
        },
      },
    },
  },
});
