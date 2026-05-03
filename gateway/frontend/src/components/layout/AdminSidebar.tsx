"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  LayoutDashboard,
  Users2,
  GitFork,
  MessageSquare,
  Wifi,
  UserCog,
  Zap,
  Server,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard",     href: "/admin/dashboard", description: "Tổng quan" },
  { icon: Users2,          label: "Đối tác",       href: "/admin/partners",  description: "Quản lý partner" },
  { icon: Server,          label: "Nhà cung cấp",  href: "/admin/providers", description: "SMS & Voice providers" },
  { icon: GitFork,         label: "Route",         href: "/admin/routes",    description: "Định tuyến" },
  { icon: MessageSquare,   label: "Tin nhắn",      href: "/admin/messages",  description: "Message log" },
  { icon: Wifi,            label: "Sessions",      href: "/admin/sessions",  description: "SMPP sessions" },
  { icon: UserCog,         label: "Người dùng",   href: "/admin/users",     description: "Admin users" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-sidebar-deep relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-dark opacity-30 pointer-events-none" />

      {/* Logo */}
      <div className="relative h-16 flex items-center gap-3 px-5 border-b border-white/5">
        <motion.div
          className="relative w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand-glow"
          whileHover={{ rotate: [0, -5, 5, -3, 3, 0], scale: 1.05 }}
          transition={{ duration: 0.5 }}
        >
          <Zap className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
          <div className="absolute inset-0 rounded-xl ring-1 ring-white/20" />
        </motion.div>
        <div>
          <p className="text-white font-bold text-sm leading-none tracking-tight">
            VOSB Gateway
          </p>
          <p className="text-[10px] mt-1 font-semibold tracking-[0.18em] uppercase text-brand-gradient">
            Admin Console
          </p>
        </div>
      </div>

      {/* Status pill */}
      <div className="relative px-5 py-3">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[10px] font-medium text-emerald-300 tracking-wide">
            System Online
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 px-3 pb-3 space-y-1">
        <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-[0.2em] px-3 mb-2 mt-1">
          Quản trị
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
                  isActive
                    ? "text-white"
                    : "text-slate-400 hover:text-slate-100"
                )}
              >
                {/* Smooth shared layout active background */}
                {isActive && (
                  <motion.span
                    layoutId="admin-active-bg"
                    className="absolute inset-0 rounded-xl bg-white/[0.06] shadow-lg shadow-indigo-900/30 ring-1 ring-white/5"
                    transition={{
                      type: "spring",
                      stiffness: 380,
                      damping: 30,
                    }}
                  />
                )}
                {isActive && (
                  <motion.span
                    layoutId="admin-active-bar"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-brand-gradient shadow-brand-glow"
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
                      ? "bg-brand-gradient shadow-brand-glow"
                      : "bg-white/5 group-hover:bg-white/10"
                  )}
                >
                  <item.icon
                    className={cn(
                      "w-4 h-4 transition-colors",
                      isActive
                        ? "text-white"
                        : "text-slate-400 group-hover:text-slate-100"
                    )}
                    strokeWidth={2}
                  />
                </div>
                <div className="relative flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-semibold leading-none tracking-tight",
                      isActive ? "text-white" : ""
                    )}
                  >
                    {item.label}
                  </p>
                  <p className="text-[10px] mt-1 text-slate-500 truncate">
                    {item.description}
                  </p>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="relative px-5 py-4 border-t border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-gradient" />
          <p className="text-[10px] text-slate-500 font-medium">
            SMS &amp; Voice OTP Platform
          </p>
        </div>
        <p className="text-[10px] text-slate-700 mt-1 font-mono">
          v0.1.0-phase-2
        </p>
      </div>
    </aside>
  );
}
