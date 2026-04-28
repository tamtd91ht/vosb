"use client";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Message } from "@/lib/types";

const STATE_ORDER = ["RECEIVED", "ROUTED", "SUBMITTED", "DELIVERED", "FAILED"] as const;

const STATE_COLORS: Record<string, string> = {
  RECEIVED: "text-blue-500",
  ROUTED: "text-blue-500",
  SUBMITTED: "text-amber-500",
  DELIVERED: "text-emerald-500",
  FAILED: "text-red-500",
};

export function MessageDetailClient({ id }: { id: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = useSession() as { data: any };
  const token = session?.accessToken as string | undefined;

  const { data: msg, isLoading } = useQuery<Message>({
    queryKey: ["portal", "messages", id],
    queryFn: () => apiClient(token, `/api/portal/messages/${id}`),
    enabled: !!token,
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!msg) return <p className="text-slate-400 text-sm">Không tìm thấy tin nhắn.</p>;

  const reachedIdx = STATE_ORDER.indexOf(msg.state as typeof STATE_ORDER[number]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Timeline */}
      <Card className="border border-slate-100 shadow-sm bg-white lg:col-span-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Trạng thái</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {STATE_ORDER.map((state, idx) => {
              const reached = idx <= reachedIdx;
              const isCurrent = state === msg.state;
              return (
                <div key={state} className="flex items-start gap-3 relative">
                  <div className="flex flex-col items-center">
                    {reached ? (
                      <CheckCircle2 className={cn("w-5 h-5 flex-shrink-0", STATE_COLORS[state])} />
                    ) : (
                      <Circle className="w-5 h-5 flex-shrink-0 text-slate-200" />
                    )}
                    {idx < STATE_ORDER.length - 1 && (
                      <div className={cn("w-0.5 h-8 my-0.5", reached && idx < reachedIdx ? "bg-emerald-200" : "bg-slate-100")} />
                    )}
                  </div>
                  <div className="pb-6">
                    <p className={cn("text-sm font-medium", isCurrent ? STATE_COLORS[state] : reached ? "text-slate-700" : "text-slate-300")}>
                      {state}
                    </p>
                    {isCurrent && msg.updated_at && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {format(new Date(msg.updated_at), "dd/MM/yyyy HH:mm:ss", { locale: vi })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Raw fields */}
      <Card className="border border-slate-100 shadow-sm bg-white lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Chi tiết</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {[
              { label: "Message ID", value: msg.id },
              { label: "Nguồn (Source)", value: msg.source_addr },
              { label: "Đích (Destination)", value: msg.dest_addr },
              { label: "Trạng thái", value: <StatusBadge status={msg.state} /> },
              { label: "Encoding", value: msg.encoding },
              { label: "Kênh", value: msg.channel_id ? `Channel #${msg.channel_id}` : "—" },
              { label: "Telco Message ID", value: msg.message_id_telco ?? "—" },
              { label: "Mã lỗi", value: msg.error_code ?? "—" },
              { label: "Thời gian tạo", value: msg.created_at ? format(new Date(msg.created_at), "dd/MM/yyyy HH:mm:ss", { locale: vi }) : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="flex gap-4">
                <dt className="w-44 flex-shrink-0 text-xs text-slate-400 font-medium pt-0.5">{label}</dt>
                <dd className="text-sm text-slate-800 font-mono break-all">{value}</dd>
              </div>
            ))}
          </dl>
          {msg.content && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-400 font-medium mb-1">Nội dung tin nhắn</p>
              <p className="text-sm text-slate-800 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{msg.content}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
