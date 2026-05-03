"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { Loader2, Wifi, X } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { SmppSession } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";

type SessionsResponse = {
  items: SmppSession[];
  total: number;
};

const BIND_TYPE_COLOR: Record<string, string> = {
  RX: "bg-blue-100 text-blue-700 border-blue-200",
  TX: "bg-violet-100 text-violet-700 border-violet-200",
  TRX: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export function SessionsClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;
  const qc = useQueryClient();

  const [kickTarget, setKickTarget] = useState<SmppSession | null>(null);

  const { data, isLoading } = useQuery<SessionsResponse>({
    queryKey: ["sessions"],
    queryFn: () => apiClient(token, "/api/admin/sessions"),
    enabled: !!token,
    refetchInterval: 5000,
  });

  const kickMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiClient(token, `/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Đã ngắt phiên SMPP");
      qc.invalidateQueries({ queryKey: ["sessions"] });
      setKickTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi");
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">
          Tự động làm mới mỗi 5 giây · Tổng {total} phiên đang bind
        </p>
      </div>

      <Card className="border-0 shadow-sm bg-white">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Wifi}
              title="Không có phiên SMPP"
              description="Chưa có partner nào đang bind tới SMPP server. Phiên sẽ xuất hiện ngay khi bind thành công."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      System ID
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Bind type
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Remote IP
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Session ID
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Bound at
                    </th>
                    <th className="text-right px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((s) => (
                    <tr
                      key={s.session_id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-3">
                        <code className="text-xs bg-indigo-50 px-1.5 py-0.5 rounded font-mono text-indigo-700">
                          {s.system_id}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium ${
                            BIND_TYPE_COLOR[s.bind_type] ??
                            "bg-gray-100 text-gray-700 border-gray-200"
                          }`}
                        >
                          {s.bind_type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {s.remote_ip}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">
                        {s.session_id}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {format(new Date(s.bound_at), "dd/MM/yyyy HH:mm:ss", {
                          locale: vi,
                        })}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setKickTarget(s)}
                        >
                          <X className="w-3.5 h-3.5 mr-1" />
                          Ngắt
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!kickTarget}
        onClose={() => setKickTarget(null)}
        onConfirm={() =>
          kickTarget && kickMutation.mutate(kickTarget.session_id)
        }
        loading={kickMutation.isPending}
        title="Ngắt phiên SMPP này?"
        description={
          kickTarget
            ? `Phiên của system_id "${kickTarget.system_id}" (${kickTarget.remote_ip}) sẽ bị unbind. Partner có thể bind lại sau đó.`
            : ""
        }
        confirmLabel="Ngắt phiên"
        variant="destructive"
      />
    </div>
  );
}
