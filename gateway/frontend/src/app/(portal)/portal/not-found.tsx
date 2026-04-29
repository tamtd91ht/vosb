import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PortalNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <p className="text-7xl font-bold text-slate-100">404</p>
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Trang không tồn tại</h2>
        <p className="text-sm text-slate-500 mt-1">Địa chỉ bạn truy cập không hợp lệ hoặc đã bị xoá.</p>
      </div>
      <Link href="/portal/overview">
        <Button variant="outline">Về trang tổng quan</Button>
      </Link>
    </div>
  );
}
