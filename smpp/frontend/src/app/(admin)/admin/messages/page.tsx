import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { MessagesClient } from "./MessagesClient";

export const metadata: Metadata = { title: "Tin nhắn — VSO Gateway" };

export default function MessagesPage() {
  return (
    <div>
      <PageHeader
        title="Tin nhắn"
        description="Theo dõi và tìm kiếm toàn bộ tin nhắn đi qua hệ thống"
      />
      <MessagesClient />
    </div>
  );
}
