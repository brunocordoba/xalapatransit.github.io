import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Solo si usas Vite en Replit con Cartographer
const cartographerPlugin =
  process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
    ? await import("@replit/vite-plugin-cartographer").then((m) => m.cartographer())
    : [];

export default defineConfig({
  base: "/xalapatransit.github.io/", // <-- cambia esto si tu repo tiene otro nombre
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...cartographerPlugin,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
});
