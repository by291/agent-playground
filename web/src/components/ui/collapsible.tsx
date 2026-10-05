import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { cn } from "cn";
import { createContext, useContext, useState } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useMotionTiming } from "./motion";

const expandedContext = createContext(false);

type CollapsibleProps = Omit<
  React.ComponentProps<typeof CollapsiblePrimitive.Root>,
  "onOpenChange"
> & { onOpenChange?: (open: boolean) => void };

function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const expanded = open ?? uncontrolledOpen;

  function changeOpen(next: boolean) {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <expandedContext.Provider value={expanded}>
      <CollapsiblePrimitive.Root
        data-slot="collapsible"
        open={expanded}
        onOpenChange={changeOpen}
        {...props}
      />
    </expandedContext.Provider>
  );
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  );
}

function CollapsibleContent({
  className,
  children,
  keepMounted = false,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent> & {
  keepMounted?: boolean;
}) {
  const expanded = useContext(expandedContext);
  const [hasOpened, setHasOpened] = useState(expanded);
  const timing = useMotionTiming(expanded ? "panel" : "exit");

  if (expanded && !hasOpened) {
    setHasOpened(true);
  }

  if (keepMounted) {
    return hasOpened ? (
      <CollapsiblePrimitive.Content
        {...props}
        forceMount
        data-slot="collapsible-content"
        inert={!expanded}
        aria-hidden={!expanded}
      >
        <motion.div
          initial={false}
          animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
          transition={timing}
          style={{ overflow: "hidden" }}
        >
          <div className={cn("flow-root", className)}>{children}</div>
        </motion.div>
      </CollapsiblePrimitive.Content>
    ) : null;
  }

  return (
    <AnimatePresence initial={false}>
      {expanded && (
        <DisclosureContent {...props} className={className}>
          {children}
        </DisclosureContent>
      )}
    </AnimatePresence>
  );
}

function DisclosureContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  const present = useIsPresent();
  const timing = useMotionTiming("panel");
  const exitTiming = useMotionTiming("exit");

  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      {...props}
      forceMount
      inert={!present}
      aria-hidden={!present}
    >
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0, transition: exitTiming }}
        transition={timing}
        style={{ overflow: "hidden" }}
      >
        <div className={cn("flow-root", className)}>{children}</div>
      </motion.div>
    </CollapsiblePrimitive.Content>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
