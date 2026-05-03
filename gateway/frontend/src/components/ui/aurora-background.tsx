"use client";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

type Props = {
  className?: string;
  intensity?: "subtle" | "normal" | "vivid";
};

/**
 * Aurora animated mesh-gradient background.
 * Pure CSS / SVG-free. Uses motion to drift the orbs slightly so it never feels static.
 */
export function AuroraBackground({ className, intensity = "normal" }: Props) {
  const opacity =
    intensity === "subtle" ? 0.35 : intensity === "vivid" ? 0.9 : 0.55;
  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden pointer-events-none",
        className
      )}
      aria-hidden
    >
      <motion.div
        className="absolute -top-1/4 -left-1/4 h-[60vw] w-[60vw] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(99,102,241,1), transparent)",
          opacity,
        }}
        animate={{
          x: [0, 80, -40, 0],
          y: [0, -60, 40, 0],
          scale: [1, 1.05, 0.95, 1],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute top-1/3 -right-1/4 h-[55vw] w-[55vw] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(139,92,246,1), transparent)",
          opacity,
        }}
        animate={{
          x: [0, -60, 40, 0],
          y: [0, 80, -40, 0],
          scale: [1, 0.95, 1.08, 1],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute -bottom-1/4 left-1/3 h-[55vw] w-[55vw] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(6,182,212,1), transparent)",
          opacity: opacity * 0.85,
        }}
        animate={{
          x: [0, 60, -40, 0],
          y: [0, -40, 60, 0],
          scale: [1, 1.06, 0.96, 1],
        }}
        transition={{
          duration: 24,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
    </div>
  );
}
