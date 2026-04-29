import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { WebhookClient } from "./WebhookClient";

export const metadata: Metadata = { title: "Webhook DLR — VOSB Gateway Portal" };

export default function WebhookPage() {
  return (
    <div>
      <PageHeader
        title="Webhook DLR"
        description="Cấu hình URL nhận thông báo trạng thái tin nhắn (Delivery Receipt)"
      />
      <WebhookClient />
    </div>
  );
}
