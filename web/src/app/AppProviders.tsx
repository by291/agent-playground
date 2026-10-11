import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { UserPreferencesProvider } from "@/shared/preferences/UserPreferencesProvider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());

  return (
    <UserPreferencesProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </UserPreferencesProvider>
  );
}
