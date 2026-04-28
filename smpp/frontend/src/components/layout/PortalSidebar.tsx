"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Key,
  Server,
  Link2,
  BookOpen,
  Zap,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: LayoutDashboard, label: "Tổng quan",     href: "/portal/overview",       description: "Dashboard" },
  { icon: MessageSquare,   label: "Tin nhắn",       href: "/portal/messages",       description: "Message log" },
  { icon: Key,             label: "API Keys",        href: "/portal/api-keys",       description: "Quản lý key" },
  { icon: Server,          label: "SMPP Accounts",  href: "/portal/smpp-accounts",  description: "Kết nối SMPP" },
  { icon: Link2,           label: "Webhook DLR",    href: "/portal/webhook",        description: "Cấu hình callback" },
  { icon: BookOpen,        label: "Tài liệu",       href: "/portal/docs",           description: "API guide" },
];

export function PortalSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-white border-r border-slate-100 shadow-sm">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-100">
        <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center shadow-lg shadow-sky-200">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-slate-900 font-bold text-sm leading-none">TKC Gateway</p>
          <p className="text-sky-600 text-[10px] mt-0.5 font-medium tracking-wide uppercase">
            Partner Portal
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="px-5 py-3">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Gateway Online</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-3 space-y-0.5">
        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest px-3 mb-2">
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
                  ? "bg-sky-50 text-sky-700"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              <item.icon
                className={cn(
                  "w-4 h-4 flex-shrink-0 transition-colors",
                  isActive ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"
                )}
              />
              <div className="flex-1 min-w-0">
                <p className={cn("font-medium leading-none", isActive ? "text-sky-700" : "")}>
                  {item.label}
                </p>
                <p className="text-[10px] mt-0.5 text-slate-400 truncate">{item.description}</p>
              </div>
              {isActive && <ChevronRight className="w-3 h-3 text-sky-400 flex-shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100">
        <p className="text-[10px] text-slate-400">SMS & Voice OTP Platform</p>
        <p className="text-[10px] text-slate-300">v0.1.0-phase-2</p>
      </div>
    </aside>
  );
}
