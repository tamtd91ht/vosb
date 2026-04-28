"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Loader2, Radio, Globe, Phone, ArrowLeft, Server } from "lucide-react";
import Link from "next/link";
import { apiClient, ApiError } from "@/lib/api";
import {
  Channel,
  ChannelType,
  DeliveryType,
  HttpProvider,
  PageResponse,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
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

const TYPE_ICONS: Record<ChannelType, React.ElementType> = {
  HTTP_THIRD_PARTY: Globe,
  FREESWITCH_ESL: Phone,
  TELCO_SMPP: Radio,
};

// ---- Form schemas ----
const baseSchema = z.object({
  code: z.string().min(1, "Bắt buộc"),
  name: z.string().min(1, "Bắt buộc"),
});

const smppConfigSchema = baseSchema.extend({
  smpp_host: z.string().min(1, "Bắt buộc"),
  smpp_port: z.coerce.number().int().min(1),
  smpp_system_id: z.string().min(1, "Bắt buộc"),
  smpp_password: z.string().min(1, "Bắt buộc"),
});

const eslConfigSchema = baseSchema.extend({
  esl_host: z.string().min(1, "Bắt buộc"),
  esl_port: z.coerce.number().int().min(1),
  esl_password: z.string().min(1, "Bắt buộc"),
});

const httpConfigSchema = baseSchema.extend({
  http_provider_code: z.string().min(1, "Chọn nhà cung cấp"),
  // dynamic fields stored by key
  http_dynamic: z.record(z.string(), z.string()).optional(),
});

type SmppForm = z.infer<typeof smppConfigSchema>;
type EslForm = z.infer<typeof eslConfigSchema>;
type HttpForm = z.infer<typeof httpConfigSchema>;

// ---- Step type ----
type Category = "SMS" | "VOICE_OTP";
type ProviderSubtype = "TELCO_SMPP" | "HTTP_SMS" | "ESL" | "HTTP_VOICE";

// ---- Channel card ----
function ChannelCard({ channel }: { channel: Channel }) {
  const typeInfo = TYPE_LABELS[channel.type];
  const TypeIcon = TYPE_ICONS[channel.type];
  return (
    <Card className="border border-gray-100 shadow-sm bg-white">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 truncate">
                {channel.name}
              </span>
              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-indigo-700">
                {channel.code}
              </code>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-medium border",
                  typeInfo.color
                )}
              >
                <TypeIcon className="w-3 h-3 mr-1" />
                {typeInfo.label}
              </Badge>
              <StatusBadge status={channel.status} />
            </div>
          </div>
          <Link href={`/admin/providers/${channel.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs h-8"
            >
              Chi tiết
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Skeleton cards ----
function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="border border-gray-100 shadow-sm bg-white">
          <CardContent className="p-5 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-16" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ProvidersClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  // Dialog state machine
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStep, setDialogStep] = useState<1 | 2 | 3>(1);
  const [category, setCategory] = useState<Category | null>(null);
  const [subtype, setSubtype] = useState<ProviderSubtype | null>(null);
  const [selectedHttpProvider, setSelectedHttpProvider] = useState<
    HttpProvider | null
  >(null);
  const [dynamicValues, setDynamicValues] = useState<Record<string, string>>(
    {}
  );

  // Queries
  const { data: channelsPage, isLoading: channelsLoading } =
    useQuery<PageResponse<Channel>>({
      queryKey: ["channels", "all"],
      queryFn: () => apiClient(token, "/api/admin/channels", { query: { size: 100 } }),
      enabled: true,
    });

  const { data: httpProviders } = useQuery<HttpProvider[]>({
    queryKey: ["channels", "http-providers"],
    queryFn: () => apiClient(token, "/api/admin/channels/http-providers"),
    enabled: true,
  });

  // SMPP form
  const {
    register: regSmpp,
    handleSubmit: handleSmpp,
    reset: resetSmpp,
    formState: { errors: smppErrors, isSubmitting: smppSubmitting },
  } = useForm<SmppForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(smppConfigSchema) as any,
    defaultValues: { smpp_port: 2775 },
  });

  // ESL form
  const {
    register: regEsl,
    handleSubmit: handleEsl,
    reset: resetEsl,
    formState: { errors: eslErrors, isSubmitting: eslSubmitting },
  } = useForm<EslForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(eslConfigSchema) as any,
    defaultValues: { esl_port: 8021 },
  });

  // HTTP form
  const {
    register: regHttp,
    handleSubmit: handleHttp,
    reset: resetHttp,
    setValue: setHttpValue,
    formState: { errors: httpErrors, isSubmitting: httpSubmitting },
  } = useForm<HttpForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(httpConfigSchema) as any,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, "/api/admin/channels", { method: "POST", body }),
    onSuccess: () => {
      toast.success("Tạo nhà cung cấp thành công");
      qc.invalidateQueries({ queryKey: ["channels"] });
      closeDialog();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  function closeDialog() {
    setDialogOpen(false);
    setDialogStep(1);
    setCategory(null);
    setSubtype(null);
    setSelectedHttpProvider(null);
    setDynamicValues({});
    resetSmpp();
    resetEsl();
    resetHttp();
  }

  function openDialog() {
    closeDialog();
    setDialogOpen(true);
  }

  // Submit handlers
  function onSmppSubmit(data: SmppForm) {
    createMutation.mutate({
      code: data.code,
      name: data.name,
      type: "TELCO_SMPP" as ChannelType,
      delivery_type: "SMS" as DeliveryType,
      config: {
        host: data.smpp_host,
        port: data.smpp_port,
        system_id: data.smpp_system_id,
        password: data.smpp_password,
      },
    });
  }

  function onEslSubmit(data: EslForm) {
    createMutation.mutate({
      code: data.code,
      name: data.name,
      type: "FREESWITCH_ESL" as ChannelType,
      delivery_type: "VOICE_OTP" as DeliveryType,
      config: {
        host: data.esl_host,
        port: data.esl_port,
        password: data.esl_password,
      },
    });
  }

  function onHttpSubmit(data: HttpForm) {
    const deliveryType: DeliveryType =
      subtype === "HTTP_VOICE" ? "VOICE_OTP" : "SMS";
    createMutation.mutate({
      code: data.code,
      name: data.name,
      type: "HTTP_THIRD_PARTY" as ChannelType,
      delivery_type: deliveryType,
      config: {
        provider_code: data.http_provider_code,
        ...dynamicValues,
      },
    });
  }

  // Split channels by delivery type
  const channels = channelsPage?.items ?? [];
  const smsChannels = channels.filter((c) => c.delivery_type === "SMS");
  const voiceChannels = channels.filter(
    (c) => c.delivery_type === "VOICE_OTP"
  );

  // HTTP providers filtered by subtype
  const filteredHttpProviders = (httpProviders ?? []).filter((p) =>
    subtype === "HTTP_VOICE"
      ? p.delivery_type === "VOICE_OTP"
      : p.delivery_type === "SMS"
  );

  // --- Render dialog content by step ---
  function renderDialogContent() {
    // Step 1: choose category
    if (dialogStep === 1) {
      return (
        <div className="space-y-3 mt-2">
          <button
            type="button"
            onClick={() => {
              setCategory("SMS");
              setDialogStep(2);
            }}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-left transition-all"
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-orange-100 text-orange-700 border border-orange-200">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">SMS Provider</p>
              <p className="text-xs text-gray-500">
                Nhà cung cấp gửi tin nhắn SMS (SMPP hoặc HTTP API)
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setCategory("VOICE_OTP");
              setDialogStep(2);
            }}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-left transition-all"
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-violet-100 text-violet-700 border border-violet-200">
              <Phone className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Voice OTP Provider</p>
              <p className="text-xs text-gray-500">
                Nhà cung cấp Voice OTP (FreeSWITCH ESL hoặc HTTP Voice API)
              </p>
            </div>
          </button>
        </div>
      );
    }

    // Step 2: choose provider subtype
    if (dialogStep === 2) {
      const options: {
        key: ProviderSubtype;
        label: string;
        desc: string;
        icon: React.ElementType;
        color: string;
      }[] =
        category === "SMS"
          ? [
              {
                key: "TELCO_SMPP",
                label: "Telco SMPP",
                desc: "Kết nối SMPP client tới nhà mạng",
                icon: Server,
                color: "bg-orange-100 text-orange-700 border-orange-200",
              },
              {
                key: "HTTP_SMS",
                label: "HTTP SMS API",
                desc: "Gọi HTTP API của nhà cung cấp SMS",
                icon: Globe,
                color: "bg-blue-100 text-blue-700 border-blue-200",
              },
            ]
          : [
              {
                key: "ESL",
                label: "FreeSWITCH ESL",
                desc: "Voice OTP qua FreeSWITCH Event Socket",
                icon: Phone,
                color: "bg-violet-100 text-violet-700 border-violet-200",
              },
              {
                key: "HTTP_VOICE",
                label: "HTTP Voice API",
                desc: "Gọi HTTP API Voice OTP",
                icon: Globe,
                color: "bg-blue-100 text-blue-700 border-blue-200",
              },
            ];

      return (
        <div className="space-y-3 mt-2">
          <button
            type="button"
            onClick={() => setDialogStep(1)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Quay lại
          </button>
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setSubtype(opt.key);
                  setDialogStep(3);
                }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-left transition-all"
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center border",
                    opt.color
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      );
    }

    // Step 3: form
    if (dialogStep === 3) {
      const isPending = createMutation.isPending;

      // SMPP form
      if (subtype === "TELCO_SMPP") {
        return (
          <form
            onSubmit={handleSmpp(onSmppSubmit)}
            className="space-y-4 mt-2"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input {...regSmpp("code")} placeholder="VD: SMPP_VTG" />
                {smppErrors.code && (
                  <p className="text-red-500 text-xs">
                    {smppErrors.code.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Tên *</Label>
                <Input {...regSmpp("name")} placeholder="Tên nhà cung cấp" />
                {smppErrors.name && (
                  <p className="text-red-500 text-xs">
                    {smppErrors.name.message}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-3 border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-600 uppercase">
                SMPP Config
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Host *</Label>
                  <Input
                    {...regSmpp("smpp_host")}
                    placeholder="smpp.telco.com"
                  />
                  {smppErrors.smpp_host && (
                    <p className="text-red-500 text-xs">
                      {smppErrors.smpp_host.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Port *</Label>
                  <Input
                    {...regSmpp("smpp_port")}
                    type="number"
                    defaultValue={2775}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">System ID *</Label>
                  <Input {...regSmpp("smpp_system_id")} placeholder="user" />
                  {smppErrors.smpp_system_id && (
                    <p className="text-red-500 text-xs">
                      {smppErrors.smpp_system_id.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password *</Label>
                  <Input
                    {...regSmpp("smpp_password")}
                    type="password"
                    placeholder="Mật khẩu"
                  />
                  {smppErrors.smpp_password && (
                    <p className="text-red-500 text-xs">
                      {smppErrors.smpp_password.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogStep(2)}
              >
                Quay lại
              </Button>
              <Button
                type="submit"
                disabled={smppSubmitting || isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(smppSubmitting || isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Tạo nhà cung cấp
              </Button>
            </div>
          </form>
        );
      }

      // ESL form
      if (subtype === "ESL") {
        return (
          <form onSubmit={handleEsl(onEslSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input {...regEsl("code")} placeholder="VD: FSW_01" />
                {eslErrors.code && (
                  <p className="text-red-500 text-xs">
                    {eslErrors.code.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Tên *</Label>
                <Input {...regEsl("name")} placeholder="Tên nhà cung cấp" />
                {eslErrors.name && (
                  <p className="text-red-500 text-xs">
                    {eslErrors.name.message}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-3 border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-600 uppercase">
                FreeSWITCH ESL Config
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Host *</Label>
                  <Input {...regEsl("esl_host")} placeholder="127.0.0.1" />
                  {eslErrors.esl_host && (
                    <p className="text-red-500 text-xs">
                      {eslErrors.esl_host.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Port *</Label>
                  <Input
                    {...regEsl("esl_port")}
                    type="number"
                    defaultValue={8021}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Password *</Label>
                <Input
                  {...regEsl("esl_password")}
                  type="password"
                  placeholder="ClueCon"
                />
                {eslErrors.esl_password && (
                  <p className="text-red-500 text-xs">
                    {eslErrors.esl_password.message}
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-between pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogStep(2)}
              >
                Quay lại
              </Button>
              <Button
                type="submit"
                disabled={eslSubmitting || isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(eslSubmitting || isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Tạo nhà cung cấp
              </Button>
            </div>
          </form>
        );
      }

      // HTTP form (SMS or Voice)
      if (subtype === "HTTP_SMS" || subtype === "HTTP_VOICE") {
        return (
          <form
            onSubmit={handleHttp(onHttpSubmit)}
            className="space-y-4 mt-2"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input
                  {...regHttp("code")}
                  placeholder={
                    subtype === "HTTP_SMS" ? "VD: HTTP_SMS_VTG" : "VD: HTTP_VOICE_01"
                  }
                />
                {httpErrors.code && (
                  <p className="text-red-500 text-xs">
                    {httpErrors.code.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Tên *</Label>
                <Input {...regHttp("name")} placeholder="Tên nhà cung cấp" />
                {httpErrors.name && (
                  <p className="text-red-500 text-xs">
                    {httpErrors.name.message}
                  </p>
                )}
              </div>
            </div>

            {/* Provider selection */}
            <div className="space-y-1.5">
              <Label>Nhà cung cấp *</Label>
              <Select
                onValueChange={(val) => {
                  if (!val) return;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  setHttpValue("http_provider_code", val as any);
                  const found =
                    filteredHttpProviders.find((p) => p.code === val) ?? null;
                  setSelectedHttpProvider(found);
                  setDynamicValues({});
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn nhà cung cấp..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredHttpProviders.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {httpErrors.http_provider_code && (
                <p className="text-red-500 text-xs">
                  {httpErrors.http_provider_code.message}
                </p>
              )}
            </div>

            {/* Dynamic fields from selected provider */}
            {selectedHttpProvider && selectedHttpProvider.fields.length > 0 && (
              <div className="space-y-3 border border-gray-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-600 uppercase">
                  Cấu hình {selectedHttpProvider.name}
                </p>
                {selectedHttpProvider.fields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs">
                      {field.label}
                      {field.required && " *"}
                    </Label>
                    <Input
                      type={field.type === "password" ? "password" : "text"}
                      placeholder={field.hint ?? field.defaultValue ?? ""}
                      value={dynamicValues[field.key] ?? field.defaultValue ?? ""}
                      onChange={(e) =>
                        setDynamicValues((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogStep(2)}
              >
                Quay lại
              </Button>
              <Button
                type="submit"
                disabled={httpSubmitting || isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(httpSubmitting || isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Tạo nhà cung cấp
              </Button>
            </div>
          </form>
        );
      }

      return null;
    }

    return null;
  }

  const dialogTitles: Record<number, string> = {
    1: "Thêm nhà cung cấp — Chọn loại",
    2: "Thêm nhà cung cấp — Chọn kiểu kết nối",
    3: "Thêm nhà cung cấp — Cấu hình",
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nhà cung cấp</h1>
          <p className="text-sm text-gray-500 mt-1">
            Quản lý kênh SMS và Voice OTP
          </p>
        </div>
        <Button
          onClick={openDialog}
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Thêm nhà cung cấp
        </Button>
      </div>

      {/* SMS section */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Radio className="w-4 h-4 text-orange-600" />
          SMS Providers
        </h2>
        {channelsLoading ? (
          <SkeletonCards count={3} />
        ) : smsChannels.length === 0 ? (
          <Card className="border border-dashed border-gray-200 bg-white">
            <CardContent className="p-0">
              <EmptyState
                icon={Radio}
                title="Chưa có nhà cung cấp SMS nào"
                description="Thêm kênh SMS để bắt đầu gửi tin nhắn"
                action={
                  <Button
                    onClick={openDialog}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" /> Thêm SMS Provider
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {smsChannels.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} />
            ))}
          </div>
        )}
      </section>

      {/* Voice section */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Phone className="w-4 h-4 text-violet-600" />
          Voice OTP Providers
        </h2>
        {channelsLoading ? (
          <SkeletonCards count={2} />
        ) : voiceChannels.length === 0 ? (
          <Card className="border border-dashed border-gray-200 bg-white">
            <CardContent className="p-0">
              <EmptyState
                icon={Phone}
                title="Chưa có nhà cung cấp Voice OTP nào"
                description="Thêm kênh Voice OTP để gửi mã OTP qua cuộc gọi"
                action={
                  <Button
                    onClick={openDialog}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" /> Thêm Voice Provider
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {voiceChannels.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} />
            ))}
          </div>
        )}
      </section>

      {/* Create dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) closeDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitles[dialogStep]}</DialogTitle>
          </DialogHeader>
          {renderDialogContent()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
