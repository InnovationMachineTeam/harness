import type { ActivityStatus } from "@/core/types";

const META: Record<ActivityStatus, { label: string; className: string; dot: string; pulse?: boolean }> = {
  "active-now": {
    label: "Активен сейчас",
    className: "border-accent/40 bg-accent/10 text-accent",
    dot: "bg-accent",
    pulse: true,
  },
  "recently-active": {
    label: "Был активен",
    className: "border-warning/40 bg-warning/10 text-warning",
    dot: "bg-warning",
  },
  inactive: {
    label: "Неактивен",
    className: "border-line-strong bg-raised/50 text-fg-muted",
    dot: "bg-line-strong",
  },
  disabled: {
    label: "Не установлен",
    className: "border-dashed border-line-strong bg-surface/60 text-fg-faint",
    dot: "bg-line-strong",
  },
  unknown: {
    label: "Нет данных",
    className: "border-dashed border-line-strong bg-surface/60 text-fg-faint",
    dot: "bg-line-strong",
  },
};

export function StatusBadge({ status, detail }: { status: ActivityStatus; detail?: string }) {
  const meta = META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      <span className="relative flex h-2 w-2">
        {meta.pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${meta.dot} opacity-60`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
      </span>
      {meta.label}
      {detail ? <span className="font-normal opacity-70">· {detail}</span> : null}
    </span>
  );
}
