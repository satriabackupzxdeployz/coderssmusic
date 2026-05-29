import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    // Minify sepenuhnya dengan terser untuk obfuscation lebih kuat
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
      },
      mangle: {
        // Mangle semua nama variabel/fungsi agar tidak terbaca
        toplevel: true,
        properties: false,
      },
      format: {
        comments: false,
      },
    },
    // CSS juga diminify otomatis
    cssMinify: true,
    // Pisah chunks agar logic tidak bisa dibaca sebagai satu file
    rollupOptions: {
      output: {
        // Nama file dengan hash unik
        entryFileNames: "assets/[hash].js",
        chunkFileNames: "assets/[hash].js",
        assetFileNames: "assets/[hash].[ext]",
        // Manual chunks untuk memecah logic lebih jauh
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return "vendor";
          }
          if (id.includes("src/utils/")) {
            return "core";
          }
        },
      },
    },
  },
});
