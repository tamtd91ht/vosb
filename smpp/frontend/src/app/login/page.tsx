import { LoginForm } from "@/components/auth/LoginForm";
import { Zap } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900">
      <div className="w-full max-w-md px-6">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-white text-xl font-bold tracking-tight">
              TKC Gateway
            </h1>
            <p className="text-indigo-300 text-xs">SMS & Voice OTP Platform</p>
          </div>
        </div>
        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-white text-2xl font-semibold mb-1">
            Đăng nhập
          </h2>
          <p className="text-slate-400 text-sm mb-6">
            Quản trị hệ thống gateway
          </p>
          <LoginForm />
        </div>
        <p className="text-center text-slate-600 text-xs mt-6">
          © 2026 VienthongTKC. All rights reserved.
        </p>
      </div>
    </div>
  );
}
