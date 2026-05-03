"use client";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark" | "system";
const MODES: { key: Mode; icon: typeof Sun; label: string }[] = [
  { key: "light", icon: Sun, label: "Sáng" },
  { key: "system", icon: Monitor, label: "Hệ thống" },
  { key: "dark", icon: Moon, label: "Tối" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="h-8 w-24 rounded-full bg-slate-100/70" />;
  }
  return (
    <div className="inline-flex items-center p-0.5 rounded-full bg-slate-100/70 border border-slate-200/60">
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = theme === m.key;
        return (
          <button
            key={m.key}
            onClick={() => setTheme(m.key)}
            className={cn(
              "relative w-8 h-7 rounded-full flex items-center justify-center transition-all",
              active
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
            aria-label={m.label}
            title={m.label}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
