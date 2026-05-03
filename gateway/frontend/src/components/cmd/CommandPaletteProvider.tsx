"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";

type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };
const CommandPaletteCtx = createContext<Ctx | null>(null);

export function useCommandPalette() {
  const v = useContext(CommandPaletteCtx);
  if (!v) throw new Error("useCommandPalette outside provider");
  return v;
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <CommandPaletteCtx.Provider
      value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}
    >
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </CommandPaletteCtx.Provider>
  );
}
