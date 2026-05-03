import { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
};

export function PageHeader({ title, description, action, eyebrow }: Props) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-gradient mb-1.5">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 leading-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
