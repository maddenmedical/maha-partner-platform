import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  // Absolute (root-relative) asset paths: this app is now served at more
  // than one real URL depth on the same origin ("/" for partners/students,
  // "/admin/" for the separately-scoped admin PWA), and relative "./"
  // asset URLs resolve differently depending on which one loaded the page —
  // "/admin/" would look for "/admin/assets/..." and 404. Absolute paths
  // resolve the same regardless of URL depth.
  base: "/",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
