import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./style.css";
import "streamdown/styles.css";

if (import.meta.env.VITE_OBSERVABILITY_ENABLED === "true") {
  const { initializeTracing } = await import("./observability/bootstrap");

  initializeTracing();
}

const root = document.getElementById("app");

if (!root) {
  throw new Error("App root is missing");
}

const queryClient = new QueryClient();

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
