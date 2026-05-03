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
import { motion } from "motion/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  Activity,
  RefreshCw,
  TrendingUp,
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
      return { from: subHours(now, 24), to: now, granularity: "hour" as const };
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

  const { data: overview, refetch: refetchOverview } = useQuery<StatsOverview>({
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
  const inFlight =
    (overview?.RECEIVED ?? 0) +
    (overview?.ROUTED ?? 0) +
    (overview?.SUBMITTED ?? 0);
  const deliveryRate = total > 0 ? (delivered / total) * 100 : 0;

  const kpiCards = [
    {
      title: "Tổng tin nhắn",
      value: total,
      icon: MessageSquare,
      gradient: "from-indigo-500 via-violet-500 to-purple-600",
      glow: "shadow-indigo-500/30",
      spot: "rgba(99, 102, 241, 0.18)",
      sub: "Tất cả trạng thái",
      format: { useGrouping: true } as const,
    },
    {
      title: "Tỉ lệ thành công",
      value: deliveryRate,
      icon: CheckCircle2,
      gradient: "from-emerald-500 via-teal-500 to-cyan-600",
      glow: "shadow-emerald-500/30",
      spot: "rgba(16, 185, 129, 0.18)",
      sub: `${delivered.toLocaleString("vi-VN")} delivered`,
      format: { style: "percent", maximumFractionDigits: 1 } as const,
      transform: (v: number) => v / 100,
    },
    {
      title: "Thất bại",
      value: failed,
      icon: XCircle,
      gradient: "from-rose-500 via-red-500 to-orange-600",
      glow: "shadow-rose-500/30",
      spot: "rgba(244, 63, 94, 0.18)",
      sub: "Cần kiểm tra",
      format: { useGrouping: true } as const,
    },
    {
      title: "Đang xử lý",
      value: inFlight,
      icon: Activity,
      gradient: "from-amber-500 via-orange-500 to-red-600",
      glow: "shadow-amber-500/30",
      spot: "rgba(245, 158, 11, 0.18)",
      sub: "In-flight",
      format: { useGrouping: true } as const,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero — bright gradient */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-2xl p-6 md:p-8 ring-1 ring-indigo-100"
        style={{
          background:
            "linear-gradient(135deg, #eef2ff 0%, #f5f3ff 30%, #ecfeff 70%, #fef3c7 100%)",
        }}
      >
        {/* Soft animated blobs */}
        <motion.div
          className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-indigo-300/40 blur-3xl"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-32 -left-24 w-72 h-72 rounded-full bg-violet-300/40 blur-3xl"
          animate={{ x: [0, -20, 30, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/3 right-1/3 w-60 h-60 rounded-full bg-cyan-200/40 blur-3xl"
          animate={{ x: [0, 20, -15, 0], y: [0, 15, -10, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-indigo-200/60 backdrop-blur mb-3"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500" />
              </span>
              <TrendingUp className="w-3 h-3 text-indigo-600" />
              <span className="text-[11px] font-semibold text-indigo-700 tracking-wide">
                Bảng điều khiển trực tiếp
              </span>
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight"
            >
              Chào mừng trở lại,{" "}
              <span className="text-brand-gradient">Admin</span> 👋
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="text-slate-600 mt-1.5 text-sm max-w-xl"
            >
              Theo dõi sản lượng tin nhắn, tỉ lệ thành công và sự cố trên toàn
              bộ partner trong thời gian thực.
            </motion.p>
          </div>
          <Button
            variant="ghost"
            className="h-9 text-slate-700 hover:text-slate-900 hover:bg-white/70 border border-slate-200/80 bg-white/50 backdrop-blur"
            onClick={() => refetchOverview()}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-2" /> Làm mới
          </Button>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card, idx) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 + idx * 0.06 }}
          >
            <SpotlightCard className="p-0" spotColor={card.spot}>
              <div
                className={cn(
                  "absolute top-0 left-0 right-0 h-1 bg-gradient-to-r",
                  card.gradient
                )}
              />
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                      {card.title}
                    </p>
                    <p className="text-3xl font-bold text-slate-900 mt-1.5 tracking-tight tabular-nums">
                      <AnimatedCounter
                        value={
                          card.transform ? card.transform(card.value) : card.value
                        }
                        format={card.format}
                      />
                    </p>
                    <p className="text-xs text-slate-400 mt-1">{card.sub}</p>
                  </div>
                  <motion.div
                    whileHover={{ scale: 1.08, rotate: 6 }}
                    transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    className={cn(
                      "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br shadow-lg",
                      card.gradient,
                      card.glow
                    )}
                  >
                    <card.icon
                      className="w-5 h-5 text-white"
                      strokeWidth={2.25}
                    />
                  </motion.div>
                </div>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>

      {/* Chart */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.35 }}
      >
        <Card className="bg-white shadow-soft border-slate-100 ring-0">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-5 rounded-full bg-brand-gradient" />
                <CardTitle className="text-base font-bold text-slate-900 tracking-tight">
                  Sản lượng tin nhắn
                </CardTitle>
              </div>
              <div className="flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/60 relative">
                {RANGES.map((r) => {
                  const active = range === r.key;
                  return (
                    <button
                      key={r.key}
                      onClick={() => setRange(r.key)}
                      className={cn(
                        "relative px-3 py-1.5 text-xs font-semibold rounded-lg z-10 transition-colors",
                        active ? "text-indigo-700" : "text-slate-500 hover:text-slate-900"
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="range-pill"
                          className="absolute inset-0 bg-white rounded-lg shadow-sm"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10">{r.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {tsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorDelivered" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSubmitted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
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
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 10px 40px -10px rgba(15, 23, 42, 0.15)",
                      fontSize: 12,
                    }}
                    labelStyle={{ fontWeight: 700, color: "#1e293b" }}
                  />
                  <Legend iconType="circle" iconSize={8} />
                  <Area
                    type="monotone"
                    dataKey="DELIVERED"
                    name="Thành công"
                    stroke="#10b981"
                    fill="url(#colorDelivered)"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="SUBMITTED"
                    name="Đã gửi"
                    stroke="#6366f1"
                    fill="url(#colorSubmitted)"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="FAILED"
                    name="Thất bại"
                    stroke="#ef4444"
                    fill="url(#colorFailed)"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Messages */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.45 }}
      >
        <Card className="bg-white shadow-soft border-slate-100 ring-0">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-brand-gradient" />
              <CardTitle className="text-base font-bold text-slate-900 tracking-tight">
                Tin nhắn gần đây
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                      ID
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                      Nguồn
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                      Đích
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                      Trạng thái
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                      Thời gian
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentMessages?.items?.map((msg, idx) => (
                    <motion.tr
                      key={msg.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: idx * 0.03 }}
                      className="hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="px-6 py-3.5">
                        <code className="text-xs text-slate-500 font-mono">
                          {msg.id.slice(0, 8)}…
                        </code>
                      </td>
                      <td className="px-4 py-3.5 font-medium text-slate-900">
                        {msg.source_addr}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        {msg.dest_addr}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={msg.state} />
                      </td>
                      <td className="px-4 py-3.5 text-slate-400 text-xs tabular-nums">
                        {msg.created_at
                          ? format(new Date(msg.created_at), "dd/MM HH:mm", {
                              locale: vi,
                            })
                          : "-"}
                      </td>
                    </motion.tr>
                  ))}
                  {(!recentMessages?.items ||
                    recentMessages.items.length === 0) && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-12 text-center text-slate-400 text-sm"
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
      </motion.div>
    </div>
  );
}
