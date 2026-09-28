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

  const label = isPending
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
          isPending
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
