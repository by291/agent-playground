import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "");
  const backendUrl = env.BACKEND_URL ?? "http://127.0.0.1:3000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/agent": backendUrl,
        "/conversations": backendUrl,
        "/health": backendUrl,
      },
    },
  };
});
