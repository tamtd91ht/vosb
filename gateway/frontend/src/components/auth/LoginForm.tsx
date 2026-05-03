"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Eye, EyeOff, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const loginSchema = z.object({
  username: z.string().min(1, "Vui lòng nhập tên đăng nhập"),
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl");
  const [error, setError] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormValues) => {
    setError("");
    const result = await signIn("credentials", {
      username: data.username,
      password: data.password,
      redirect: false,
    });
    if (result?.error) {
      setError("Tên đăng nhập hoặc mật khẩu không đúng");
      return;
    }
    // Resolve role from fresh session and redirect accordingly.
    const session = await getSession();
    const role = (session?.user as { role?: string } | undefined)?.role;
    let dest = callbackUrl;
    if (!dest || dest === "/login") {
      dest = role === "PARTNER" ? "/portal/overview" : "/admin/dashboard";
    }
    router.push(dest);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-slate-300 text-xs font-semibold uppercase tracking-wider">
          Tên đăng nhập
        </Label>
        <Input
          {...register("username")}
          placeholder="admin"
          className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus-visible:border-indigo-400 focus-visible:ring-indigo-400/30 h-11"
          autoComplete="username"
        />
        {errors.username && (
          <p className="text-red-400 text-xs flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {errors.username.message}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-slate-300 text-xs font-semibold uppercase tracking-wider">
          Mật khẩu
        </Label>
        <div className="relative">
          <Input
            {...register("password")}
            type={showPwd ? "text" : "password"}
            placeholder="••••••••"
            className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus-visible:border-indigo-400 focus-visible:ring-indigo-400/30 pr-10 h-11"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPwd(!showPwd)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors"
            tabIndex={-1}
          >
            {showPwd ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
        {errors.password && (
          <p className="text-red-400 text-xs flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {errors.password.message}
          </p>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <Button
        type="submit"
        disabled={isSubmitting}
        className="group/btn w-full bg-brand-gradient hover:opacity-90 text-white font-semibold h-11 rounded-xl transition-all shadow-brand-glow hover:shadow-lg hover:shadow-indigo-500/40 active:translate-y-0.5"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Đang đăng nhập…
          </>
        ) : (
          <>
            Đăng nhập
            <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover/btn:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
