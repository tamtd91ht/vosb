"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import {
  Plus,
  Loader2,
  ExternalLink,
  Ban,
  Users2,
  Pencil,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { Partner, PageResponse } from "@/lib/types";
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

const partnerSchema = z.object({
  code: z.string().min(1, "Bắt buộc"),
  name: z.string().min(1, "Bắt buộc"),
  dlr_url: z.string().url("URL không hợp lệ").optional().or(z.literal("")),
  dlr_method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
});

type PartnerForm = z.infer<typeof partnerSchema>;

export function PartnersClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [page, setPage] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Partner | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<Partner | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Partner | null>(null);

  const { data, isLoading } = useQuery<PageResponse<Partner>>({
    queryKey: ["partners", page],
    queryFn: () =>
      apiClient(token, "/api/admin/partners", {
        query: { page, size: 20 },
      }),
    enabled: !!token,
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PartnerForm>({
    resolver: zodResolver(partnerSchema),
    defaultValues: { dlr_method: "POST" },
  });

  const watchedDlrUrl = watch("dlr_url");

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, "/api/admin/partners", { method: "POST", body }),
    onSuccess: () => {
      toast.success("Tạo đối tác thành công");
      qc.invalidateQueries({ queryKey: ["partners"] });
      resetDialog();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiClient(token, `/api/admin/partners/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      toast.success("Cập nhật đối tác thành công");
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["partner"] });
      resetDialog();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const suspendMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient(token, `/api/admin/partners/${id}`, {
        method: "PUT",
        body: { status: "SUSPENDED" },
      }),
    onSuccess: () => {
      toast.success("Đã tạm dừng đối tác");
      qc.invalidateQueries({ queryKey: ["partners"] });
      setSuspendTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient(token, `/api/admin/partners/${id}`, {
        method: "PUT",
        body: { status: "ACTIVE" },
      }),
    onSuccess: () => {
      toast.success("Đã kích hoạt đối tác");
      qc.invalidateQueries({ queryKey: ["partners"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient(token, `/api/admin/partners/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Đã xóa đối tác");
      qc.invalidateQueries({ queryKey: ["partners"] });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Không thể xóa đối tác"
      );
    },
  });

  function openCreate() {
    setEditTarget(null);
    reset({ code: "", name: "", dlr_url: "", dlr_method: "POST" });
    setDialogOpen(true);
  }

  function openEdit(p: Partner) {
    setEditTarget(p);
    reset({
      code: p.code,
      name: p.name,
      dlr_url: p.dlr_webhook?.url ?? "",
      dlr_method: (p.dlr_webhook?.method ?? "POST") as
        | "GET"
        | "POST"
        | "PUT"
        | "PATCH",
    });
    setDialogOpen(true);
  }

  function resetDialog() {
    setDialogOpen(false);
    setEditTarget(null);
    reset();
  }

  const onSubmit = (formData: PartnerForm) => {
    if (editTarget) {
      const body: Record<string, unknown> = {
        name: formData.name,
        dlr_webhook: formData.dlr_url
          ? {
              url: formData.dlr_url,
              method: formData.dlr_method ?? "POST",
            }
          : null,
      };
      updateMutation.mutate({ id: editTarget.id, body });
    } else {
      const body: Record<string, unknown> = {
        code: formData.code.toUpperCase(),
        name: formData.name,
      };
      if (formData.dlr_url) {
        body.dlr_webhook = {
          url: formData.dlr_url,
          method: formData.dlr_method ?? "POST",
        };
      }
      createMutation.mutate(body);
    }
  };

  const partners = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);
  const mutPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      {/* Actions */}
      <div className="flex justify-end mb-4">
        <Button
          onClick={openCreate}
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Thêm đối tác
        </Button>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : partners.length === 0 ? (
            <EmptyState
              icon={Users2}
              title="Chưa có đối tác"
              description="Thêm đối tác đầu tiên để bắt đầu nhận tin nhắn"
              action={
                <Button
                  onClick={openCreate}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" /> Thêm đối tác
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Code
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Tên
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Trạng thái
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Số dư
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Tạo lúc
                    </th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {partners.map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-3">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-indigo-700">
                          {p.code}
                        </code>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {p.name}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {(p.balance ?? 0).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {format(new Date(p.created_at), "dd/MM/yyyy HH:mm", {
                          locale: vi,
                        })}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/admin/partners/${p.id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                            >
                              <ExternalLink className="w-3.5 h-3.5 mr-1" />
                              Chi tiết
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-gray-600 hover:text-indigo-700 hover:bg-indigo-50"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" />
                            Sửa
                          </Button>
                          {p.status === "ACTIVE" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                              onClick={() => setSuspendTarget(p)}
                            >
                              <Ban className="w-3.5 h-3.5 mr-1" />
                              Tạm dừng
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              disabled={reactivateMutation.isPending}
                              onClick={() => reactivateMutation.mutate(p.id)}
                            >
                              {reactivateMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              )}
                              Kích hoạt
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteTarget(p)}
                            title="Xóa đối tác"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
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
                Tổng {total} đối tác
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
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={page >= totalPages - 1}
                >
                  Sau
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) resetDialog();
        }}
      >
        <DialogContent className="max-w-lg" key={editTarget?.id ?? "create"}>
          <DialogHeader>
            <DialogTitle>
              {editTarget ? `Sửa đối tác "${editTarget.name}"` : "Thêm đối tác mới"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input
                  {...register("code")}
                  placeholder="VD: PARTNER_01"
                  style={{ textTransform: "uppercase" }}
                  disabled={!!editTarget}
                  readOnly={!!editTarget}
                  className={
                    editTarget ? "bg-gray-50 cursor-not-allowed" : undefined
                  }
                />
                {errors.code && (
                  <p className="text-red-500 text-xs">{errors.code.message}</p>
                )}
                {editTarget && (
                  <p className="text-[10px] text-gray-400">
                    Code không đổi được sau khi tạo
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Tên *</Label>
                <Input {...register("name")} placeholder="Tên đối tác" />
                {errors.name && (
                  <p className="text-red-500 text-xs">{errors.name.message}</p>
                )}
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium text-gray-700">
                DLR Webhook (tùy chọn)
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">URL</Label>
                <Input
                  {...register("dlr_url")}
                  placeholder="https://partner.example.com/dlr"
                />
                {errors.dlr_url && (
                  <p className="text-red-500 text-xs">
                    {errors.dlr_url.message}
                  </p>
                )}
                {editTarget && (
                  <p className="text-[10px] text-gray-400">
                    Để trống URL sẽ xóa cấu hình webhook DLR.
                  </p>
                )}
              </div>
              {watchedDlrUrl && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Method</Label>
                  <Select
                    defaultValue={
                      editTarget?.dlr_webhook?.method ?? "POST"
                    }
                    onValueChange={(v) =>
                      setValue(
                        "dlr_method",
                        v as "GET" | "POST" | "PUT" | "PATCH"
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                disabled={isSubmitting || mutPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(isSubmitting || mutPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                {editTarget ? "Lưu thay đổi" : "Tạo đối tác"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Suspend Dialog */}
      <ConfirmDialog
        open={!!suspendTarget}
        onClose={() => setSuspendTarget(null)}
        onConfirm={() =>
          suspendTarget && suspendMutation.mutate(suspendTarget.id)
        }
        loading={suspendMutation.isPending}
        title={`Tạm dừng đối tác "${suspendTarget?.name}"?`}
        description="Đối tác sẽ không thể gửi tin nhắn sau khi bị tạm dừng. Bạn vẫn có thể kích hoạt lại sau."
        confirmLabel="Tạm dừng"
        variant="destructive"
      />

      {/* Soft Delete Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() =>
          deleteTarget && deleteMutation.mutate(deleteTarget.id)
        }
        loading={deleteMutation.isPending}
        title={`Xóa đối tác "${deleteTarget?.name}"?`}
        description={
          `Đối tác sẽ bị ẩn khỏi danh sách quản trị. ` +
          `Dữ liệu (tin nhắn, DLR, audit log, …) vẫn được giữ nguyên trong cơ sở dữ liệu để đối soát sau này.`
        }
        confirmLabel="Xóa"
        variant="destructive"
      />
    </div>
  );
}
