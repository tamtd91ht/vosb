"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import {
  ArrowLeft,
  Activity,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiClient, ApiError } from "@/lib/api";
import {
  Carrier,
  CarrierInfo,
  Channel,
  ChannelType,
  ChannelStats,
  ChannelRate,
  DeliveryType,
  RateUnit,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { cn } from "@/lib/utils";

// ---- Type badge config ----
const TYPE_LABELS: Record<ChannelType, { label: string; color: string }> = {
  HTTP_THIRD_PARTY: {
    label: "HTTP API",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
  FREESWITCH_ESL: {
    label: "FreeSWITCH ESL",
    color: "bg-violet-100 text-violet-700 border-violet-200",
  },
  TELCO_SMPP: {
    label: "Telco SMPP",
    color: "bg-orange-100 text-orange-700 border-orange-200",
  },
};

const DELIVERY_TYPE_LABELS: Record<string, { label: string; color: string }> =
  {
    SMS: { label: "SMS", color: "bg-blue-100 text-blue-700 border-blue-200" },
    VOICE_OTP: {
      label: "Voice OTP",
      color: "bg-violet-100 text-violet-700 border-violet-200",
    },
  };

const PERIOD_OPTIONS = [
  { label: "Hôm nay", value: "1d" },
  { label: "7 ngày", value: "7d" },
  { label: "30 ngày", value: "30d" },
];

const CARRIER_NAMES: Record<Carrier, string> = {
  VIETTEL: "Viettel",
  MOBIFONE: "MobiFone",
  VINAPHONE: "VinaPhone",
  VIETNAMOBILE: "Vietnamobile",
  GMOBILE: "Gmobile",
  REDDI: "Reddi",
};

// ---- Rate form schema ----
const rateSchema = z.object({
  prefix: z.string().optional(),
  rate: z.coerce.number().min(0, "Phải >= 0"),
  currency: z.enum(["VND", "USD"]),
  unit: z.enum(["MESSAGE", "SECOND", "CALL"]),
  effective_from: z.string().min(1, "Bắt buộc"),
  effective_to: z.string().optional(),
});
type RateFormData = z.infer<typeof rateSchema>;

const UNIT_LABELS: Record<RateUnit, string> = {
  MESSAGE: "Tin nhắn",
  SECOND: "Giây",
  CALL: "Cuộc gọi",
};

export function ProviderDetailClient({ id }: { id: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();
  const router = useRouter();

  const [period, setPeriod] = useState("7d");
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<ChannelRate | null>(null);
  const [deleteRate, setDeleteRate] = useState<ChannelRate | null>(null);
  const [rateMode, setRateMode] = useState<"domestic" | "international">("domestic");
  const [selectedCarrier, setSelectedCarrier] = useState<Carrier | "">("");

  // ---- Edit channel state ----
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDeliveryType, setEditDeliveryType] = useState<DeliveryType>("SMS");
  const [editConfig, setEditConfig] = useState("{}");
  const [editConfigError, setEditConfigError] = useState<string | null>(null);

  // ---- Delete channel state ----
  const [deleteChannelOpen, setDeleteChannelOpen] = useState(false);

  // ---- Queries ----
  const { data: channel, isLoading: channelLoading } = useQuery<Channel>({
    queryKey: ["channel", id],
    queryFn: () => apiClient(token, `/api/admin/channels/${id}`),
    enabled: true,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ChannelStats>({
    queryKey: ["channel", id, "stats", period],
    queryFn: () =>
      apiClient(token, `/api/admin/channels/${id}/stats`, {
        query: { period },
      }),
    enabled: true,
  });

  const { data: rates, isLoading: ratesLoading } = useQuery<ChannelRate[]>({
    queryKey: ["channel", id, "rates"],
    queryFn: () => apiClient(token, `/api/admin/channels/${id}/rates`),
    enabled: true,
  });

  const { data: carriers } = useQuery<CarrierInfo[]>({
    queryKey: ["carriers"],
    queryFn: () => apiClient(token, `/api/admin/carriers`),
    enabled: true,
  });

  // ---- Status toggle ----
  const statusMutation = useMutation({
    mutationFn: (newStatus: string) =>
      apiClient(token, `/api/admin/channels/${id}`, {
        method: "PUT",
        body: { status: newStatus },
      }),
    onSuccess: () => {
      toast.success("Cập nhật trạng thái thành công");
      qc.invalidateQueries({ queryKey: ["channel", id] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  // ---- Edit channel ----
  function openEdit() {
    if (!channel) return;
    setEditName(channel.name);
    setEditDeliveryType(channel.delivery_type);
    setEditConfig(JSON.stringify(channel.config, null, 2));
    setEditConfigError(null);
    setEditOpen(true);
  }

  const editMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, `/api/admin/channels/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      toast.success("Cập nhật kênh thành công");
      qc.invalidateQueries({ queryKey: ["channel", id] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      setEditOpen(false);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  function handleEditSubmit() {
    let parsedConfig;
    try {
      parsedConfig = JSON.parse(editConfig);
    } catch {
      setEditConfigError("Config JSON không hợp lệ");
      return;
    }
    editMutation.mutate({
      name: editName,
      deliveryType: editDeliveryType,
      config: parsedConfig,
    });
  }

  // ---- Test ping ----
  type TestPingResult = {
    reachable?: boolean;
    latency_ms?: number;
    supported?: boolean;
    message?: string;
  };
  const testPingMutation = useMutation<TestPingResult>({
    mutationFn: () =>
      apiClient(token, `/api/admin/channels/${id}/test-ping`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      if (data?.reachable) {
        toast.success(
          `Reachable · ${data.latency_ms ?? 0}ms${
            data.message ? ` — ${data.message}` : ""
          }`
        );
      } else if (data?.reachable === false) {
        toast.error(data?.message ?? "Không kết nối được");
      } else {
        toast.message(data?.message ?? "Đã test", {
          description:
            data?.supported === false
              ? "Test-ping chưa hỗ trợ cho loại kênh này ở phase hiện tại."
              : undefined,
        });
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  // ---- Delete channel ----
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiClient(token, `/api/admin/channels/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Đã xóa kênh");
      qc.invalidateQueries({ queryKey: ["channels"] });
      router.push("/admin/providers");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  // ---- Rate form ----
  const {
    register: regRate,
    handleSubmit: handleRate,
    reset: resetRate,
    setValue: setRateValue,
    formState: { errors: rateErrors, isSubmitting: rateSubmitting },
  } = useForm<RateFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(rateSchema) as any,
    defaultValues: { currency: "VND", unit: "MESSAGE" },
  });

  function openCreateRate() {
    setEditingRate(null);
    setRateMode("domestic");
    setSelectedCarrier("");
    resetRate({ currency: "VND", unit: "MESSAGE" });
    setRateDialogOpen(true);
  }

  function openEditRate(rate: ChannelRate) {
    setEditingRate(rate);
    if (rate.carrier) {
      setRateMode("domestic");
      setSelectedCarrier(rate.carrier as Carrier);
    } else {
      setRateMode("international");
      setSelectedCarrier("");
    }
    resetRate({
      prefix: rate.prefix,
      rate: rate.rate,
      currency: rate.currency as "VND" | "USD",
      unit: rate.unit,
      effective_from: rate.effective_from.slice(0, 10),
      effective_to: rate.effective_to ? rate.effective_to.slice(0, 10) : "",
    });
    setRateDialogOpen(true);
  }

  const createRateMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, `/api/admin/channels/${id}/rates`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      toast.success("Thêm giá thành công");
      qc.invalidateQueries({ queryKey: ["channel", id, "rates"] });
      setRateDialogOpen(false);
      resetRate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const updateRateMutation = useMutation({
    mutationFn: ({ rateId, body }: { rateId: number; body: object }) =>
      apiClient(token, `/api/admin/channels/${id}/rates/${rateId}`, {
        method: "PUT",
        body,
      }),
    onSuccess: () => {
      toast.success("Cập nhật giá thành công");
      qc.invalidateQueries({ queryKey: ["channel", id, "rates"] });
      setRateDialogOpen(false);
      resetRate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: (rateId: number) =>
      apiClient(token, `/api/admin/channels/${id}/rates/${rateId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Đã xóa giá");
      qc.invalidateQueries({ queryKey: ["channel", id, "rates"] });
      setDeleteRate(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  function onRateSubmit(data: RateFormData) {
    const body: Record<string, unknown> = {
      rate: data.rate,
      currency: data.currency,
      unit: data.unit,
      effective_from: data.effective_from,
      effective_to: data.effective_to || null,
    };
    if (rateMode === "domestic") {
      body.carrier = selectedCarrier || null;
    } else {
      body.prefix = data.prefix ?? "";
    }
    if (editingRate) {
      updateRateMutation.mutate({ rateId: editingRate.id, body });
    } else {
      createRateMutation.mutate(body);
    }
  }

  // ---- Chart data ----
  const chartData = stats
    ? Object.entries(stats.by_state).map(([state, count]) => ({
        state,
        count,
      }))
    : [];

  const barFill = (state: string) => {
    if (state === "DELIVERED") return "#10b981";
    if (state === "FAILED") return "#ef4444";
    return "#6366f1";
  };

  // ---- Loading / not found ----
  if (channelLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="text-center py-16 text-gray-500">
        Không tìm thấy nhà cung cấp
      </div>
    );
  }

  const typeInfo = TYPE_LABELS[channel.type];
  const deliveryInfo =
    DELIVERY_TYPE_LABELS[channel.delivery_type] ?? DELIVERY_TYPE_LABELS["SMS"];
  const rateMutPending =
    createRateMutation.isPending || updateRateMutation.isPending;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/providers">
          <Button variant="ghost" size="icon" className="w-8 h-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">
              {channel.name}
            </h1>
            <StatusBadge status={channel.status} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Code:{" "}
            <code className="font-mono text-indigo-700">{channel.code}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openEdit}>
            <Pencil className="w-4 h-4 mr-1.5" /> Sửa
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => setDeleteChannelOpen(true)}
          >
            <Trash2 className="w-4 h-4 mr-1.5" /> Xóa
          </Button>
        </div>
      </div>

      <Tabs defaultValue="config">
        <TabsList className="mb-6">
          <TabsTrigger value="config">Cấu hình</TabsTrigger>
          <TabsTrigger value="stats">Thống kê</TabsTrigger>
          <TabsTrigger value="rates">Bảng giá</TabsTrigger>
        </TabsList>

        {/* ---- Tab: Cấu hình ---- */}
        <TabsContent value="config">
          <div className="space-y-6 max-w-2xl">
            <Card className="border-0 shadow-sm bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Thông tin kênh</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Code</p>
                    <code className="font-mono text-indigo-700 text-sm">
                      {channel.code}
                    </code>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Tên</p>
                    <p className="font-medium text-gray-900">{channel.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Loại kết nối</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs font-medium border",
                        typeInfo.color
                      )}
                    >
                      {typeInfo.label}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Loại tin</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs font-medium border",
                        deliveryInfo.color
                      )}
                    >
                      {deliveryInfo.label}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Trạng thái</p>
                    <StatusBadge status={channel.status} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Tạo lúc</p>
                    <p className="text-gray-700 text-xs">
                      {format(new Date(channel.created_at), "dd/MM/yyyy HH:mm", {
                        locale: vi,
                      })}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    disabled={testPingMutation.isPending}
                    onClick={() => testPingMutation.mutate()}
                  >
                    {testPingMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Activity className="w-4 h-4 mr-2" />
                    )}
                    Test ping
                  </Button>
                  {channel.status === "ACTIVE" ? (
                    <Button
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate("DISABLED")}
                    >
                      {statusMutation.isPending && (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      )}
                      Vô hiệu hóa
                    </Button>
                  ) : (
                    <Button
                      className="bg-indigo-600 hover:bg-indigo-500 text-white"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate("ACTIVE")}
                    >
                      {statusMutation.isPending && (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      )}
                      Kích hoạt
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Config JSON</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(channel.config, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- Tab: Thống kê ---- */}
        <TabsContent value="stats">
          {/* Period selector */}
          <div className="flex gap-2 mb-6">
            {PERIOD_OPTIONS.map((p) => (
              <Button
                key={p.value}
                variant={period === p.value ? "default" : "outline"}
                size="sm"
                className={
                  period === p.value
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                    : ""
                }
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {statsLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-64 rounded-xl" />
            </div>
          ) : stats ? (
            <div className="space-y-6">
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="border-0 shadow-sm bg-white">
                  <CardContent className="p-5">
                    <p className="text-xs text-gray-500 mb-1">Tổng tin</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {stats.total.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-white">
                  <CardContent className="p-5">
                    <p className="text-xs text-gray-500 mb-1">Thành công</p>
                    <p className="text-2xl font-bold text-emerald-600">
                      {stats.delivered.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-white">
                  <CardContent className="p-5">
                    <p className="text-xs text-gray-500 mb-1">Thất bại</p>
                    <p className="text-2xl font-bold text-red-600">
                      {stats.failed.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-white">
                  <CardContent className="p-5">
                    <p className="text-xs text-gray-500 mb-1">
                      Tỉ lệ thành công
                    </p>
                    <p className="text-2xl font-bold text-indigo-600">
                      {(stats.delivery_rate * 100).toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Bar chart */}
              {chartData.length > 0 && (
                <Card className="border-0 shadow-sm bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Phân bố theo trạng thái
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart
                        data={chartData}
                        margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#f0f0f0"
                        />
                        <XAxis
                          dataKey="state"
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: "1px solid #e5e7eb",
                            fontSize: 12,
                          }}
                        />
                        <Bar
                          dataKey="count"
                          radius={[4, 4, 0, 0]}
                          fill="#6366f1"
                        >
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={barFill(entry.state)}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400 text-sm">
              Chưa có dữ liệu thống kê
            </div>
          )}
        </TabsContent>

        {/* ---- Tab: Bảng giá ---- */}
        <TabsContent value="rates">
          <div className="flex justify-end mb-4">
            <Button
              onClick={openCreateRate}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Plus className="w-4 h-4 mr-2" /> Thêm giá
            </Button>
          </div>

          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-0">
              {ratesLoading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Đối tượng
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Giá
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Đơn vị
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Tiền tệ
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Hiệu lực từ
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Đến
                        </th>
                        <th className="text-right px-6 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(rates ?? []).map((r) => (
                        <tr
                          key={r.id}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-6 py-3">
                            {r.carrier ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-0.5">
                                {CARRIER_NAMES[r.carrier as Carrier] ?? r.carrier}
                              </span>
                            ) : (
                              <code className="text-xs font-mono text-indigo-700">
                                {r.prefix === "" ? "(Tất cả)" : r.prefix}
                              </code>
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {r.rate.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {UNIT_LABELS[r.unit] ?? r.unit}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {r.currency}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {format(
                              new Date(r.effective_from),
                              "dd/MM/yyyy",
                              { locale: vi }
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {r.effective_to
                              ? format(
                                  new Date(r.effective_to),
                                  "dd/MM/yyyy",
                                  { locale: vi }
                                )
                              : "—"}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-gray-500 hover:text-indigo-700 hover:bg-indigo-50"
                                onClick={() => openEditRate(r)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setDeleteRate(r)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!rates || rates.length === 0) && (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-6 py-8 text-center text-gray-400 text-sm"
                          >
                            Chưa có bảng giá nào
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Rate dialog */}
      <Dialog
        open={rateDialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setRateDialogOpen(false);
            setEditingRate(null);
            resetRate();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingRate ? "Sửa giá" : "Thêm giá mới"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={handleRate(onRateSubmit)}
            className="space-y-4 mt-2"
          >
            {/* Domestic / International toggle */}
            <div className="space-y-1.5">
              <Label>Áp dụng cho</Label>
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setRateMode("domestic")}
                  className={cn(
                    "flex-1 text-xs py-1.5 rounded-md font-medium transition-all",
                    rateMode === "domestic"
                      ? "bg-white shadow text-indigo-700"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Nội địa (nhà mạng)
                </button>
                <button
                  type="button"
                  onClick={() => setRateMode("international")}
                  className={cn(
                    "flex-1 text-xs py-1.5 rounded-md font-medium transition-all",
                    rateMode === "international"
                      ? "bg-white shadow text-indigo-700"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Quốc tế (prefix)
                </button>
              </div>
            </div>

            {rateMode === "domestic" ? (
              <div className="space-y-1.5">
                <Label>Nhà mạng *</Label>
                <Select
                  value={selectedCarrier}
                  onValueChange={(v) => setSelectedCarrier(v as Carrier)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn nhà mạng..." />
                  </SelectTrigger>
                  <SelectContent>
                    {carriers
                      ? carriers.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.name}
                          </SelectItem>
                        ))
                      : (Object.entries(CARRIER_NAMES) as [Carrier, string][]).map(([code, name]) => (
                          <SelectItem key={code} value={code}>
                            {name}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Prefix quốc gia (để trống = tất cả)</Label>
                <Input {...regRate("prefix")} placeholder="VD: 1 (Mỹ), 44 (Anh)" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Giá *</Label>
                <Input
                  {...regRate("rate")}
                  type="number"
                  step="any"
                  min={0}
                />
                {rateErrors.rate && (
                  <p className="text-red-500 text-xs">
                    {rateErrors.rate.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Tiền tệ *</Label>
                <Select
                  defaultValue={editingRate?.currency ?? "VND"}
                  onValueChange={(v) =>
                    setRateValue("currency", v as "VND" | "USD")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VND">VND</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Đơn vị *</Label>
              <Select
                defaultValue={editingRate?.unit ?? "MESSAGE"}
                onValueChange={(v) =>
                  setRateValue(
                    "unit",
                    v as "MESSAGE" | "SECOND" | "CALL"
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MESSAGE">Tin nhắn</SelectItem>
                  <SelectItem value="SECOND">Giây</SelectItem>
                  <SelectItem value="CALL">Cuộc gọi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Hiệu lực từ *</Label>
                <Input {...regRate("effective_from")} type="date" />
                {rateErrors.effective_from && (
                  <p className="text-red-500 text-xs">
                    {rateErrors.effective_from.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Đến (tùy chọn)</Label>
                <Input {...regRate("effective_to")} type="date" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRateDialogOpen(false);
                  setEditingRate(null);
                  resetRate();
                }}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={rateSubmitting || rateMutPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(rateSubmitting || rateMutPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                {editingRate ? "Lưu thay đổi" : "Thêm giá"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete rate confirm */}
      <ConfirmDialog
        open={!!deleteRate}
        onClose={() => setDeleteRate(null)}
        onConfirm={() => deleteRate && deleteRateMutation.mutate(deleteRate.id)}
        loading={deleteRateMutation.isPending}
        title="Xóa giá này?"
        description="Thao tác không thể hoàn tác."
        confirmLabel="Xóa"
        variant="destructive"
      />

      {/* Edit channel dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          if (!o) setEditOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sửa kênh</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Tên kênh *</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Tên hiển thị"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Loại tin *</Label>
              <Select
                value={editDeliveryType}
                onValueChange={(v) => setEditDeliveryType(v as DeliveryType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="VOICE_OTP">Voice OTP</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">
                Loại tin sẽ được dùng để khớp với bảng giá partner và route.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-config">Config (JSON)</Label>
              <textarea
                id="edit-config"
                className="w-full h-48 font-mono text-xs p-3 rounded-md border border-input bg-slate-950 text-slate-100 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                value={editConfig}
                onChange={(e) => {
                  setEditConfig(e.target.value);
                  setEditConfigError(null);
                }}
                spellCheck={false}
              />
              {editConfigError && (
                <p className="text-red-500 text-xs">{editConfigError}</p>
              )}
              <p className="text-xs text-gray-400">
                Chỉnh sửa trực tiếp JSON config. Password fields vẫn giữ nguyên giá trị trong DB nếu không thay đổi.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={editMutation.isPending}
              >
                Hủy
              </Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
                onClick={handleEditSubmit}
                disabled={editMutation.isPending || !editName.trim()}
              >
                {editMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Lưu thay đổi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete channel confirm */}
      <ConfirmDialog
        open={deleteChannelOpen}
        onClose={() => setDeleteChannelOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
        title="Xóa kênh này?"
        description={`Kênh "${channel.name}" sẽ bị vô hiệu hóa và không thể dùng để định tuyến. Thao tác không thể hoàn tác.`}
        confirmLabel="Xóa kênh"
        variant="destructive"
      />
    </div>
  );
}
