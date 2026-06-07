import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: "../../chrome/dist/orbit",
    sourcemap: false,
    lib: {
      entry: "src/main.tsx",
      formats: ["iife"],
      name: "BlackbaudNextOrbitApp",
      fileName: () => "orbit.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "orbit.css";
          }

          return "[name][extname]";
        },
      },
    },
  },
});
