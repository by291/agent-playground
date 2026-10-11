import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/AppProviders";
import { appConfig } from "@/app/config";
import { App } from "@/app/App";
import "streamdown/styles.css";
import "@/styles/index.css";

if (appConfig.observabilityEnabled) {
  const { initializeTracing } =
    await import("@/shared/observability/bootstrap");

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
