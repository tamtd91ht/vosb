import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { PortalMessagesClient } from "./PortalMessagesClient";

export const metadata: Metadata = { title: "Tin nhắn — TKC Gateway Portal" };

export default function MessagesPage() {
  return (
    <div>
      <PageHeader title="Tin nhắn" description="Lịch sử tin nhắn đã gửi qua TKC Gateway" />
      <PortalMessagesClient />
    </div>
  );
}
