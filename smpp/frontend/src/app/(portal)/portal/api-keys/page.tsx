import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiKeysClient } from "./ApiKeysClient";

export const metadata: Metadata = { title: "API Keys — VSO Gateway Portal" };

export default function ApiKeysPage() {
  return (
    <div>
      <PageHeader
        title="API Keys"
        description="Quản lý API key để xác thực yêu cầu gửi tin nhắn"
      />
      <ApiKeysClient />
    </div>
  );
}
