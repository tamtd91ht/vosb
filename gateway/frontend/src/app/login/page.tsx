import { LoginForm } from "@/components/auth/LoginForm";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { LoginSplash } from "@/components/auth/LoginSplash";

export default function LoginPage() {
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-6 bg-slate-950">
      <AuroraBackground intensity="vivid" />
      <div className="absolute inset-0 bg-grid-dark opacity-30" />

      {/* Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/40 pointer-events-none" />

      <div className="relative w-full max-w-5xl grid lg:grid-cols-2 gap-12 items-center">
        <LoginSplash />

        <div className="w-full max-w-md mx-auto">
          {/* Card */}
          <div className="relative rounded-2xl overflow-hidden">
            <div className="absolute inset-0 bg-brand-gradient opacity-50 blur-md" />
            <div className="relative glass-dark rounded-2xl p-8">
              <h2 className="text-white text-2xl font-bold tracking-tight mb-1">
                Đăng nhập
              </h2>
              <p className="text-slate-400 text-sm mb-6">
                Quản trị hệ thống gateway
              </p>
              <LoginForm />
            </div>
          </div>

          <p className="text-center text-slate-500 text-xs mt-6">
            © 2026 VOSB. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
