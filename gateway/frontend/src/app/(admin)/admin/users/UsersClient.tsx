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
import { Plus, Loader2, Eye, EyeOff, UserCog, Pencil } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { AdminUser, PageResponse } from "@/lib/types";
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
import { EmptyState } from "@/components/common/EmptyState";
import { Switch } from "@/components/ui/switch";

const createUserSchema = z.object({
  username: z.string().min(3, "Tối thiểu 3 ký tự"),
  password: z.string().min(8, "Tối thiểu 8 ký tự"),
  role: z.enum(["ADMIN", "PARTNER"]),
  partner_id: z.coerce.number().int().optional(),
});
type CreateUserForm = z.infer<typeof createUserSchema>;

const editUserSchema = z.object({
  password: z.string().min(8, "Tối thiểu 8 ký tự").optional().or(z.literal("")),
  enabled: z.boolean(),
});
type EditUserForm = z.infer<typeof editUserSchema>;

export function UsersClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery<PageResponse<AdminUser>>({
    queryKey: ["users", page],
    queryFn: () =>
      apiClient(token, "/api/admin/users", { query: { page, size: 20 } }),
    enabled: !!token,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createUserSchema) as any,
    defaultValues: { role: "ADMIN" },
  });

  const watchedRole = watch("role");

  const {
    register: regEdit,
    handleSubmit: handleEdit,
    reset: resetEdit,
    setValue: setEditValue,
    formState: { isSubmitting: editSubmitting },
  } = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { enabled: true },
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient(token, "/api/admin/users", { method: "POST", body }),
    onSuccess: () => {
      toast.success("Tạo người dùng thành công");
      qc.invalidateQueries({ queryKey: ["users"] });
      setCreateOpen(false);
      reset();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiClient(token, `/api/admin/users/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      toast.success("Cập nhật thành công");
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const onCreateSubmit = (data: CreateUserForm) => {
    const body: Record<string, unknown> = {
      username: data.username,
      password: data.password,
      role: data.role,
    };
    if (data.role === "PARTNER" && data.partner_id) {
      body.partner_id = data.partner_id;
    }
    createMutation.mutate(body);
  };

  const onEditSubmit = (data: EditUserForm) => {
    if (!editTarget) return;
    const body: Record<string, unknown> = { enabled: data.enabled };
    if (data.password) body.password = data.password;
    editMutation.mutate({ id: editTarget.id, body });
  };

  const openEdit = (user: AdminUser) => {
    setEditTarget(user);
    setEditValue("enabled", user.enabled);
    setEditValue("password", "");
  };

  const users = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Thêm người dùng
        </Button>
      </div>

      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : users.length === 0 ? (
            <EmptyState
              icon={UserCog}
              title="Chưa có người dùng"
              description="Thêm tài khoản quản trị đầu tiên"
              action={
                <Button
                  onClick={() => setCreateOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" /> Thêm người dùng
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tên đăng nhập</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vai trò</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Partner</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Trạng thái</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Đăng nhập cuối</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tạo lúc</th>
                    <th className="text-right px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-900">
                        {user.username}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={user.role} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {user.partner_id ? `#${user.partner_id}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            user.enabled
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : "bg-gray-100 text-gray-600 border-gray-200"
                          }
                        >
                          {user.enabled ? "Hoạt động" : "Vô hiệu"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {user.last_login_at
                          ? format(new Date(user.last_login_at), "dd/MM/yyyy HH:mm", { locale: vi })
                          : "Chưa đăng nhập"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {format(new Date(user.created_at), "dd/MM/yyyy HH:mm", { locale: vi })}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => openEdit(user)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
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
              <span className="text-xs text-gray-500">
                Tổng {total} người dùng
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm người dùng mới</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Tên đăng nhập *</Label>
              <Input {...register("username")} placeholder="admin_user" autoComplete="off" />
              {errors.username && (
                <p className="text-red-500 text-xs">{errors.username.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Mật khẩu *</Label>
              <div className="relative">
                <Input
                  {...register("password")}
                  type={showPwd ? "text" : "password"}
                  placeholder="Tối thiểu 8 ký tự"
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPwd ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-red-500 text-xs">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Vai trò *</Label>
              <Select
                defaultValue="ADMIN"
                onValueChange={(v) => setValue("role", v as "ADMIN" | "PARTNER")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="PARTNER">Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {watchedRole === "PARTNER" && (
              <div className="space-y-1.5">
                <Label>Partner ID</Label>
                <Input
                  {...register("partner_id")}
                  type="number"
                  placeholder="ID của partner"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setCreateOpen(false); reset(); }}
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
                Tạo người dùng
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sửa: {editTarget?.username}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={handleEdit(onEditSubmit)}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label>Mật khẩu mới (để trống nếu không đổi)</Label>
              <Input
                {...regEdit("password")}
                type="password"
                placeholder="Mật khẩu mới..."
                autoComplete="new-password"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-gray-700">Kích hoạt</p>
                <p className="text-xs text-gray-500">
                  Tài khoản có thể đăng nhập
                </p>
              </div>
              <Switch
                checked={editTarget?.enabled ?? true}
                onCheckedChange={(v) => setEditValue("enabled", v)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setEditTarget(null); resetEdit(); }}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={editSubmitting || editMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {(editSubmitting || editMutation.isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Lưu thay đổi
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
