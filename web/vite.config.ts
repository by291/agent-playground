import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

function productionFeatureBoundary(): Plugin {
  return {
    name: "production-feature-boundary",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") {
          continue;
        }

        const developmentModule = output.moduleIds.find(
          (id) =>
            id.includes("/src/pages/dev/") ||
            /[/@]monaco-editor[/@]/.test(id) ||
            /\/features\/conversation\/(ui\/(ActivityPanel|ActivityItem|MergedActivityContent|JsonPayload|activity\.css)|model\/activity)/.test(
              id,
            ),
        );

        if (developmentModule) {
          this.error(
            `Development module included in production: ${developmentModule}`,
          );
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "");
  const backendUrl = env.BACKEND_URL ?? "http://127.0.0.1:3000";

  return {
    plugins: [react(), tailwindcss(), productionFeatureBoundary()],
    resolve: { tsconfigPaths: true },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/agent": backendUrl,
        "/agent-info": backendUrl,
        "/conversations": backendUrl,
        "/api/knowledge": backendUrl,
        "/health": backendUrl,
        "/telemetry": backendUrl,
      },
    },
  };
});
