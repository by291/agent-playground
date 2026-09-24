import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/agent": process.env.BACKEND_URL ?? "http://127.0.0.1:3000",
      "/health": process.env.BACKEND_URL ?? "http://127.0.0.1:3000",
    },
  },
});
