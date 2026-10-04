import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { UserPreferencesProvider } from "@/lib/preferences";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());

  return (
    <UserPreferencesProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </UserPreferencesProvider>
  );
}
