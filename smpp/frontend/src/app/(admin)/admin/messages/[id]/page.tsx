import { Metadata } from "next";
import { apiServer } from "@/lib/api";
import { Message } from "@/lib/types";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Chi tiết tin nhắn — TKC Gateway" };

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-3 border-b border-gray-50 last:border-0">
      <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-500 uppercase tracking-wide pt-0.5">
        {label}
      </dt>
      <dd className="flex-1 text-sm text-gray-900">{value ?? "—"}</dd>
    </div>
  );
}

export default async function MessageDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let message: Message | null = null;
  let error = "";

  try {
    message = await apiServer(`/api/admin/messages/${params.id}`);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "Không thể tải tin nhắn";
  }

  if (error || !message) {
    return (
      <div className="text-center py-16 text-gray-500">
        {error || "Không tìm thấy tin nhắn"}
      </div>
    );
  }

  const timelineSteps = [
    { state: "RECEIVED", label: "Nhận từ partner" },
    { state: "ROUTED", label: "Định tuyến" },
    { state: "SUBMITTED", label: "Gửi tới telco/API" },
    { state: "DELIVERED", label: "Thành công" },
  ];
  const failedStep = { state: "FAILED", label: "Thất bại" };
  const states = ["RECEIVED", "ROUTED", "SUBMITTED", "DELIVERED", "FAILED"] as const;
  const currentIdx = states.indexOf(message.state as typeof states[number]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/messages">
          <Button variant="ghost" size="icon" className="w-8 h-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">
              Chi tiết tin nhắn
            </h1>
            <StatusBadge status={message.state} />
          </div>
          <code className="text-xs text-gray-500 font-mono">{message.id}</code>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main info */}
        <Card className="border-0 shadow-sm bg-white lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Thông tin tin nhắn</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <InfoRow label="Message ID" value={<code className="font-mono text-xs text-indigo-700">{message.id}</code>} />
              <InfoRow label="Partner ID" value={message.partner_id} />
              <InfoRow label="Nguồn" value={message.source_addr} />
              <InfoRow label="Đích" value={message.dest_addr} />
              <InfoRow
                label="Nội dung"
                value={
                  <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">
                    {message.content}
                  </div>
                }
              />
              <InfoRow
                label="Encoding"
                value={
                  <Badge variant="outline" className="text-xs">
                    {message.encoding}
                  </Badge>
                }
              />
              <InfoRow
                label="Inbound via"
                value={
                  <Badge variant="outline" className="text-xs">
                    {message.inbound_via}
                  </Badge>
                }
              />
              <InfoRow
                label="Telco Msg ID"
                value={
                  message.message_id_telco ? (
                    <code className="font-mono text-xs">{message.message_id_telco}</code>
                  ) : (
                    "—"
                  )
                }
              />
              {message.error_code && (
                <InfoRow
                  label="Error Code"
                  value={
                    <code className="font-mono text-xs text-red-600">
                      {message.error_code}
                    </code>
                  }
                />
              )}
              <InfoRow
                label="Tạo lúc"
                value={format(new Date(message.created_at), "dd/MM/yyyy HH:mm:ss", { locale: vi })}
              />
              <InfoRow
                label="Cập nhật"
                value={format(new Date(message.updated_at), "dd/MM/yyyy HH:mm:ss", { locale: vi })}
              />
            </dl>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card className="border-0 shadow-sm bg-white">
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {timelineSteps.map((step, idx) => {
                const isDone = currentIdx >= idx && message!.state !== "FAILED";
                const isCurrent = message!.state === step.state;
                return (
                  <div key={step.state} className="flex items-center gap-3 py-2">
                    <div
                      className={`w-3 h-3 rounded-full flex-shrink-0 ${
                        isDone || isCurrent
                          ? "bg-emerald-500"
                          : "bg-gray-200"
                      }`}
                    />
                    <span
                      className={`text-sm ${
                        isDone || isCurrent
                          ? "text-gray-900 font-medium"
                          : "text-gray-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
              {message.state === "FAILED" && (
                <div className="flex items-center gap-3 py-2">
                  <div className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="text-sm text-red-600 font-medium">
                    {failedStep.label}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
