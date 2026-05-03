"use client";
import NumberFlow, { type Format } from "@number-flow/react";

type Props = {
  value: number;
  format?: Format;
  className?: string;
  suffix?: string;
  prefix?: string;
};

/**
 * Smooth digit-by-digit animated counter (number-flow).
 * Use for KPI values, percentages, balances.
 */
export function AnimatedCounter({
  value,
  format = { useGrouping: true },
  className,
  suffix,
  prefix,
}: Props) {
  return (
    <span className={className}>
      {prefix}
      <NumberFlow value={value} format={format} />
      {suffix}
    </span>
  );
}
