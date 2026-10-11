import { useQuery } from "@tanstack/react-query";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

export function GatewayStatus({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          role="status"
          aria-label={label}
          className={`h-8 gap-2 border-transparent bg-transparent text-xs text-muted ${compact ? "justify-center px-2" : "justify-start px-0"} ${className}`}
        >
          <span className={`size-2 rounded-full ${statusColor}`} />
          <span className={compact ? "sr-only" : undefined}>{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
