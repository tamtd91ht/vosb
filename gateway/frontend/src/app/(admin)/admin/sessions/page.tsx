import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Sessions — VOSB Gateway" };

export default function SessionsPage() {
  return (
    <div>
      <PageHeader
        title="SMPP Sessions"
        description="Danh sách phiên kết nối SMPP đang hoạt động"
      />
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-6">
          <Wifi className="w-8 h-8 text-indigo-400" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xl font-semibold text-gray-900">
            SMPP Sessions
          </h2>
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
            Sắp ra mắt
          </Badge>
        </div>
        <p className="text-sm text-gray-500 max-w-md">
          Chức năng này khả dụng từ Phase 3 khi SMPP listener được kích hoạt.
          Hiện tại, các phiên kết nối SMPP đang được ghi log nhưng chưa có giao diện quản lý.
        </p>
      </div>
    </div>
  );
}
