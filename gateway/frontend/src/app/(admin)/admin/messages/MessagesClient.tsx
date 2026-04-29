"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { Loader2, Search, MessageSquare, ExternalLink } from "lucide-react";
import Link from "next/link";
import { apiClient } from "@/lib/api";
import { Message, MessageState, PageResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "RECEIVED", label: "Nhận" },
  { value: "ROUTED", label: "Định tuyến" },
  { value: "SUBMITTED", label: "Đã gửi" },
  { value: "DELIVERED", label: "Thành công" },
  { value: "FAILED", label: "Thất bại" },
];

export function MessagesClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;

  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({
    partner_id: "",
    state: "",
    dest_addr: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const { data, isLoading } = useQuery<PageResponse<Message>>({
    queryKey: ["messages", page, appliedFilters],
    queryFn: () =>
      apiClient(token, "/api/admin/messages", {
        query: {
          page,
          size: 20,
          ...(appliedFilters.partner_id
            ? { partner_id: appliedFilters.partner_id }
            : {}),
          ...(appliedFilters.state ? { state: appliedFilters.state } : {}),
          ...(appliedFilters.dest_addr
            ? { dest_addr: appliedFilters.dest_addr }
            : {}),
        },
      }),
    enabled: !!token,
  });

  const messages = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const handleSearch = () => {
    setPage(0);
    setAppliedFilters(filters);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px] space-y-1">
              <label className="text-xs text-gray-500">Partner ID</label>
              <Input
                placeholder="VD: 1"
                value={filters.partner_id}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, partner_id: e.target.value }))
                }
              />
            </div>
            <div className="w-48 space-y-1">
              <label className="text-xs text-gray-500">Trạng thái</label>
              <Select
                value={filters.state}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, state: v === "ALL" ? "" : (v ?? "") }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Tất cả" />
                </SelectTrigger>
                <SelectContent>
                  {STATE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || "ALL"} value={opt.value || "ALL"}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[160px] space-y-1">
              <label className="text-xs text-gray-500">Số điện thoại đích</label>
              <Input
                placeholder="VD: 84912..."
                value={filters.dest_addr}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dest_addr: e.target.value }))
                }
              />
            </div>
            <Button
              onClick={handleSearch}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Search className="w-4 h-4 mr-2" />
              Tìm kiếm
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="Không có tin nhắn"
              description="Thử thay đổi bộ lọc để tìm kiếm kết quả khác"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ID</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nguồn</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Đích</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nội dung</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Trạng thái</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Qua</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Thời gian</th>
                    <th className="text-right px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {messages.map((msg) => (
                    <tr key={msg.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3">
                        <code className="text-xs text-gray-500 font-mono">
                          {msg.id.slice(0, 8)}...
                        </code>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {msg.source_addr}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{msg.dest_addr}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                        {msg.content.slice(0, 40)}
                        {msg.content.length > 40 ? "..." : ""}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={msg.state} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className="text-xs text-gray-600 border-gray-200"
                        >
                          {msg.inbound_via}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {msg.created_at
                          ? format(new Date(msg.created_at), "dd/MM HH:mm:ss", {
                              locale: vi,
                            })
                          : "-"}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <Link href={`/admin/messages/${msg.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                Tổng {total.toLocaleString("vi-VN")} tin nhắn
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Trước
                </Button>
                <Badge variant="outline" className="px-2.5 h-7 rounded-lg">
                  {page + 1} / {totalPages}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Sau
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
