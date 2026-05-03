"use client";
import { motion } from "motion/react";
import { ShieldCheck, Activity, MessageSquare, Zap } from "lucide-react";

export function LoginSplash() {
  return (
    <div className="hidden lg:block text-white">
      {/* Mobile-shared brand */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur mb-6"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-400" />
        </span>
        <span className="text-[11px] font-semibold tracking-wide text-indigo-200">
          SMS &amp; Voice OTP Gateway
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="text-5xl font-bold tracking-tight leading-[1.05]"
      >
        Hạ tầng tin cậy cho{" "}
        <span className="bg-gradient-animated bg-clip-text text-transparent">
          OTP &amp; SMS
        </span>{" "}
        Việt Nam
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="text-slate-400 mt-5 text-lg max-w-md leading-relaxed"
      >
        Định tuyến thông minh theo nhà mạng, dispatch song song qua nhiều kênh,
        DLR realtime tới đối tác.
      </motion.p>

      <div className="mt-10 grid grid-cols-3 gap-4">
        {[
          { icon: ShieldCheck, label: "HMAC + JWT", value: "Auth" },
          { icon: Activity, label: "Carrier-aware", value: "Routing" },
          { icon: MessageSquare, label: "Multi-channel", value: "Dispatch" },
        ].map((s, idx) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25 + idx * 0.08 }}
            whileHover={{ y: -4 }}
            className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur p-4 hover:border-indigo-500/40 hover:bg-white/[0.05] transition-all cursor-default"
          >
            <div className="w-8 h-8 rounded-lg bg-brand-soft border border-white/10 flex items-center justify-center mb-2">
              <s.icon className="w-4 h-4 text-indigo-300" strokeWidth={2} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {s.label}
            </p>
            <p className="text-sm font-bold text-white mt-0.5">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Logo bottom */}
      <div className="mt-12 flex items-center gap-2 text-slate-500 text-xs">
        <Zap className="w-3.5 h-3.5 text-indigo-400" />
        <span className="font-mono">VOSB Gateway · v0.1.0</span>
      </div>
    </div>
  );
}
