"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { Plus, Loader2, Trash2, GitFork } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { Route, Partner, Channel, PageResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Switch } from "@/components/ui/switch";

const CARRIERS = [
  { code: "VIETTEL", name: "Viettel" },
  { code: "MOBIFONE", name: "MobiFone" },
  { code: "VINAPHONE", name: "VinaPhone" },
  { code: "VIETNAMOBILE", name: "Vietnamobile" },
  { code: "GMOBILE", name: "Gmobile" },
  { code: "REDDI", name: "Reddi" },
] as const;

const CARRIER_LABEL: Record<string, string> = Object.fromEntries(
  CARRIERS.map((c) => [c.code, c.name])
);

type MatchMode = "carrier" | "prefix";

const routeSchema = z.object({
  partner_id: z.coerce.number().int().min(1, "Bắt buộc"),
  msisdn_prefix: z.string().optional(),
  channel_id: z.coerce.number().int().min(1, "Bắt buộc"),
  fallback_channel_id: z.coerce.number().int().optional(),
  priority: z.coerce.number().int().min(0).default(100),
});

type RouteForm = z.infer<typeof routeSchema>;

export function RoutesClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Route | null>(null);
  const [page, setPage] = useState(0);
  const [matchMode, setMatchMode] = useState<MatchMode>("carrier");
  const [selectedCarrier, setSelectedCarrier] = useState("");

  const { data: routesData, isLoading } = useQuery<PageResponse<Route>>({
    queryKey: ["routes", page],
    queryFn: () =>
      apiClient(token, "/api/admin/routes", { query: { page, size: 20 } }),
    enabled: !!token,
  });

  const { data: partnersData } = useQuery<PageResponse<Partner>>({
    queryKey: ["partners", "all"],
    queryFn: () =>
      apiClient(token, "/api/admin/partners", { query: { page: 0, size: 200 } }),
    enabled: !!token,
  });

  const { data: channelsData } = useQuery<PageResponse<Channel>>({
    queryKey: ["channels"],
    queryFn: () => apiClient(token, "/api/admin/channels"),
    enabled: !!token,
  });

  const partners = partnersData?.items ?? [];
  const channels = channelsData?.items ?? [];

  const partnerMap = Object.fromEntries(partners.map((p) => [p.id, p]));
  const channelMap = Object.fromEntries(channels.map((c) => [c.id, c]));

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RouteForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(routeSchema) as any,
    defaultValues: { priority: 100 },
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, "/api/admin/routes", { method: "POST", body }),
    onSuccess: (data: { warnings?: string[] }) => {
      toast.success("Tạo route thành công");
      (data?.warnings ?? []).forEach((w) => toast.warning(w));
      qc.invalidateQueries({ queryKey: ["routes"] });
      resetDialog();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient(token, `/api/admin/routes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Đã xóa route");
      qc.invalidateQueries({ queryKey: ["routes"] });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiClient(token, `/api/admin/routes/${id}`, {
        method: "PUT",
        body: { enabled },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routes"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const onSubmit = (data: RouteForm) => {
    const body: Record<string, unknown> = {
      partner_id: data.partner_id,
      channel_id: data.channel_id,
      priority: data.priority,
    };
    if (matchMode === "carrier") {
      body.carrier = selectedCarrier;
    } else {
      body.msisdn_prefix = data.msisdn_prefix ?? "";
    }
    if (data.fallback_channel_id) {
      body.fallback_channel_id = data.fallback_channel_id;
    }
    createMutation.mutate(body);
  };

  function resetDialog() {
    setCreateOpen(false);
    setMatchMode("carrier");
    setSelectedCarrier("");
    reset();
  }

  const routes = routesData?.items ?? [];
  const total = routesData?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const watchedChannelId = watch("channel_id");

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Thêm route
        </Button>
      </div>

      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : routes.length === 0 ? (
            <EmptyState
              icon={GitFork}
              title="Chưa có route"
              description="Thêm route để định tuyến tin nhắn từ partner đến kênh"
              action={
                <Button
                  onClick={() => setCreateOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" /> Thêm route
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Partner</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hướng</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Kênh</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Fallback</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Priority</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Kích hoạt</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tạo lúc</th>
                    <th className="text-right px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {routes.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3">
                        <code className="text-xs bg-indigo-50 px-1.5 py-0.5 rounded font-mono text-indigo-700">
                          {partnerMap[r.partner_id]?.code ?? `#${r.partner_id}`}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        {r.carrier ? (
                          <Badge variant="outline" className="text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                            {CARRIER_LABEL[r.carrier] ?? r.carrier}
                          </Badge>
                        ) : (
                          <code className="font-mono text-sm text-gray-800">
                            {r.msisdn_prefix || "*"}
                          </code>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {channelMap[r.channel_id]?.name ?? `#${r.channel_id}`}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {r.fallback_channel_id
                          ? channelMap[r.fallback_channel_id]?.name ?? `#${r.fallback_channel_id}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">
                          {r.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={r.enabled}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: r.id, enabled: checked })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {format(new Date(r.created_at), "dd/MM/yyyy HH:mm", { locale: vi })}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleteTarget(r)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
              <span className="text-xs text-gray-500">Tổng {total} route</span>
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) resetDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm route mới</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Partner *</Label>
              <Select onValueChange={(v) => setValue("partner_id", Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn partner..." />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.partner_id && (
                <p className="text-red-500 text-xs">{errors.partner_id.message}</p>
              )}
            </div>

            {/* Mode selector: carrier vs prefix */}
            <div className="space-y-1.5">
              <Label>Loại định tuyến *</Label>
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMatchMode("carrier")}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${
                    matchMode === "carrier"
                      ? "bg-white shadow text-indigo-700"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Theo nhà mạng
                </button>
                <button
                  type="button"
                  onClick={() => setMatchMode("prefix")}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${
                    matchMode === "prefix"
                      ? "bg-white shadow text-indigo-700"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Theo prefix
                </button>
              </div>
            </div>

            {matchMode === "carrier" ? (
              <div className="space-y-1.5">
                <Label>Nhà mạng *</Label>
                <Select value={selectedCarrier} onValueChange={(v) => setSelectedCarrier(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn nhà mạng..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CARRIERS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>MSISDN Prefix (để trống = wildcard *)</Label>
                <Input
                  {...register("msisdn_prefix")}
                  placeholder="VD: 8496 (Viettel) hoặc để trống cho tất cả"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Kênh chính *</Label>
              <Select onValueChange={(v) => setValue("channel_id", Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn kênh..." />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.channel_id && (
                <p className="text-red-500 text-xs">{errors.channel_id.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Kênh dự phòng (tùy chọn)</Label>
              <Select
                onValueChange={(v) =>
                  setValue("fallback_channel_id", v ? Number(v) : undefined)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Không có dự phòng" />
                </SelectTrigger>
                <SelectContent>
                  {channels
                    .filter((c) => c.id !== watchedChannelId)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input {...register("priority")} type="number" min={0} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetDialog}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || createMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(isSubmitting || createMutation.isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Tạo route
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
        title="Xóa route này?"
        description="Route sẽ bị xóa và không còn định tuyến tin nhắn theo cấu hình này."
        confirmLabel="Xóa"
        variant="destructive"
      />
    </div>
  );
}
