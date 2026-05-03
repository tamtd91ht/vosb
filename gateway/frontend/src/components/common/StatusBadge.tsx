import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<
  string,
  { label: string; className: string; dot: string; pulse?: boolean }
> = {
  ACTIVE: {
    label: "Hoạt động",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200/70",
    dot: "bg-emerald-500",
    pulse: true,
  },
  SUSPENDED: {
    label: "Tạm dừng",
    className: "bg-amber-50 text-amber-700 border-amber-200/70",
    dot: "bg-amber-500",
  },
  DISABLED: {
    label: "Vô hiệu",
    className: "bg-slate-100 text-slate-600 border-slate-200/70",
    dot: "bg-slate-400",
  },
  REVOKED: {
    label: "Đã thu hồi",
    className: "bg-rose-50 text-rose-700 border-rose-200/70",
    dot: "bg-rose-500",
  },
  RECEIVED: {
    label: "Nhận",
    className: "bg-sky-50 text-sky-700 border-sky-200/70",
    dot: "bg-sky-500",
    pulse: true,
  },
  ROUTED: {
    label: "Định tuyến",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200/70",
    dot: "bg-indigo-500",
    pulse: true,
  },
  SUBMITTED: {
    label: "Đã gửi",
    className: "bg-violet-50 text-violet-700 border-violet-200/70",
    dot: "bg-violet-500",
    pulse: true,
  },
  DELIVERED: {
    label: "Thành công",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200/70",
    dot: "bg-emerald-500",
  },
  FAILED: {
    label: "Thất bại",
    className: "bg-rose-50 text-rose-700 border-rose-200/70",
    dot: "bg-rose-500",
  },
  ADMIN: {
    label: "Admin",
    className: "bg-violet-50 text-violet-700 border-violet-200/70",
    dot: "bg-violet-500",
  },
  PARTNER: {
    label: "Partner",
    className: "bg-sky-50 text-sky-700 border-sky-200/70",
    dot: "bg-sky-500",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? {
    label: status,
    className: "bg-slate-100 text-slate-600 border-slate-200/70",
    dot: "bg-slate-400",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-semibold border gap-1.5 pl-1.5 pr-2 h-5.5 inline-flex items-center",
        cfg.className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {cfg.pulse && (
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              cfg.dot
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-1.5 w-1.5",
            cfg.dot
          )}
        />
      </span>
      {cfg.label}
    </Badge>
  );
}
