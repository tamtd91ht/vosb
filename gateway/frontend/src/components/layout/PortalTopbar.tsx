"use client";
import { signOut } from "next-auth/react";
import {
  LogOut,
  User,
  Settings,
  ChevronDown,
  Search,
  Command as CommandIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useCommandPalette } from "@/components/cmd/CommandPaletteProvider";

type Props = { session: { user?: { name?: string | null } } | null };

export function PortalTopbar({ session }: Props) {
  const username = session?.user?.name ?? "Partner";
  const initials = username.slice(0, 2).toUpperCase();
  const cmd = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-6 glass-strong border-b border-slate-200/60 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-sky-50 to-cyan-50 border border-sky-100">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-500" />
          </span>
          <span className="text-xs font-semibold text-sky-700 tracking-tight">
            Partner Portal
          </span>
        </div>

        <button
          type="button"
          onClick={cmd.toggle}
          className="hidden lg:flex items-center gap-2 h-9 pl-3 pr-2 rounded-lg bg-slate-100/70 hover:bg-slate-100 border border-slate-200/60 transition-colors text-slate-500 hover:text-slate-700 text-xs w-72"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">Tìm trang, lệnh…</span>
          <kbd className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-500">
            <CommandIcon className="w-2.5 h-2.5" /> K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-lg hover:bg-slate-100 transition-colors outline-none">
            <div className="relative">
              <Avatar className="w-7 h-7 ring-2 ring-white">
                <AvatarFallback className="bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-600 text-white text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
            </div>
            <span className="text-sm font-semibold text-slate-700 max-w-[140px] truncate">
              {username}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Đăng nhập với tư cách
              </p>
              <p className="text-sm font-semibold mt-0.5">{username}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer">
              <User className="w-4 h-4 mr-2" /> Hồ sơ
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer">
              <Settings className="w-4 h-4 mr-2" /> Cài đặt
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600 cursor-pointer focus:text-red-700 focus:bg-red-50"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="w-4 h-4 mr-2" /> Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
