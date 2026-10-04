import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";

export function AppBrand({
  subtitle,
  development = false,
  iconClassName,
}: {
  subtitle: string;
  development?: boolean;
  iconClassName?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
          iconClassName,
        )}
      >
        <StackIcon size={19} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.02em] sm:text-base">
            Agent Playground
          </h1>
          {development && (
            <Badge
              variant="secondary"
              className="hidden border border-accent-line bg-accent-soft text-[10px] font-semibold tracking-wide text-accent sm:inline-flex"
            >
              DEV
            </Badge>
          )}
        </div>
        <p className="hidden text-xs text-soft sm:block">{subtitle}</p>
      </div>
    </div>
  );
}
