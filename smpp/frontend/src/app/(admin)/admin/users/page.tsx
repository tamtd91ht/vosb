import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { UsersClient } from "./UsersClient";

export const metadata: Metadata = { title: "Người dùng — TKC Gateway" };

export default function UsersPage() {
  return (
    <div>
      <PageHeader
        title="Người dùng"
        description="Quản lý tài khoản quản trị hệ thống"
      />
      <UsersClient />
    </div>
  );
}
