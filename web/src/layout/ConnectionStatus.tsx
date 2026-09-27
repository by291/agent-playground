import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

export function ConnectionStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((response) => setConnected(response.ok))
      .catch(() => setConnected(false));
  }, []);

  const label =
    connected === null
      ? "Checking gateway"
      : connected
        ? "Gateway online"
        : "Gateway offline";

  return (
    <Badge
      variant="outline"
      role="status"
      className="hidden h-7 items-center gap-2 border-line bg-white px-2.5 text-xs text-muted md:inline-flex"
    >
      <span
        className={`size-2 rounded-full ${
          connected === null
            ? "bg-amber-400"
            : connected
              ? "bg-emerald-600"
              : "bg-red-500"
        }`}
      />
      {label}
    </Badge>
  );
}
