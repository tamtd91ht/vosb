"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutDashboard,
  Users2,
  Server,
  GitFork,
  MessageSquare,
  Wifi,
  UserCog,
  Key,
  Link2,
  BookOpen,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Search,
  ArrowRight,
} from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import { useEffect } from "react";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

const adminCommands = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/admin/dashboard", group: "Navigate", keywords: "tổng quan home" },
  { icon: Users2, label: "Đối tác", href: "/admin/partners", group: "Navigate", keywords: "partner customer" },
  { icon: Server, label: "Nhà cung cấp", href: "/admin/providers", group: "Navigate", keywords: "channel provider" },
  { icon: GitFork, label: "Route", href: "/admin/routes", group: "Navigate", keywords: "routing định tuyến" },
  { icon: MessageSquare, label: "Tin nhắn", href: "/admin/messages", group: "Navigate", keywords: "messages log" },
  { icon: Wifi, label: "Sessions", href: "/admin/sessions", group: "Navigate", keywords: "smpp session" },
  { icon: UserCog, label: "Người dùng", href: "/admin/users", group: "Navigate", keywords: "admin user" },
];

const portalCommands = [
  { icon: LayoutDashboard, label: "Tổng quan", href: "/portal/overview", group: "Navigate", keywords: "dashboard home" },
  { icon: MessageSquare, label: "Tin nhắn", href: "/portal/messages", group: "Navigate", keywords: "messages" },
  { icon: Key, label: "API Keys", href: "/portal/api-keys", group: "Navigate", keywords: "api key token" },
  { icon: Server, label: "SMPP Accounts", href: "/portal/smpp-accounts", group: "Navigate", keywords: "smpp" },
  { icon: Link2, label: "Webhook DLR", href: "/portal/webhook", group: "Navigate", keywords: "webhook callback" },
  { icon: BookOpen, label: "Tài liệu", href: "/portal/docs", group: "Navigate", keywords: "docs guide" },
];

export function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const role = session?.user?.role as string | undefined;
  const { setTheme } = useTheme();

  const navItems =
    role === "ADMIN" ? adminCommands : role === "PARTNER" ? portalCommands : [];

  const run = (fn: () => void) => {
    onOpenChange(false);
    setTimeout(fn, 50);
  };

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-xl"
          >
            <Command
              label="Command Menu"
              className="rounded-2xl bg-white shadow-2xl shadow-indigo-500/10 ring-1 ring-slate-900/10 overflow-hidden"
              loop
            >
              {/* Input row */}
              <div className="flex items-center gap-3 px-4 border-b border-slate-100">
                <Search className="w-4 h-4 text-slate-400" />
                <Command.Input
                  placeholder="Tìm trang, hành động, lệnh…"
                  className="flex-1 h-12 bg-transparent outline-none text-sm placeholder:text-slate-400"
                />
                <kbd className="hidden md:inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-500">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                <Command.Empty className="py-10 text-center text-sm text-slate-400">
                  Không có kết quả.
                </Command.Empty>

                {navItems.length > 0 && (
                  <Command.Group
                    heading="Điều hướng"
                    className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 px-2 py-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {navItems.map((it) => (
                      <Command.Item
                        key={it.href}
                        value={`${it.label} ${it.keywords}`}
                        onSelect={() => run(() => router.push(it.href))}
                        className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer text-sm text-slate-700 data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-900 transition-colors group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 group-data-[selected=true]:bg-brand-gradient flex items-center justify-center transition-colors">
                          <it.icon className="w-4 h-4 text-slate-500 group-data-[selected=true]:text-white" />
                        </div>
                        <span className="flex-1 font-medium">{it.label}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-data-[selected=true]:text-indigo-500" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group
                  heading="Theme"
                  className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 px-2 py-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  <Command.Item
                    value="theme light sáng"
                    onSelect={() => run(() => setTheme("light"))}
                    className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer text-sm text-slate-700 data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-900 transition-colors"
                  >
                    <Sun className="w-4 h-4 text-amber-500" />
                    <span>Chế độ sáng</span>
                  </Command.Item>
                  <Command.Item
                    value="theme dark tối"
                    onSelect={() => run(() => setTheme("dark"))}
                    className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer text-sm text-slate-700 data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-900 transition-colors"
                  >
                    <Moon className="w-4 h-4 text-indigo-500" />
                    <span>Chế độ tối</span>
                  </Command.Item>
                  <Command.Item
                    value="theme system hệ thống"
                    onSelect={() => run(() => setTheme("system"))}
                    className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer text-sm text-slate-700 data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-900 transition-colors"
                  >
                    <Monitor className="w-4 h-4 text-slate-500" />
                    <span>Theo hệ thống</span>
                  </Command.Item>
                </Command.Group>

                <Command.Group
                  heading="Tài khoản"
                  className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 px-2 py-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  <Command.Item
                    value="logout đăng xuất signout"
                    onSelect={() =>
                      run(() => signOut({ callbackUrl: "/login" }))
                    }
                    className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer text-sm text-rose-600 data-[selected=true]:bg-rose-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Đăng xuất</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>

              {/* Footer hint */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 text-[10px] text-slate-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200">↑↓</kbd>
                    di chuyển
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200">↵</kbd>
                    chọn
                  </span>
                </div>
                <span className="font-mono text-slate-400">VOSB Gateway</span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
