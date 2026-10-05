import Link from "next/link";
import { Check, Hourglass, Star, TriangleAlert, X } from "lucide-react";
import type { RuntimeSnapshotDTO, VendorCard } from "@/core/types";
import { ACTIVE_WINDOW_MS } from "@/core/activity";
import { runtimePluginOrDefault } from "@/plugins/runtimes/registry";
import { relativeTime, scopeLabel } from "@/lib/format";
import { useConsoleStore } from "@/store/console";
import { Chip, SectionLabel } from "@/uikit";
import { CapabilityChips } from "./CapabilityChips";
import { ModelTable } from "./ModelTable";
import { StatusBadge } from "./StatusBadge";

/**
 * от него незначительно (в пределах активного окна), предпочтительнее репо-масштаб -
 * он точнее отвечает на вопрос "работает ли рантайм в этом репозитории".
 */
function displaySignal(snapshot: RuntimeSnapshotDTO) {
  const latest = snapshot.signals[0];
  if (!latest) return null;
  const latestRepo = snapshot.signals.find((s) => s.scope === "repo");
  if (latestRepo && Date.parse(latest.at) - Date.parse(latestRepo.at) <= ACTIVE_WINDOW_MS) {
    return latestRepo;
  }
  return latest;
}

function PermissionsLine({ p }: { p: VendorCard["permissions"] }) {
  const mark = (v: boolean | undefined) =>
    v === undefined ? <span className="text-fg-faint">?</span> : v ? (
      <span className="text-accent">
        <Check size={11} aria-hidden className="inline" />
      </span>
    ) : (
      <span className="text-fg-faint">
        <X size={11} aria-hidden className="inline" />
      </span>
    );
  return (
    <p className="font-mono text-[11px] text-fg-muted">
      fs {mark(p.fsRead)}/{mark(p.fsWrite)} · git commit {mark(p.gitCommit)} push {mark(p.gitPush)} force{" "}
      {mark(p.gitForcePush)} · shell: {p.shell ?? "?"}
    </p>
  );
}

function IssuesBadge({ snapshot }: { snapshot: RuntimeSnapshotDTO }) {
  const errors = snapshot.issues.filter((i) => i.severity === "error").length;
  const warns = snapshot.issues.filter((i) => i.severity === "warn").length;
  if (errors === 0 && warns === 0) return null;
  return (
    <Chip
      tone={errors > 0 ? "red" : "amber"}
      title={snapshot.issues.map((i) => `[${i.severity}] ${i.title}`).join("\n")}
    >
      <TriangleAlert size={11} aria-hidden /> {errors > 0 ? `${errors} ошиб.` : ""}
      {errors > 0 && warns > 0 ? " · " : ""}
      {warns > 0 ? `${warns} предупр.` : ""}
    </Chip>
  );
}

