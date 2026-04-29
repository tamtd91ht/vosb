import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { OverviewClient } from "./OverviewClient";

export const metadata: Metadata = { title: "Tổng quan — VSO Gateway Portal" };

export default function OverviewPage() {
  return (
    <div>
      <PageHeader title="Tổng quan" description="Sản lượng và thống kê tài khoản của bạn" />
      <OverviewClient />
    </div>
  );
}
