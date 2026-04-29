"use client";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

interface Header { key: string; value: string; }
interface Overview { dlr_webhook?: { url?: string; method?: string; headers?: Record<string, string> } | null; }

export function WebhookClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [headers, setHeaders] = useState<Header[]>([]);

  // Load current config from overview
  const { data: overview } = useQuery<Overview>({
    queryKey: ["portal", "overview"],
    queryFn: () => apiClient(token, "/api/portal/overview"),
    enabled: !!token,
  });

  useEffect(() => {
    const wh = overview?.dlr_webhook;
    if (wh) {
      setUrl(wh.url ?? "");
      setMethod(wh.method ?? "POST");
      setHeaders(Object.entries(wh.headers ?? {}).map(([key, value]) => ({ key, value })));
    }
  }, [overview]);

  const mutation = useMutation({
    mutationFn: () => {
      const headersObj = headers.reduce<Record<string, string>>((acc, h) => {
        if (h.key.trim()) acc[h.key.trim()] = h.value;
        return acc;
      }, {});
      return apiClient(token, "/api/portal/webhook", {
        method: "PATCH",
        body: { dlr_webhook: { url, method, headers: headersObj } },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal", "overview"] });
      toast.success("Đã lưu cấu hình webhook");
    },
    onError: (err: Error) => toast.error(err.message || "Không thể lưu webhook"),
  });

  const addHeader = () => setHeaders([...headers, { key: "", value: "" }]);
  const removeHeader = (idx: number) => setHeaders(headers.filter((_, i) => i !== idx));
  const updateHeader = (idx: number, field: "key" | "value", val: string) =>
    setHeaders(headers.map((h, i) => i === idx ? { ...h, [field]: val } : h));

  return (
    <div className="max-w-2xl space-y-6">
      {/* Info box */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
        Khi tin nhắn có trạng thái mới (<strong>DELIVERED</strong> hoặc <strong>FAILED</strong>), VSO Gateway sẽ gửi HTTP request đến URL bên dưới với payload JSON:
        <pre className="mt-2 bg-white border border-slate-200 rounded p-2 text-xs overflow-x-auto text-slate-700">
{`{ "message_id": "uuid...", "state": "DELIVERED",
  "dest_addr": "84901234567", "delivered_at": "2026-04-28T..." }`}
        </pre>
      </div>

      <Card className="border border-slate-100 shadow-sm bg-white">
        <CardContent className="p-6 space-y-5">
          {/* URL */}
          <div className="space-y-1.5">
            <Label>Webhook URL <span className="text-red-500">*</span></Label>
            <Input
              placeholder="https://your-server.com/dlr-callback"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          {/* Method */}
          <div className="space-y-1.5">
            <Label>HTTP Method</Label>
            <Select value={method} onValueChange={(v: string | null) => { if (v) setMethod(v); }}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH"].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Headers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Custom Headers <span className="text-slate-400 text-xs font-normal">(tùy chọn)</span></Label>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addHeader}>
                <Plus className="w-3 h-3" /> Thêm header
              </Button>
            </div>
            {headers.map((header, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input className="flex-1" placeholder="Header name" value={header.key} onChange={(e) => updateHeader(idx, "key", e.target.value)} />
                <span className="text-slate-300 text-sm">:</span>
                <Input className="flex-1" placeholder="Value" value={header.value} onChange={(e) => updateHeader(idx, "value", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="w-8 h-8 text-slate-400 hover:text-red-500" onClick={() => removeHeader(idx)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {headers.length === 0 && (
              <p className="text-xs text-slate-400 italic">Chưa có custom header nào</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                const wh = overview?.dlr_webhook;
                setUrl(wh?.url ?? "");
                setMethod(wh?.method ?? "POST");
                setHeaders(Object.entries(wh?.headers ?? {}).map(([key, value]) => ({ key, value })));
              }}
            >
              Hủy thay đổi
            </Button>
            <Button
              className="bg-sky-600 hover:bg-sky-500 text-white"
              disabled={!url || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Đang lưu..." : "Lưu cấu hình"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
