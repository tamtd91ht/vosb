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
import { Plus, Loader2, Trash2, Globe, Phone, Radio } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { Channel, ChannelType, PageResponse } from "@/lib/types";
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
import { StatusBadge } from "@/components/common/StatusBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<ChannelType, { label: string; color: string }> = {
  HTTP_THIRD_PARTY: { label: "HTTP API", color: "bg-blue-100 text-blue-700 border-blue-200" },
  FREESWITCH_ESL: { label: "FreeSWITCH ESL", color: "bg-violet-100 text-violet-700 border-violet-200" },
  TELCO_SMPP: { label: "Telco SMPP", color: "bg-orange-100 text-orange-700 border-orange-200" },
};

const TYPE_ICONS: Record<ChannelType, React.ElementType> = {
  HTTP_THIRD_PARTY: Globe,
  FREESWITCH_ESL: Phone,
  TELCO_SMPP: Radio,
};

const channelBaseSchema = z.object({
  code: z.string().min(1, "Bắt buộc"),
  name: z.string().min(1, "Bắt buộc"),
  type: z.enum(["HTTP_THIRD_PARTY", "FREESWITCH_ESL", "TELCO_SMPP"]),
  // HTTP
  http_url: z.string().optional(),
  http_method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
  http_auth_type: z.enum(["Bearer", "Basic", "None"]).optional(),
  // ESL
  esl_host: z.string().optional(),
  esl_port: z.coerce.number().optional(),
  esl_password: z.string().optional(),
  // SMPP
  smpp_host: z.string().optional(),
  smpp_port: z.coerce.number().optional(),
  smpp_system_id: z.string().optional(),
  smpp_password: z.string().optional(),
});

type ChannelForm = z.infer<typeof channelBaseSchema>;

