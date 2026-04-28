"use client";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import {
  StatsOverview,
  TimeseriesResponse,
  Message,
  PageResponse,
} from "@/lib/types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format, subHours, subDays } from "date-fns";
import { vi } from "date-fns/locale";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  Activity,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RangeKey = "today" | "7d" | "30d";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày" },
  { key: "30d", label: "30 ngày" },
];

function getRange(key: RangeKey) {
  const now = new Date();
  switch (key) {
    case "today":
      return {
        from: subHours(now, 24),
        to: now,
        granularity: "hour" as const,
      };
    case "7d":
      return { from: subDays(now, 7), to: now, granularity: "day" as const };
    case "30d":
      return { from: subDays(now, 30), to: now, granularity: "day" as const };
  }
}

export function DashboardClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const [range, setRange] = useState<RangeKey>("today");
  const { from, to, granularity } = getRange(range);

  const {
    data: overview,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = useQuery<StatsOverview>({
    queryKey: ["stats", "overview"],
    queryFn: () => apiClient(token, "/api/admin/stats/overview"),
    refetchInterval: 60_000,
    enabled: !!token,
  });

  const { data: timeseries, isLoading: tsLoading } =
    useQuery<TimeseriesResponse>({
      queryKey: ["stats", "timeseries", range],
      queryFn: () =>
        apiClient(token, "/api/admin/stats/timeseries", {
          query: {
            granularity,
            from: from.toISOString(),
            to: to.toISOString(),
          },
        }),
      refetchInterval: 60_000,
      enabled: !!token,
    });

  const { data: recentMessages } = useQuery<PageResponse<Message>>({
    queryKey: ["messages", "recent"],
    queryFn: () =>
      apiClient(token, "/api/admin/messages", {
        query: { page: 0, size: 8 },
      }),
    refetchInterval: 60_000,
    enabled: !!token,
  });

  // Transform timeseries for Recharts
  const chartData = (() => {
    if (!timeseries?.series) return [];
    const map = new Map<string, Record<string, number | string>>();
    timeseries.series.forEach(({ bucket, state, count }) => {
      if (!map.has(bucket)) map.set(bucket, { bucket });
      map.get(bucket)![state] = count;
    });
    return Array.from(map.values()).map((row) => ({
      ...row,
      label:
        granularity === "hour"
          ? format(new Date(row.bucket as string), "HH:mm", { locale: vi })
          : format(new Date(row.bucket as string), "dd/MM", { locale: vi }),
    }));
  })();

  const total = overview
    ? Object.values(overview).reduce((a, b) => a + b, 0)
    : 0;
  const delivered = overview?.DELIVERED ?? 0;
  const failed = overview?.FAILED ?? 0;
  const deliveryRate =
    total > 0 ? ((delivered / total) * 100).toFixed(1) : "0.0";

  const kpiCards = [
    {
      title: "Tổng tin nhắn",
      value: total.toLocaleString("vi-VN"),
      icon: MessageSquare,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      sub: "Tất cả trạng thái",
    },
    {
      title: "Tỉ lệ thành công",
      value: `${deliveryRate}%`,
      icon: CheckCircle2,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      sub: `${delivered.toLocaleString("vi-VN")} delivered`,
    },
    {
      title: "Thất bại",
      value: failed.toLocaleString("vi-VN"),
      icon: XCircle,
      color: "text-red-600",
      bg: "bg-red-50",
      sub: "Cần kiểm tra",
    },
    {
      title: "Đang xử lý",
      value: (
        (overview?.RECEIVED ?? 0) +
        (overview?.ROUTED ?? 0) +
        (overview?.SUBMITTED ?? 0)
      ).toLocaleString("vi-VN"),
      icon: Activity,
      color: "text-amber-600",
      bg: "bg-amber-50",
      sub: "In-flight",
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.title} className="border-0 shadow-sm bg-white">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                    {card.title}
                  </p>
                  {overviewLoading ? (
                    <Skeleton className="h-8 w-24 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {card.value}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
                </div>
                <div
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    card.bg
                  )}
                >
                  <card.icon className={cn("w-5 h-5", card.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base font-semibold text-gray-900">
              Sản lượng tin nhắn
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8"
                onClick={() => refetchOverview()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium transition-colors",
                      range === r.key
                        ? "bg-indigo-600 text-white"
                        : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tsLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={chartData}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="colorDelivered"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="#10b981"
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="95%"
                      stopColor="#10b981"
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient
                    id="colorFailed"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="#ef4444"
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="95%"
                      stopColor="#ef4444"
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient
                    id="colorSubmitted"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="#4f46e5"
                      stopOpacity={0.15}
                    />
                    <stop
                      offset="95%"
                      stopColor="#4f46e5"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                  }}
                  labelStyle={{ fontWeight: 600, color: "#1e293b" }}
                />
                <Legend iconType="circle" iconSize={8} />
                <Area
                  type="monotone"
                  dataKey="DELIVERED"
                  name="Thành công"
                  stroke="#10b981"
                  fill="url(#colorDelivered)"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="SUBMITTED"
                  name="Đã gửi"
                  stroke="#4f46e5"
                  fill="url(#colorSubmitted)"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="FAILED"
                  name="Thất bại"
                  stroke="#ef4444"
                  fill="url(#colorFailed)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Recent Messages */}
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-gray-900">
            Tin nhắn gần đây
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    ID
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Nguồn
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Đích
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Trạng thái
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Thời gian
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentMessages?.items?.map((msg) => (
                  <tr
                    key={msg.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-3">
                      <code className="text-xs text-gray-500 font-mono">
                        {msg.id.slice(0, 8)}...
                      </code>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {msg.source_addr}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {msg.dest_addr}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={msg.state} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {msg.created_at
                        ? format(new Date(msg.created_at), "dd/MM HH:mm", {
                            locale: vi,
                          })
                        : "-"}
                    </td>
                  </tr>
                ))}
                {(!recentMessages?.items ||
                  recentMessages.items.length === 0) && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-8 text-center text-gray-400 text-sm"
                    >
                      Chưa có tin nhắn nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
