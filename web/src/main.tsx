import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/providers";
import { appConfig } from "@/app/config";
import { App } from "@/app/App";
import "@/styles/index.css";
import "streamdown/styles.css";

if (appConfig.observabilityEnabled) {
  const { initializeTracing } = await import("@/observability/bootstrap");

  initializeTracing();
}

const root = document.getElementById("app");

if (!root) {
  throw new Error("App root is missing");
}

createRoot(root).render(
  <AppProviders>
    <App />
  </AppProviders>,
);
