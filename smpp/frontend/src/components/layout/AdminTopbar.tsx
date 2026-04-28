"use client";
import { signOut } from "next-auth/react";
import { Bell, LogOut, User, Settings, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

type Props = { session: { user?: { name?: string | null } } | null };

export function AdminTopbar({ session }: Props) {
  const username = session?.user?.name ?? "Admin";
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-gray-100 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-indigo-600" />
        <span className="text-sm font-semibold text-gray-900">
          Admin Console
        </span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="w-9 h-9 rounded-lg text-gray-500 hover:text-gray-900"
        >
          <Bell className="w-4 h-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 h-9 pl-2 pr-3 rounded-lg hover:bg-gray-100 transition-colors outline-none">
            <Avatar className="w-7 h-7">
              <AvatarFallback className="bg-indigo-600 text-white text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium text-gray-700">
              {username}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="px-2 py-1.5">
              <p className="text-xs text-muted-foreground">
                Đăng nhập với tư cách
              </p>
              <p className="text-sm font-medium">{username}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="w-4 h-4 mr-2" /> Hồ sơ
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="w-4 h-4 mr-2" /> Cài đặt
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600"
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
