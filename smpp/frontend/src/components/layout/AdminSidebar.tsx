"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users2,
  GitFork,
  MessageSquare,
  Wifi,
  UserCog,
  Zap,
  ChevronRight,
  Server,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    href: "/admin/dashboard",
    description: "Tổng quan",
  },
  {
    icon: Users2,
    label: "Đối tác",
    href: "/admin/partners",
    description: "Quản lý partner",
  },
  {
    icon: Server,
    label: "Nhà cung cấp",
    href: "/admin/providers",
    description: "SMS & Voice providers",
  },
  {
    icon: GitFork,
    label: "Route",
    href: "/admin/routes",
    description: "Định tuyến",
  },
  {
    icon: MessageSquare,
    label: "Tin nhắn",
    href: "/admin/messages",
    description: "Message log",
  },
  {
    icon: Wifi,
    label: "Sessions",
    href: "/admin/sessions",
    description: "SMPP sessions",
  },
  {
    icon: UserCog,
    label: "Người dùng",
    href: "/admin/users",
    description: "Admin users",
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col"
      style={{
        backgroundColor: "#0a0f23",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-white/5">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-none">VSO Gateway</p>
          <p className="text-indigo-400 text-[10px] mt-0.5 font-medium tracking-wide uppercase">
            Admin Console
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="px-5 py-3">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>System Online</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-3 space-y-0.5">
        <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-widest px-3 mb-2">
          Menu
        </p>
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group",
                isActive
                  ? "bg-indigo-600/15 text-indigo-300"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              )}
            >
              <item.icon
                className={cn(
                  "w-4 h-4 flex-shrink-0 transition-colors",
                  isActive
                    ? "text-indigo-400"
                    : "text-slate-500 group-hover:text-slate-300"
                )}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "font-medium leading-none",
                    isActive ? "text-indigo-200" : ""
                  )}
                >
                  {item.label}
                </p>
                <p className="text-[10px] mt-0.5 text-slate-600 truncate">
                  {item.description}
                </p>
              </div>
              {isActive && (
                <ChevronRight className="w-3 h-3 text-indigo-500 flex-shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/5">
        <p className="text-[10px] text-slate-600">SMS & Voice OTP Platform</p>
        <p className="text-[10px] text-slate-700">v0.1.0-phase-2</p>
      </div>
    </aside>
  );
}
