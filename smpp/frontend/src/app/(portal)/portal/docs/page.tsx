import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { DocsClient } from "./DocsClient";

export const metadata: Metadata = { title: "Tài liệu — TKC Gateway Portal" };

export default function DocsPage() {
  return (
    <div>
      <PageHeader
        title="Tài liệu tích hợp"
        description="Hướng dẫn gửi tin nhắn qua API và SMPP"
      />
      <DocsClient />
    </div>
  );
}
