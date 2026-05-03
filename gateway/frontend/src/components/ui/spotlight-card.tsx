"use client";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";
import { ReactNode, MouseEvent } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  spotColor?: string;
  asChild?: boolean;
};

/**
 * Card that follows the cursor with a soft radial glow + gradient border-on-hover.
 * Uses motion values so the gradient updates on every mousemove without re-render.
 */
export function SpotlightCard({
  children,
  className,
  spotColor = "rgba(99, 102, 241, 0.18)",
}: Props) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set(e.clientX - rect.left);
    my.set(e.clientY - rect.top);
  };

  const background = useMotionTemplate`radial-gradient(360px circle at ${mx}px ${my}px, ${spotColor}, transparent 70%)`;

  return (
    <div
      onMouseMove={onMove}
      className={cn(
        "group/spotlight relative overflow-hidden rounded-2xl bg-white shadow-soft transition-transform border border-slate-100 hover:-translate-y-0.5 hover:shadow-soft-lg",
        className
      )}
    >
      <motion.div
        className="absolute inset-0 opacity-0 group-hover/spotlight:opacity-100 transition-opacity duration-500"
        style={{ background }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
