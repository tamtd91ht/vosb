import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = { title: "Dashboard — VSO Gateway" };

export default async function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Tổng quan sản lượng SMS & Voice OTP"
      />
      <DashboardClient />
    </div>
  );
}
