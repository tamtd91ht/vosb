import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  ACTIVE: {
    label: "Hoạt động",
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  SUSPENDED: {
    label: "Tạm dừng",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  DISABLED: {
    label: "Vô hiệu",
    className: "bg-gray-100 text-gray-600 border-gray-200",
  },
  REVOKED: {
    label: "Đã thu hồi",
    className: "bg-red-100 text-red-700 border-red-200",
  },
  RECEIVED: {
    label: "Nhận",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  ROUTED: {
    label: "Định tuyến",
    className: "bg-indigo-100 text-indigo-700 border-indigo-200",
  },
  SUBMITTED: {
    label: "Đã gửi",
    className: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
  DELIVERED: {
    label: "Thành công",
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  FAILED: {
    label: "Thất bại",
    className: "bg-red-100 text-red-700 border-red-200",
  },
  ADMIN: {
    label: "Admin",
    className: "bg-violet-100 text-violet-700 border-violet-200",
  },
  PARTNER: {
    label: "Partner",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium border", cfg.className)}
    >
      {cfg.label}
    </Badge>
  );
}
