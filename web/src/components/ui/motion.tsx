import { useMemo } from "react";
import {
  motion,
  useIsPresent,
  useReducedMotion,
  type HTMLMotionProps,
  type TargetAndTransition,
} from "motion/react";

type AnimatedProps<Tag extends "div" | "li"> = Omit<
  HTMLMotionProps<Tag>,
  "exit"
> & { exit?: TargetAndTransition };

export function useMotionTiming(
  kind: "content" | "panel" | "exit" = "content",
) {
  const reduced = useReducedMotion();

  return useMemo(() => {
    const fallback = { content: 180, panel: 220, exit: 140 };
    const styles =
      typeof document === "undefined"
        ? null
        : getComputedStyle(document.documentElement);
    const value = styles?.getPropertyValue(`--motion-${kind}`) ?? "";
    const curve = styles
      ?.getPropertyValue(`--motion-${kind === "exit" ? "exit" : "enter"}-ease`)
      .match(/[\d.]+/g)
      ?.map(Number);
    const fallbackCurve = kind === "exit" ? [0.4, 0, 1, 1] : [0.2, 0.8, 0.2, 1];
    const ease = curve?.length === 4 ? curve : fallbackCurve;

    return {
      duration: reduced
        ? 0
        : (Number.parseFloat(value) || fallback[kind]) / 1000,
      ease: ease as [number, number, number, number],
    };
  }, [kind, reduced]);
}

export function AnimatedDiv(props: AnimatedProps<"div">) {
  const present = useIsPresent();
  const timing = useMotionTiming();
  const exitTiming = useMotionTiming("exit");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={timing}
      {...props}
      exit={{ opacity: 0, ...props.exit, transition: exitTiming }}
      inert={!present || props.inert}
      aria-hidden={!present || props["aria-hidden"]}
    />
  );
}

export function AnimatedLi(props: AnimatedProps<"li">) {
  const present = useIsPresent();
  const timing = useMotionTiming();
  const exitTiming = useMotionTiming("exit");

  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={timing}
      {...props}
      exit={{ opacity: 0, ...props.exit, transition: exitTiming }}
      inert={!present || props.inert}
      aria-hidden={!present || props["aria-hidden"]}
    />
  );
}
