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
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Key,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { apiClient, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Carrier,
  CarrierInfo,
  DeliveryType,
  Partner,
  PartnerApiKey,
  PartnerRate,
  PartnerSmppAccount,
  RateUnit,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const CARRIER_NAMES: Record<Carrier, string> = {
  VIETTEL: "Viettel",
  MOBIFONE: "MobiFone",
  VINAPHONE: "VinaPhone",
  VIETNAMOBILE: "Vietnamobile",
  GMOBILE: "Gmobile",
  REDDI: "Reddi",
};

// ---- Helpers ----
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="icon" className="w-7 h-7" onClick={copy}>
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-600" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

const UNIT_LABELS: Record<RateUnit, string> = {
  MESSAGE: "Tin nhắn",
  SECOND: "Giây",
  CALL: "Cuộc gọi",
};

// ---- Schemas ----
const smppSchema = z.object({
  system_id: z.string().min(1, "Bắt buộc"),
  password: z.string().min(6, "Tối thiểu 6 ký tự"),
  max_binds: z.coerce.number().int().min(1).default(5),
  ip_whitelist: z.string().optional(),
});
type SmppForm = z.infer<typeof smppSchema>;

const apiKeySchema = z.object({
  label: z.string().optional(),
});
type ApiKeyForm = z.infer<typeof apiKeySchema>;

const partnerUpdateSchema = z.object({
  name: z.string().min(1, "Bắt buộc"),
  dlr_url: z.string().url("URL không hợp lệ").optional().or(z.literal("")),
  dlr_method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
});
type PartnerUpdateForm = z.infer<typeof partnerUpdateSchema>;

const rateSchema = z.object({
  delivery_type: z.enum(["SMS", "VOICE_OTP"]),
  prefix: z.string().optional(),
  rate: z.coerce.number().min(0, "Phải >= 0"),
  currency: z.enum(["VND", "USD"]),
  unit: z.enum(["MESSAGE", "SECOND", "CALL"]),
  effective_from: z.string().min(1, "Bắt buộc"),
  effective_to: z.string().optional(),
});
type RateFormData = z.infer<typeof rateSchema>;

// ---- Component ----
export function PartnerDetailClient({ id }: { id: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  // --- SMPP dialog state ---
  const [smppOpen, setSmppOpen] = useState(false);
  const [deleteSmpp, setDeleteSmpp] = useState<PartnerSmppAccount | null>(null);

  // --- API Key dialog state ---
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<{
    key_id: string;
    raw_secret: string;
    label: string;
  } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [deleteKey, setDeleteKey] = useState<PartnerApiKey | null>(null);

  // --- Rate dialog state ---
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<PartnerRate | null>(null);
  const [deleteRate, setDeleteRate] = useState<PartnerRate | null>(null);
  const [rateDeliveryFilter, setRateDeliveryFilter] =
    useState<DeliveryType>("SMS");
  const [rateMode, setRateMode] = useState<"domestic" | "international">("domestic");
  const [selectedCarrier, setSelectedCarrier] = useState<Carrier | "">("");

  // ---- Queries ----
  const { data: partner, isLoading: partnerLoading } = useQuery<Partner>({
    queryKey: ["partner", id],
    queryFn: () => apiClient(token, `/api/admin/partners/${id}`),
    enabled: true,
  });

  const { data: smppAccounts } = useQuery<PartnerSmppAccount[]>({
    queryKey: ["partner", id, "smpp"],
    queryFn: () =>
      apiClient(token, `/api/admin/partners/${id}/smpp-accounts`),
    enabled: true,
  });

  const { data: apiKeys } = useQuery<PartnerApiKey[]>({
    queryKey: ["partner", id, "api-keys"],
    queryFn: () => apiClient(token, `/api/admin/partners/${id}/api-keys`),
    enabled: true,
  });

  const { data: partnerRates } = useQuery<PartnerRate[]>({
    queryKey: ["partner", id, "rates"],
    queryFn: () => apiClient(token, `/api/admin/partners/${id}/rates`),
    enabled: true,
  });

  const { data: carriers } = useQuery<CarrierInfo[]>({
    queryKey: ["carriers"],
    queryFn: () => apiClient(token, `/api/admin/carriers`),
    enabled: true,
  });

  // ---- Partner info form ----
  const {
    register: regUpdate,
    handleSubmit: handleUpdate,
    formState: { isSubmitting: updateSubmitting },
  } = useForm<PartnerUpdateForm>({
    resolver: zodResolver(partnerUpdateSchema),
    values: {
      name: partner?.name ?? "",
      dlr_url: partner?.dlr_webhook?.url ?? "",
      dlr_method:
        (partner?.dlr_webhook?.method as
          | "GET"
          | "POST"
          | "PUT"
          | "PATCH") ?? "POST",
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, `/api/admin/partners/${id}`, {
        method: "PUT",
        body,
      }),
    onSuccess: () => {
      toast.success("Cập nhật thành công");
      qc.invalidateQueries({ queryKey: ["partner", id] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const onUpdateSubmit = (data: PartnerUpdateForm) => {
    const body: Record<string, unknown> = { name: data.name };
    if (data.dlr_url) {
      body.dlr_webhook = { url: data.dlr_url, method: data.dlr_method };
    }
    updateMutation.mutate(body);
  };

  // Status toggle
  const statusMutation = useMutation({
    mutationFn: (newStatus: string) =>
      apiClient(token, `/api/admin/partners/${id}`, {
        method: "PUT",
        body: { status: newStatus },
      }),
    onSuccess: () => {
      toast.success("Cập nhật trạng thái thành công");
      qc.invalidateQueries({ queryKey: ["partner", id] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  // ---- SMPP form ----
  const {
    register: regSmpp,
    handleSubmit: handleSmpp,
    reset: resetSmpp,
    formState: { errors: smppErrors, isSubmitting: smppSubmitting },
  } = useForm<SmppForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(smppSchema) as any,
    defaultValues: { max_binds: 5 },
  });

  const createSmppMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, `/api/admin/partners/${id}/smpp-accounts`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      toast.success("Tạo SMPP account thành công");
      qc.invalidateQueries({ queryKey: ["partner", id, "smpp"] });
      setSmppOpen(false);
      resetSmpp();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const deleteSmppMutation = useMutation({
    mutationFn: (aid: number) =>
      apiClient(
        token,
        `/api/admin/partners/${id}/smpp-accounts/${aid}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      toast.success("Đã xóa SMPP account");
      qc.invalidateQueries({ queryKey: ["partner", id, "smpp"] });
      setDeleteSmpp(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const onSmppSubmit = (data: SmppForm) => {
    const body: Record<string, unknown> = {
      system_id: data.system_id,
      password: data.password,
      max_binds: data.max_binds,
    };
    if (data.ip_whitelist) {
      body.ip_whitelist = data.ip_whitelist
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    createSmppMutation.mutate(body);
  };

  // ---- API Key form ----
  const {
    register: regKey,
    handleSubmit: handleKey,
    reset: resetKey,
    formState: { isSubmitting: keySubmitting },
  } = useForm<ApiKeyForm>({
    resolver: zodResolver(apiKeySchema),
  });

  const createKeyMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, `/api/admin/partners/${id}/api-keys`, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["partner", id, "api-keys"] });
      setApiKeyOpen(false);
      resetKey();
      setShowSecret(false);
      setNewSecret(data);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: (kid: number) =>
      apiClient(
        token,
        `/api/admin/partners/${id}/api-keys/${kid}/revoke`,
        { method: "POST" }
      ),
    onSuccess: () => {
      toast.success("Đã thu hồi API key");
      qc.invalidateQueries({ queryKey: ["partner", id, "api-keys"] });
      setDeleteKey(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const onKeySubmit = (data: ApiKeyForm) => {
    createKeyMutation.mutate({ label: data.label ?? "" });
  };

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
    defaultValues: { delivery_type: "SMS", currency: "VND", unit: "MESSAGE" },
  });

  function openCreateRate() {
    setEditingRate(null);
    setRateMode("domestic");
    setSelectedCarrier("");
    resetRate({
      delivery_type: "SMS",
      currency: "VND",
      unit: "MESSAGE",
    });
    setRateDialogOpen(true);
  }

  function openEditRate(rate: PartnerRate) {
    setEditingRate(rate);
    if (rate.carrier) {
      setRateMode("domestic");
      setSelectedCarrier(rate.carrier as Carrier);
    } else {
      setRateMode("international");
      setSelectedCarrier("");
    }
    resetRate({
      delivery_type: rate.delivery_type,
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
      apiClient(token, `/api/admin/partners/${id}/rates`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      toast.success("Thêm giá thành công");
      qc.invalidateQueries({ queryKey: ["partner", id, "rates"] });
      setRateDialogOpen(false);
      resetRate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const updateRateMutation = useMutation({
    mutationFn: ({ rateId, body }: { rateId: number; body: object }) =>
      apiClient(token, `/api/admin/partners/${id}/rates/${rateId}`, {
        method: "PUT",
        body,
      }),
    onSuccess: () => {
      toast.success("Cập nhật giá thành công");
      qc.invalidateQueries({ queryKey: ["partner", id, "rates"] });
      setRateDialogOpen(false);
      resetRate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: (rateId: number) =>
      apiClient(token, `/api/admin/partners/${id}/rates/${rateId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Đã xóa giá");
      qc.invalidateQueries({ queryKey: ["partner", id, "rates"] });
      setDeleteRate(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  function onRateSubmit(data: RateFormData) {
    const body: Record<string, unknown> = {
      delivery_type: data.delivery_type,
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

  // ---- Loading / not found ----
  if (partnerLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="text-center py-16 text-gray-500">
        Không tìm thấy đối tác
      </div>
    );
  }

  const filteredRates = (partnerRates ?? []).filter(
    (r) => r.delivery_type === rateDeliveryFilter
  );
  const rateMutPending =
    createRateMutation.isPending || updateRateMutation.isPending;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/partners">
          <Button variant="ghost" size="icon" className="w-8 h-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">
              {partner.name}
            </h1>
            <StatusBadge status={partner.status} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Code:{" "}
            <code className="font-mono text-indigo-700">{partner.code}</code>
          </p>
        </div>
      </div>

      <Tabs defaultValue="info">
        <TabsList className="mb-6">
          <TabsTrigger value="info">Thông tin</TabsTrigger>
          <TabsTrigger value="smpp">SMPP Accounts</TabsTrigger>
          <TabsTrigger value="apikeys">API Keys</TabsTrigger>
          <TabsTrigger value="rates">Bảng giá</TabsTrigger>
        </TabsList>

        {/* ---- Tab: Thông tin ---- */}
        <TabsContent value="info">
          <div className="space-y-6 max-w-lg">
            {/* Info card */}
            <Card className="border-0 shadow-sm bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Thông tin chung</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Code</p>
                    <code className="font-mono text-indigo-700">
                      {partner.code}
                    </code>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Số dư</p>
                    <p className="font-semibold text-gray-900">
                      {partner.balance.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Trạng thái</p>
                    <StatusBadge status={partner.status} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Tạo lúc</p>
                    <p className="text-gray-700 text-xs">
                      {format(
                        new Date(partner.created_at),
                        "dd/MM/yyyy HH:mm",
                        { locale: vi }
                      )}
                    </p>
                  </div>
                </div>
                {partner.dlr_webhook && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">DLR Webhook</p>
                    <p className="text-xs font-mono text-gray-700 break-all">
                      {partner.dlr_webhook.method} {partner.dlr_webhook.url}
                    </p>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  {partner.status === "ACTIVE" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate("SUSPENDED")}
                    >
                      {statusMutation.isPending && (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      )}
                      Tạm dừng
                    </Button>
                  ) : (
                    <Button
                      size="sm"
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

            {/* Update form */}
            <Card className="border-0 shadow-sm bg-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Cập nhật thông tin</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleUpdate(onUpdateSubmit)}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <Label>Tên đối tác *</Label>
                    <Input {...regUpdate("name")} />
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium text-gray-700">
                      DLR Webhook
                    </p>
                    <div className="space-y-1.5">
                      <Label className="text-xs">URL</Label>
                      <Input
                        {...regUpdate("dlr_url")}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={updateSubmitting || updateMutation.isPending}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      {(updateSubmitting || updateMutation.isPending) && (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      )}
                      Lưu thay đổi
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- Tab: SMPP Accounts ---- */}
        <TabsContent value="smpp">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => setSmppOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Plus className="w-4 h-4 mr-2" /> Thêm SMPP Account
            </Button>
          </div>
          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        System ID
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Max Binds
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Trạng thái
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Tạo lúc
                      </th>
                      <th className="text-right px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(smppAccounts ?? []).map((acc) => (
                      <tr
                        key={acc.id}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-6 py-3">
                          <code className="font-mono text-indigo-700 text-xs">
                            {acc.system_id}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {acc.max_binds}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={acc.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {format(
                            new Date(acc.created_at),
                            "dd/MM/yyyy HH:mm",
                            { locale: vi }
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteSmpp(acc)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {(!smppAccounts || smppAccounts.length === 0) && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-8 text-center text-gray-400 text-sm"
                        >
                          Chưa có SMPP account
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: API Keys ---- */}
        <TabsContent value="apikeys">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => setApiKeyOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Key className="w-4 h-4 mr-2" /> Tạo API Key
            </Button>
          </div>
          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Key ID
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Label
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Trạng thái
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Dùng lần cuối
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Tạo lúc
                      </th>
                      <th className="text-right px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(apiKeys ?? []).map((key) => (
                      <tr
                        key={key.id}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-1">
                            <code className="font-mono text-xs text-indigo-700">
                              {key.key_id}
                            </code>
                            <CopyButton text={key.key_id} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {key.label || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={key.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {key.last_used_at
                            ? format(
                                new Date(key.last_used_at),
                                "dd/MM/yyyy HH:mm",
                                { locale: vi }
                              )
                            : "Chưa dùng"}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {format(
                            new Date(key.created_at),
                            "dd/MM/yyyy HH:mm",
                            { locale: vi }
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          {key.status === "ACTIVE" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setDeleteKey(key)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(!apiKeys || apiKeys.length === 0) && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-6 py-8 text-center text-gray-400 text-sm"
                        >
                          Chưa có API key
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: Bảng giá ---- */}
        <TabsContent value="rates">
          <div className="flex items-center justify-between mb-4">
            {/* Delivery type filter */}
            <div className="flex gap-2">
              <Button
                variant={
                  rateDeliveryFilter === "SMS" ? "default" : "outline"
                }
                size="sm"
                className={
                  rateDeliveryFilter === "SMS"
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                    : ""
                }
                onClick={() => setRateDeliveryFilter("SMS")}
              >
                SMS
              </Button>
              <Button
                variant={
                  rateDeliveryFilter === "VOICE_OTP" ? "default" : "outline"
                }
                size="sm"
                className={
                  rateDeliveryFilter === "VOICE_OTP"
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                    : ""
                }
                onClick={() => setRateDeliveryFilter("VOICE_OTP")}
              >
                Voice OTP
              </Button>
            </div>
            <Button
              onClick={openCreateRate}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Plus className="w-4 h-4 mr-2" /> Thêm giá
            </Button>
          </div>

          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Loại tin
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
                    {filteredRates.map((r) => (
                      <tr
                        key={r.id}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-6 py-3 text-xs text-gray-600">
                          {r.delivery_type === "SMS" ? "SMS" : "Voice OTP"}
                        </td>
                        <td className="px-4 py-3">
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
                    {filteredRates.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-8 text-center text-gray-400 text-sm"
                        >
                          Chưa có bảng giá nào cho loại tin này
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ======= SMPP Dialogs ======= */}
      <Dialog open={smppOpen} onOpenChange={(o) => !o && setSmppOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo SMPP Account</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={handleSmpp(onSmppSubmit)}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label>System ID *</Label>
              <Input {...regSmpp("system_id")} placeholder="partner01" />
              {smppErrors.system_id && (
                <p className="text-red-500 text-xs">
                  {smppErrors.system_id.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Password *</Label>
              <Input
                {...regSmpp("password")}
                type="password"
                placeholder="Mật khẩu"
              />
              {smppErrors.password && (
                <p className="text-red-500 text-xs">
                  {smppErrors.password.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Max Binds</Label>
              <Input
                {...regSmpp("max_binds")}
                type="number"
                min={1}
                max={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>IP Whitelist (phân cách bởi dấu phẩy)</Label>
              <Input
                {...regSmpp("ip_whitelist")}
                placeholder="192.168.1.1, 10.0.0.0/24"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSmppOpen(false);
                  resetSmpp();
                }}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={smppSubmitting || createSmppMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(smppSubmitting || createSmppMutation.isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Tạo account
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteSmpp}
        onClose={() => setDeleteSmpp(null)}
        onConfirm={() =>
          deleteSmpp && deleteSmppMutation.mutate(deleteSmpp.id)
        }
        loading={deleteSmppMutation.isPending}
        title={`Xóa SMPP account "${deleteSmpp?.system_id}"?`}
        description="Thao tác này không thể hoàn tác."
        confirmLabel="Xóa"
        variant="destructive"
      />

      {/* ======= API Key Dialogs ======= */}
      <Dialog
        open={apiKeyOpen}
        onOpenChange={(o) => !o && setApiKeyOpen(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Tạo API Key mới</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleKey(onKeySubmit)} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Label (tùy chọn)</Label>
              <Input
                {...regKey("label")}
                placeholder="VD: Production key"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setApiKeyOpen(false);
                  resetKey();
                }}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={keySubmitting || createKeyMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(keySubmitting || createKeyMutation.isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Tạo key
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Secret reveal dialog — cannot close by backdrop */}
      <Dialog open={!!newSecret} onOpenChange={() => {}}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <KeyRound className="w-5 h-5" /> API Key tạo thành công!
            </DialogTitle>
          </DialogHeader>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              <strong>Đây là lần DUY NHẤT bạn thấy secret này.</strong> Hãy
              sao chép và lưu ngay. Sau khi đóng, VOSB Gateway không thể hiển
              thị lại.
            </p>
          </div>
          {newSecret && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1">
                  Key ID
                </p>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs font-mono text-gray-800 break-all">
                    {newSecret.key_id}
                  </code>
                  <CopyButton text={newSecret.key_id} />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1">
                  Secret (chỉ hiển thị một lần)
                </p>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs font-mono text-indigo-700 break-all">
                    {showSecret
                      ? newSecret.raw_secret
                      : "•".repeat(44)}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="w-8 h-8 shrink-0"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <CopyButton text={newSecret.raw_secret} />
                </div>
              </div>
            </div>
          )}
          <Button
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white mt-2"
            onClick={() => setNewSecret(null)}
          >
            Tôi đã lưu lại — Đóng dialog
          </Button>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteKey}
        onClose={() => setDeleteKey(null)}
        onConfirm={() => deleteKey && revokeKeyMutation.mutate(deleteKey.id)}
        loading={revokeKeyMutation.isPending}
        title={`Thu hồi API key "${deleteKey?.key_id}"?`}
        description="Key sẽ bị vô hiệu ngay lập tức."
        confirmLabel="Thu hồi"
        variant="destructive"
      />

      {/* ======= Rate Dialog ======= */}
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
            <div className="space-y-1.5">
              <Label>Loại tin *</Label>
              <Select
                defaultValue={editingRate?.delivery_type ?? "SMS"}
                onValueChange={(v) =>
                  setRateValue("delivery_type", v as DeliveryType)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="VOICE_OTP">Voice OTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                  setRateValue("unit", v as "MESSAGE" | "SECOND" | "CALL")
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
    </div>
  );
}
