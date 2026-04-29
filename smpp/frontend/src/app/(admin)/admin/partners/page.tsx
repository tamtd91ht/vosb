import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { PartnersClient } from "./PartnersClient";

export const metadata: Metadata = { title: "Đối tác — VSO Gateway" };

export default function PartnersPage() {
  return (
    <div>
      <PageHeader
        title="Đối tác"
        description="Quản lý partner và cấu hình webhook DLR"
      />
      <PartnersClient />
    </div>
  );
}
