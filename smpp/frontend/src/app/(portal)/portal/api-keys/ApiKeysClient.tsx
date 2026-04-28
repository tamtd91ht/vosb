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
import { Plus, Copy, Eye, EyeOff, AlertTriangle, KeyRound } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { PartnerApiKey } from "@/lib/types";

interface NewKey { key_id: string; raw_secret: string; label: string; }

export function ApiKeysClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [revealedKey, setRevealedKey] = useState<NewKey | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const { data: keys, isLoading } = useQuery<PartnerApiKey[]>({
    queryKey: ["portal", "api-keys"],
    queryFn: () => apiClient(token, "/api/portal/api-keys"),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (label: string) =>
      apiClient(token, "/api/portal/api-keys", { method: "POST", body: { label: label || undefined } }),
    onSuccess: (data: NewKey) => {
      qc.invalidateQueries({ queryKey: ["portal", "api-keys"] });
      setNewKeyOpen(false);
      setLabelInput("");
      setRevealedKey(data);
      setShowSecret(false);
    },
    onError: () => toast.error("Không thể tạo API key"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient(token, `/api/portal/api-keys/${id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal", "api-keys"] });
      toast.success("Đã thu hồi API key");
    },
    onError: () => toast.error("Không thể thu hồi API key"),
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`Đã sao chép ${label}`));
  };

  return (
    <>
      {/* Header action */}
      <div className="flex justify-end mb-4">
        <Button className="bg-sky-600 hover:bg-sky-500 text-white gap-2" onClick={() => setNewKeyOpen(true)}>
          <Plus className="w-4 h-4" /> Tạo API Key
        </Button>
      </div>

      {/* Table */}
      <Card className="border border-slate-100 shadow-sm bg-white">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Label</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Key ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Trạng thái</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Dùng lần cuối</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Tạo lúc</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}</tr>
                ))
              ) : keys?.map((key) => (
                <tr key={key.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{key.label || <span className="text-slate-300 italic">Không có label</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{key.key_id}</code>
                      <button onClick={() => copyToClipboard(key.key_id, "Key ID")} className="text-slate-300 hover:text-slate-600">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={key.status} /></td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{key.last_used_at ? format(new Date(key.last_used_at), "dd/MM HH:mm", { locale: vi }) : "Chưa dùng"}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{key.created_at ? format(new Date(key.created_at), "dd/MM/yyyy", { locale: vi }) : "—"}</td>
                  <td className="px-4 py-3">
                    {key.status === "ACTIVE" && (
                      <Button variant="outline" size="sm" className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => revokeMutation.mutate(key.id)}>
                        Thu hồi
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && (!keys || keys.length === 0) && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  <KeyRound className="w-8 h-8 mx-auto mb-2 text-slate-200" />
                  <p>Chưa có API key nào. Hãy tạo key đầu tiên.</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={newKeyOpen} onOpenChange={setNewKeyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo API Key mới</DialogTitle>
            <DialogDescription>Label giúp bạn phân biệt các key với nhau.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Label (tùy chọn)</Label>
              <Input placeholder="Production, Staging, ..." value={labelInput} onChange={(e) => setLabelInput(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNewKeyOpen(false)}>Hủy</Button>
              <Button className="bg-sky-600 hover:bg-sky-500 text-white" disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(labelInput)}>
                {createMutation.isPending ? "Đang tạo..." : "Tạo key"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Secret reveal dialog */}
      <Dialog open={!!revealedKey} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <KeyRound className="w-5 h-5" /> API Key tạo thành công
            </DialogTitle>
          </DialogHeader>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              <strong>Đây là lần DUY NHẤT bạn thấy secret này.</strong> Hãy sao chép và lưu ngay. Sau khi đóng, TKC Gateway không thể hiển thị lại.
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 font-medium">Key ID</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-xs font-mono bg-slate-100 rounded px-3 py-2 text-slate-800">{revealedKey?.key_id}</code>
                <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => copyToClipboard(revealedKey!.key_id, "Key ID")}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Secret Key</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-xs font-mono bg-slate-100 rounded px-3 py-2 text-slate-800 break-all">
                  {showSecret ? revealedKey?.raw_secret : "•".repeat(44)}
                </code>
                <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => setShowSecret(!showSecret)}>
                  {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
                <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => copyToClipboard(revealedKey!.raw_secret, "Secret Key")}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <Button className="w-full bg-sky-600 hover:bg-sky-500 text-white mt-2" onClick={() => setRevealedKey(null)}>
            Tôi đã lưu lại — Đóng dialog
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
