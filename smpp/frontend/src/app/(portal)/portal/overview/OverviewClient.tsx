"use client";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Wallet, MessageSquare, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import Link from "next/link";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface Overview {
  partner_name: string;
  balance: number;
  total: number;
  delivered: number;
  failed: number;
  delivery_rate: number;
  stats: Record<string, number>;
}

interface Message {
  id: string; dest_addr: string; state: string; created_at: string;
}

export function OverviewClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;

  const { data: overview, isLoading } = useQuery<Overview>({
    queryKey: ["portal", "overview"],
    queryFn: () => apiClient(token, "/api/portal/overview"),
    refetchInterval: 60_000,
    enabled: !!token,
  });

  const { data: recentMessages } = useQuery<{ items: Message[] }>({
    queryKey: ["portal", "messages", "recent"],
    queryFn: () => apiClient(token, "/api/portal/messages", { query: { page: "0", size: "6" } }),
    refetchInterval: 60_000,
    enabled: !!token,
  });

  const kpiCards = [
    {
      title: "Số dư",
      value: overview ? `${overview.balance.toLocaleString("vi-VN")} VNĐ` : "—",
      icon: Wallet,
      color: "text-sky-600",
      bg: "bg-sky-50",
      sub: "Tài khoản: " + (overview?.partner_name ?? "—"),
    },
    {
      title: "Tổng tin nhắn",
      value: overview ? overview.total.toLocaleString("vi-VN") : "—",
      icon: MessageSquare,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      sub: "Tất cả trạng thái",
    },
    {
      title: "Tỉ lệ thành công",
      value: overview ? `${overview.delivery_rate}%` : "—",
      icon: CheckCircle2,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      sub: `${overview?.delivered?.toLocaleString("vi-VN") ?? 0} delivered`,
    },
    {
      title: "Thất bại",
      value: overview ? overview.failed.toLocaleString("vi-VN") : "—",
      icon: XCircle,
      color: "text-red-500",
      bg: "bg-red-50",
      sub: "Cần kiểm tra",
    },
  ];

  // Build simple chart data from stats
  const chartData = overview
    ? Object.entries(overview.stats).map(([state, count]) => ({ state, count }))
    : [];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.title} className="border border-slate-100 shadow-sm bg-white">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                    {card.title}
                  </p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-24 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold text-slate-900 mt-1">{card.value}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1 truncate">{card.sub}</p>
                </div>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", card.bg)}>
                  <card.icon className={cn("w-5 h-5", card.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* State breakdown bar chart */}
        <Card className="border border-slate-100 shadow-sm bg-white lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-800">Phân bổ trạng thái</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : chartData.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">Chưa có dữ liệu</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -30, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="state" tick={{ fontSize: 9, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" name="Số lượng" stroke="#0284c7" fill="#e0f2fe" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent messages */}
        <Card className="border border-slate-100 shadow-sm bg-white lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-800">Tin nhắn gần đây</CardTitle>
              <Link href="/portal/messages" className="text-xs text-sky-600 hover:underline">
                Xem tất cả →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Đích</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Trạng thái</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentMessages?.items?.map((msg) => (
                  <tr key={msg.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{msg.dest_addr}</td>
                    <td className="px-4 py-3"><StatusBadge status={msg.state} /></td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {msg.created_at ? format(new Date(msg.created_at), "dd/MM HH:mm", { locale: vi }) : "—"}
                    </td>
                  </tr>
                ))}
                {(!recentMessages?.items || recentMessages.items.length === 0) && (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-400 text-sm">Chưa có tin nhắn nào</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
