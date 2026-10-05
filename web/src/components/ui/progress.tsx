"use client";

import * as React from "react";
import { cn } from "cn";
import { Progress as ProgressPrimitive } from "radix-ui";

function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted-surface",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="motion-progress size-full flex-1 rounded-full bg-accent"
        style={{
          transform: `scaleX(${Math.min(1, Math.max(0, (value ?? 0) / max))})`,
        }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
