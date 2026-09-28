import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

export function ConnectionStatus() {
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
    statusColor = "bg-emerald-600";
  }

  return (
    <Badge
      variant="outline"
      role="status"
      className="hidden h-7 items-center gap-2 border-line bg-white px-2.5 text-xs text-muted md:inline-flex"
    >
      <span className={`size-2 rounded-full ${statusColor}`} />
      {label}
    </Badge>
  );
}
