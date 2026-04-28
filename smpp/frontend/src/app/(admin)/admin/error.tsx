"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <div className="w-12 h-12 rounded-full bg-red-900/20 flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-red-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white">Có lỗi xảy ra</h2>
        <p className="text-sm text-slate-400 mt-1">{error.message || "Vui lòng thử lại hoặc liên hệ hỗ trợ."}</p>
      </div>
      <Button variant="outline" onClick={reset} className="border-slate-600 text-slate-300 hover:text-white">Thử lại</Button>
    </div>
  );
}
