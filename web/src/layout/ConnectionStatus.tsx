import { useEffect, useState } from "react";

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
    <div
      role="status"
      className="hidden items-center gap-2 text-xs font-medium text-muted md:flex"
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
    </div>
  );
}
