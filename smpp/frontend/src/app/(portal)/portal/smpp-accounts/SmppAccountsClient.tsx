"use client";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Server, KeyRound } from "lucide-react";
import { PartnerSmppAccount } from "@/lib/types";

export function SmppAccountsClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: accounts, isLoading } = useQuery<PartnerSmppAccount[]>({
    queryKey: ["portal", "smpp-accounts"],
    queryFn: () => apiClient(token, "/api/portal/smpp-accounts"),
    enabled: !!token,
  });

  const changePwMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      apiClient(token, `/api/portal/smpp-accounts/${id}/change-password`, {
        method: "POST",
        body: { new_password: password },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal", "smpp-accounts"] });
      toast.success("Đã cập nhật mật khẩu SMPP. Kết nối hiện tại sẽ bị ngắt.");
      setSelectedId(null);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: () => toast.error("Không thể đổi mật khẩu"),
  });

  const handleSubmit = () => {
    if (newPassword.length < 8) { toast.error("Mật khẩu phải ít nhất 8 ký tự"); return; }
    if (newPassword !== confirmPassword) { toast.error("Mật khẩu xác nhận không khớp"); return; }
    if (selectedId) changePwMutation.mutate({ id: selectedId, password: newPassword });
  };

  return (
    <>
      <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-4 text-sm text-sky-700">
        <strong>Lưu ý:</strong> Sau khi đổi mật khẩu, các phiên SMPP đang kết nối sẽ bị ngắt và cần đăng nhập lại. Để thay đổi cấu hình khác (system_id, max_binds, IP whitelist), vui lòng liên hệ admin.
      </div>

      <Card className="border border-slate-100 shadow-sm bg-white">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">System ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Max Binds</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">IP Whitelist</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Trạng thái</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}</tr>
                ))
              ) : accounts?.map((acc) => (
                <tr key={acc.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-slate-400" />
                      <code className="font-mono text-sm text-slate-800">{acc.system_id}</code>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{acc.max_binds}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {acc.ip_whitelist
                      ? (Array.isArray(acc.ip_whitelist) ? acc.ip_whitelist : [acc.ip_whitelist]).join(", ") || "Không giới hạn"
                      : "Không giới hạn"}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={acc.status} /></td>
                  <td className="px-4 py-3">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                      onClick={() => { setSelectedId(acc.id); setNewPassword(""); setConfirmPassword(""); }}>
                      <KeyRound className="w-3 h-3" /> Đổi mật khẩu
                    </Button>
                  </td>
                </tr>
              ))}
              {!isLoading && (!accounts || accounts.length === 0) && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">Chưa có SMPP account nào</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedId} onOpenChange={() => setSelectedId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi mật khẩu SMPP</DialogTitle>
            <DialogDescription>Mật khẩu mới sẽ có hiệu lực ngay sau khi lưu.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Mật khẩu mới (tối thiểu 8 ký tự)</Label>
              <Input type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Xác nhận mật khẩu</Label>
              <Input type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSelectedId(null)}>Hủy</Button>
              <Button className="bg-sky-600 hover:bg-sky-500 text-white" disabled={changePwMutation.isPending} onClick={handleSubmit}>
                {changePwMutation.isPending ? "Đang lưu..." : "Lưu mật khẩu"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