export function RuntimeCard({
  snapshot,
  nowMs,
  isDefault = false,
}: {
  snapshot: RuntimeSnapshotDTO;
  nowMs: number;
  isDefault?: boolean;
}) {
  const plugin = runtimePluginOrDefault(snapshot.id);
  const monogram = { letter: plugin.monogram, className: plugin.monogramClass };
  const latest = displaySignal(snapshot);
  const isUnknown = snapshot.status === "unknown";
  const disabled = snapshot.status === "disabled";
  const starred = useConsoleStore((s) => s.defaultRuntime) === snapshot.id || isDefault;
  const setDefaultRuntime = useConsoleStore((s) => s.setDefaultRuntime);

  const toggleDefault = (e: React.MouseEvent) => {
    // карточка - ссылка в space; звезда не должна вести навигацию
    e.preventDefault();
    e.stopPropagation();
    void setDefaultRuntime(starred ? null : snapshot.id);
  };

  return (
    <Link href={`/runtime/${snapshot.id}`} className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-line-strong">
      <article
        className={`flex h-full flex-col gap-3 rounded-xl border bg-surface/60 p-4 transition-colors group-hover:border-line-strong ${
          snapshot.status === "active-now" ? "border-accent/30" : "border-line"
        } ${isUnknown || disabled ? "border-dashed" : ""}`}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-semibold ${monogram.className} ${
                disabled ? "opacity-50" : ""
              }`}
            >
              {monogram.letter}
            </span>
            <div className="min-w-0">
              <h2 className="flex items-center gap-1 truncate text-sm font-semibold text-fg group-hover:text-white">
                <span className="truncate">{snapshot.displayName}</span>
                <button
                  type="button"
                  onClick={toggleDefault}
                  title={starred ? "Снять \"рантайм по умолчанию\"" : "Сделать рантаймом по умолчанию (для запуска промтов)"}
                  className={`shrink-0 text-base leading-none transition-colors ${
                    starred ? "text-warning" : "text-fg-faint hover:text-warning"
                  }`}
                >
                  <Star size={14} aria-hidden fill={starred ? "currentColor" : "none"} />
                </button>
              </h2>
              <p
                className="truncate font-mono text-[11px] text-fg-faint"
                title={snapshot.vendor?.vendorAdapter ?? ""}
              >
                {snapshot.vendor?.vendorAdapter ?? "адаптер не указан"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5">
              <StatusBadge status={snapshot.status} />
            </div>
            {snapshot.awaiting ? (
            <Chip tone="sky" className="animate-pulse" title={snapshot.awaiting.question ?? "Рантайм ждёт ответа пользователя"}>
              <Hourglass size={11} aria-hidden /> ждёт ввода
            </Chip>
          ) : latest && !disabled ? (
              <span className="text-[10px] text-fg-faint" title={new Date(latest.at).toLocaleString("ru-RU")}>
                ≈ {relativeTime(latest.at, nowMs)}
              </span>
            ) : null}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Chip>hooks: {snapshot.vendor?.hooksSupport ?? "?"}</Chip>
          <IssuesBadge snapshot={snapshot} />
          {snapshot.adapterKind === "generic" ? (
            <Chip
              tone="dashed"
              title="Рантайм обнаружен в .agents/runtime, но актуальные сигналы для него не подключены"
            >
              без адаптера сигналов
            </Chip>
          ) : null}
        </div>

        <section className="rounded-lg bg-page/60 px-3 py-2">
          {disabled ? (
            <p className="text-xs text-fg-faint">Рантайм не установлен на этой машине</p>
          ) : snapshot.awaiting ? (
            <>
              <p className="text-xs text-info">
                ждёт ввода {relativeTime(snapshot.awaiting.since, nowMs)} · сессия{" "}
                <span className="font-mono text-[10px]">{snapshot.awaiting.sessionId.slice(0, 18)}…</span>
              </p>
              {snapshot.awaiting.question ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-muted">{snapshot.awaiting.question}</p>
              ) : null}
            </>
          ) : latest ? (
            <>
              <p className="text-xs text-fg-muted">
                <span className="text-fg-faint">последняя активность:</span> {relativeTime(latest.at, nowMs)} ·{" "}
                {scopeLabel(latest.scope)}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-fg-faint" title={latest.source}>
                {latest.source}
              </p>
            </>
          ) : isUnknown && snapshot.probeError ? (
            <p className="text-xs text-danger">Ошибка провба: {snapshot.probeError}</p>
          ) : isUnknown ? (
            <p className="text-xs text-fg-faint">Актуальные сигналы не подключены - см. src/runtimes/</p>
          ) : (
            <p className="text-xs text-fg-faint">Следов активности не найдено</p>
          )}
          <div className="mt-1.5">{!disabled ? <ProcessLine snapshot={snapshot} /> : null}</div>
        </section>

        <section>
          <SectionLabel as="h3" className="mb-1">Модели</SectionLabel>
          <ModelTable models={snapshot.vendor?.models ?? []} />
        </section>

        {snapshot.vendor && Object.keys(snapshot.vendor.capabilities).length > 0 ? (
          <section>
            <SectionLabel as="h3" className="mb-1">Capabilities</SectionLabel>
            <CapabilityChips capabilities={snapshot.vendor.capabilities} />
          </section>
        ) : null}

        {snapshot.vendor ? (
          <section className="mt-auto border-t border-line/60 pt-2">
            <PermissionsLine p={snapshot.vendor.permissions} />
          </section>
        ) : null}
      </article>
    </Link>
  );
}

function ProcessLine({ snapshot }: { snapshot: RuntimeSnapshotDTO }) {
  if (snapshot.processes.length === 0) {
    return <p className="text-xs text-fg-faint">Процессов нет</p>;
  }
  const shown = snapshot.processes.slice(0, 3).map((p) => p.pid);
  const rest = snapshot.processes.length - shown.length;
  return (
    <p className="text-xs text-fg-muted" title={snapshot.processes.map((p) => p.command).join("\n")}>
      <span className="text-accent">●</span> {snapshot.processes.length} proc · PID{" "}
      <span className="font-mono">{shown.join(" · ")}</span>
      {rest > 0 ? <span className="text-fg-faint"> +{rest}</span> : null}
    </p>
  );
}
