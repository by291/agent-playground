import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const {
    data: healthy,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["health"],
    queryFn: async ({ signal }) => (await fetch("/health", { signal })).ok,
    refetchInterval: 30_000,
    retry: 1,
  });
  const connected = healthy === true && !isError;

  let label = "Gateway offline";
  let statusColor = "bg-red-500";

  if (isPending) {
    label = "Checking gateway";
    statusColor = "bg-amber-400";
  } else if (connected) {
    label = "Gateway online";
    statusColor = "bg-accent";
  }

  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={label}
      title={compact ? label : undefined}
      className={`h-8 gap-2 border-transparent bg-transparent text-xs text-muted ${compact ? "justify-center px-2" : "justify-start px-0"}`}
    >
      <span className={`size-2 rounded-full ${statusColor}`} />
      <span className={compact ? "sr-only" : undefined}>{label}</span>
    </Badge>
  );
}
