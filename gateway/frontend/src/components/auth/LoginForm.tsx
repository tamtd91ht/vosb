"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Eye, EyeOff } from "lucide-react";
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
    } else {
      router.push("/admin/dashboard");
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-slate-200 text-sm">Tên đăng nhập</Label>
        <Input
          {...register("username")}
          placeholder="admin"
          className="bg-white/10 border-white/20 text-white placeholder:text-slate-500 focus-visible:border-indigo-500"
          autoComplete="username"
        />
        {errors.username && (
          <p className="text-red-400 text-xs">{errors.username.message}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-slate-200 text-sm">Mật khẩu</Label>
        <div className="relative">
          <Input
            {...register("password")}
            type={showPwd ? "text" : "password"}
            placeholder="••••••••"
            className="bg-white/10 border-white/20 text-white placeholder:text-slate-500 focus-visible:border-indigo-500 pr-10"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPwd(!showPwd)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
          >
            {showPwd ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
        {errors.password && (
          <p className="text-red-400 text-xs">{errors.password.message}</p>
        )}
      </div>
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-red-400 text-sm">
          {error}
        </div>
      )}
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium h-10 rounded-lg transition-colors"
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : null}
        {isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
      </Button>
    </form>
  );
}
