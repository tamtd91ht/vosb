import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { RoutesClient } from "./RoutesClient";

export const metadata: Metadata = { title: "Route — VOSB Gateway" };

export default function RoutesPage() {
  return (
    <div>
      <PageHeader
        title="Route"
        description="Cấu hình định tuyến tin nhắn theo partner và prefix số điện thoại"
      />
      <RoutesClient />
    </div>
  );
}
