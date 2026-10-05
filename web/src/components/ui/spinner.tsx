import { cn } from "cn";
import { SpinnerIcon } from "@phosphor-icons/react/dist/csr/Spinner";

function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof SpinnerIcon>) {
  return (
    <SpinnerIcon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 motion-safe:animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
