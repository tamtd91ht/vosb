"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  LayoutDashboard,
  MessageSquare,
  Key,
  Server,
  Link2,
  BookOpen,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: LayoutDashboard, label: "Tổng quan",     href: "/portal/overview",       description: "Dashboard" },
  { icon: MessageSquare,   label: "Tin nhắn",      href: "/portal/messages",       description: "Message log" },
  { icon: Key,             label: "API Keys",      href: "/portal/api-keys",       description: "Quản lý key" },
  { icon: Server,          label: "SMPP Accounts", href: "/portal/smpp-accounts",  description: "Kết nối SMPP" },
  { icon: Link2,           label: "Webhook DLR",   href: "/portal/webhook",        description: "Cấu hình callback" },
  { icon: BookOpen,        label: "Tài liệu",      href: "/portal/docs",           description: "API guide" },
];

export function PortalSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-white border-r border-slate-100 relative">
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-sky-50/80 to-transparent pointer-events-none" />

      {/* Logo */}
      <div className="relative h-16 flex items-center gap-3 px-5 border-b border-slate-100">
        <motion.div
          className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-200/60"
          whileHover={{ rotate: [0, -5, 5, -3, 3, 0], scale: 1.05 }}
          transition={{ duration: 0.5 }}
        >
          <Zap className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
          <div className="absolute inset-0 rounded-xl ring-1 ring-white/30" />
        </motion.div>
        <div>
          <p className="text-slate-900 font-bold text-sm leading-none tracking-tight">
            VOSB Gateway
          </p>
          <p className="text-[10px] mt-1 font-semibold tracking-[0.18em] uppercase bg-gradient-to-r from-sky-600 to-cyan-600 bg-clip-text text-transparent">
            Partner Portal
          </p>
        </div>
      </div>

      {/* Status pill */}
      <div className="relative px-5 py-3">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/60">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[10px] font-medium text-emerald-700 tracking-wide">
            Gateway Online
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 px-3 pb-3 space-y-1">
        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-[0.2em] px-3 mb-2 mt-1">
          Menu
        </p>
        {navItems.map((item, idx) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <motion.div
              key={item.href}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.25 }}
            >
              <Link
                href={item.href}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-200 group",
                  isActive ? "text-sky-900" : "text-slate-500 hover:text-slate-900"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="portal-active-bg"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-sky-50 to-cyan-50 ring-1 ring-sky-100"
                    transition={{
                      type: "spring",
                      stiffness: 380,
                      damping: 30,
                    }}
                  />
                )}
                {isActive && (
                  <motion.span
                    layoutId="portal-active-bar"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-gradient-to-b from-sky-500 to-cyan-500"
                    transition={{
                      type: "spring",
                      stiffness: 380,
                      damping: 30,
                    }}
                  />
                )}

                <div
                  className={cn(
                    "relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 flex-shrink-0",
                    isActive
                      ? "bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-600 shadow-md shadow-sky-200/60"
                      : "bg-slate-100 group-hover:bg-slate-200"
                  )}
                >
                  <item.icon
                    className={cn(
                      "w-4 h-4 transition-colors",
                      isActive ? "text-white" : "text-slate-500 group-hover:text-slate-700"
                    )}
                    strokeWidth={2}
                  />
                </div>
                <div className="relative flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-semibold leading-none tracking-tight",
                      isActive ? "text-sky-900" : ""
                    )}
                  >
                    {item.label}
                  </p>
                  <p className="text-[10px] mt-1 text-slate-400 truncate">
                    {item.description}
                  </p>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="relative px-5 py-4 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-sky-500 to-cyan-500" />
          <p className="text-[10px] text-slate-500 font-medium">
            SMS &amp; Voice OTP Platform
          </p>
        </div>
        <p className="text-[10px] text-slate-400 mt-1 font-mono">
          v0.1.0-phase-2
        </p>
      </div>
    </aside>
  );
}
