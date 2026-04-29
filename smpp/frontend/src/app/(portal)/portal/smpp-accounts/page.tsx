import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { SmppAccountsClient } from "./SmppAccountsClient";

export const metadata: Metadata = { title: "SMPP Accounts — VSO Gateway Portal" };

export default function SmppAccountsPage() {
  return (
    <div>
      <PageHeader
        title="SMPP Accounts"
        description="Thông tin kết nối SMPP — liên hệ admin để thay đổi cấu hình"
      />
      <SmppAccountsClient />
    </div>
  );
}