export function ChannelsClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<ChannelType>("HTTP_THIRD_PARTY");
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);

  const { data, isLoading } = useQuery<PageResponse<Channel>>({
    queryKey: ["channels"],
    queryFn: () => apiClient(token, "/api/admin/channels"),
    enabled: !!token,
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ChannelForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(channelBaseSchema) as any,
    defaultValues: {
      type: "HTTP_THIRD_PARTY",
      http_method: "POST",
      http_auth_type: "None",
      esl_port: 8021,
      smpp_port: 2775,
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, "/api/admin/channels", { method: "POST", body }),
    onSuccess: () => {
      toast.success("Tạo kênh thành công");
      qc.invalidateQueries({ queryKey: ["channels"] });
      setCreateOpen(false);
      reset();
      setStep(1);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient(token, `/api/admin/channels/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Đã xóa kênh");
      qc.invalidateQueries({ queryKey: ["channels"] });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const onSubmit = (data: ChannelForm) => {
    let config: Record<string, unknown> = {};
    if (data.type === "HTTP_THIRD_PARTY") {
      config = {
        url: data.http_url,
        method: data.http_method,
        auth_type: data.http_auth_type,
      };
    } else if (data.type === "FREESWITCH_ESL") {
      config = {
        host: data.esl_host,
        port: data.esl_port,
        password: data.esl_password,
      };
    } else if (data.type === "TELCO_SMPP") {
      config = {
        host: data.smpp_host,
        port: data.smpp_port,
        system_id: data.smpp_system_id,
        password: data.smpp_password,
      };
    }
    createMutation.mutate({ code: data.code, name: data.name, type: data.type, config });
  };

  const channels = data?.items ?? [];

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button
          onClick={() => { setCreateOpen(true); setStep(1); }}
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Thêm kênh
        </Button>
      </div>

      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : channels.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="Chưa có kênh"
              description="Thêm kênh để cấu hình định tuyến tin nhắn"
              action={
                <Button
                  onClick={() => { setCreateOpen(true); setStep(1); }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" /> Thêm kênh
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Code</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tên</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Loại</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Trạng thái</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tạo lúc</th>
                    <th className="text-right px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {channels.map((ch) => {
                    const TypeIcon = TYPE_ICONS[ch.type];
                    const typeInfo = TYPE_LABELS[ch.type];
                    return (
                      <tr key={ch.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3">
                          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-indigo-700">
                            {ch.code}
                          </code>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{ch.name}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn("text-xs font-medium border", typeInfo.color)}>
                            <TypeIcon className="w-3 h-3 mr-1" />
                            {typeInfo.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={ch.status} /></td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {format(new Date(ch.created_at), "dd/MM/yyyy HH:mm", { locale: vi })}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteTarget(ch)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setStep(1); reset(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {step === 1 ? "Chọn loại kênh" : "Cấu hình kênh"}
            </DialogTitle>
          </DialogHeader>

          {step === 1 ? (
            <div className="space-y-3 mt-2">
              {(["HTTP_THIRD_PARTY", "FREESWITCH_ESL", "TELCO_SMPP"] as ChannelType[]).map((t) => {
                const Icon = TYPE_ICONS[t];
                const info = TYPE_LABELS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setSelectedType(t);
                      setValue("type", t);
                      setStep(2);
                    }}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all",
                      selectedType === t
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-indigo-200 hover:bg-gray-50"
                    )}
                  >
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center border", info.color)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{info.label}</p>
                      <p className="text-xs text-gray-500">
                        {t === "HTTP_THIRD_PARTY" && "Gọi API HTTP của nhà cung cấp bên ngoài"}
                        {t === "FREESWITCH_ESL" && "Voice OTP qua FreeSWITCH Event Socket"}
                        {t === "TELCO_SMPP" && "Kết nối SMPP client tới nhà mạng"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
              <input type="hidden" {...register("type")} value={selectedType} />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Code *</Label>
                  <Input {...register("code")} placeholder="VD: HTTP_VTG" />
                  {errors.code && <p className="text-red-500 text-xs">{errors.code.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Tên *</Label>
                  <Input {...register("name")} placeholder="Tên kênh" />
                  {errors.name && <p className="text-red-500 text-xs">{errors.name.message}</p>}
                </div>
              </div>

              {/* HTTP Config */}
              {selectedType === "HTTP_THIRD_PARTY" && (
                <div className="space-y-3 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-600 uppercase">HTTP Config</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">URL</Label>
                    <Input {...register("http_url")} placeholder="https://api.provider.com/sms" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Method</Label>
                      <Select defaultValue="POST" onValueChange={(v) => setValue("http_method", v as "GET" | "POST" | "PUT" | "PATCH")}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="POST">POST</SelectItem>
                          <SelectItem value="GET">GET</SelectItem>
                          <SelectItem value="PUT">PUT</SelectItem>
                          <SelectItem value="PATCH">PATCH</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Auth Type</Label>
                      <Select defaultValue="None" onValueChange={(v) => setValue("http_auth_type", v as "Bearer" | "Basic" | "None")}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="None">None</SelectItem>
                          <SelectItem value="Bearer">Bearer</SelectItem>
                          <SelectItem value="Basic">Basic</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* ESL Config */}
              {selectedType === "FREESWITCH_ESL" && (
                <div className="space-y-3 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-600 uppercase">FreeSWITCH ESL Config</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Host</Label>
                      <Input {...register("esl_host")} placeholder="127.0.0.1" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Port</Label>
                      <Input {...register("esl_port")} type="number" defaultValue={8021} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Password</Label>
                    <Input {...register("esl_password")} type="password" placeholder="ClueCon" />
                  </div>
                </div>
              )}

              {/* SMPP Config */}
              {selectedType === "TELCO_SMPP" && (
                <div className="space-y-3 border border-gray-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-600 uppercase">SMPP Client Config</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Host</Label>
                      <Input {...register("smpp_host")} placeholder="smpp.telco.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Port</Label>
                      <Input {...register("smpp_port")} type="number" defaultValue={2775} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">System ID</Label>
                      <Input {...register("smpp_system_id")} placeholder="telco_user" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Password</Label>
                      <Input {...register("smpp_password")} type="password" />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  Quay lại
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || createMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  {(isSubmitting || createMutation.isPending) && (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  )}
                  Tạo kênh
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
        title={`Xóa kênh "${deleteTarget?.name}"?`}
        description="Kênh sẽ bị vô hiệu hóa (soft delete). Các route dùng kênh này cần được cập nhật."
        confirmLabel="Xóa"
        variant="destructive"
      />
    </div>
  );
}
