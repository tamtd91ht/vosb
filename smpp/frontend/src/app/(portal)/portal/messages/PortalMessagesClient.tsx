"use client";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import Link from "next/link";
import { PageResponse, Message } from "@/lib/types";

const MESSAGE_STATES = ["RECEIVED", "ROUTED", "SUBMITTED", "DELIVERED", "FAILED"];

export function PortalMessagesClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const [page, setPage] = useState(0);
  const [state, setState] = useState("");
  const [destAddr, setDestAddr] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const query: Record<string, string> = { page: String(page), size: "20" };
  if (state) query.state = state;
  if (destAddr) query.dest_addr = destAddr;

  const { data, isLoading } = useQuery<PageResponse<Message>>({
    queryKey: ["portal", "messages", page, state, destAddr],
    queryFn: () => apiClient(token, "/api/portal/messages", { query }),
    enabled: !!token,
  });

  const totalPages = data ? Math.ceil(data.total / 20) : 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card className="border border-slate-100 shadow-sm bg-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-40">
              <label className="text-xs text-slate-500 mb-1.5 block">Trạng thái</label>
              <Select value={state || "ALL"} onValueChange={(v: string | null) => { setState(v === "ALL" || !v ? "" : v); setPage(0); }}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Tất cả" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả</SelectItem>
                  {MESSAGE_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-48">
              <label className="text-xs text-slate-500 mb-1.5 block">Số điện thoại đích</label>
              <div className="flex gap-2">
                <Input
                  className="h-9 text-sm"
                  placeholder="84901234567"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setDestAddr(searchInput); setPage(0); } }}
                />
                <Button size="sm" variant="outline" className="h-9 px-3"
                  onClick={() => { setDestAddr(searchInput); setPage(0); }}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border border-slate-100 shadow-sm bg-white">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Đích</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Nội dung</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Trạng thái</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Thời gian</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : data?.items?.map((msg) => (
                  <tr key={msg.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <code className="text-xs text-slate-400 font-mono">{msg.id.slice(0, 8)}…</code>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{msg.dest_addr}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{msg.content}</td>
                    <td className="px-4 py-3"><StatusBadge status={msg.state} /></td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {msg.created_at ? format(new Date(msg.created_at), "dd/MM HH:mm", { locale: vi }) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/portal/messages/${msg.id}`}>
                        <Button variant="ghost" size="icon" className="w-8 h-8 text-slate-400 hover:text-slate-800">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
                {!isLoading && (!data?.items || data.items.length === 0) && (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Không có tin nhắn nào</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
              <p className="text-xs text-slate-400">
                Trang {page + 1} / {totalPages} — {data?.total?.toLocaleString("vi-VN")} tin
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="w-8 h-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
