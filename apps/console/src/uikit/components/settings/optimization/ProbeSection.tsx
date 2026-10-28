"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Chip, EmptyState, Loading, Notice, Panel } from "@/uikit";

/**
 * Секция "Контрастивные прогоны" вкладки "Оптимизация": одна задача в N
 * вариантах обвеса в изолированных worktree (propose-probe-compose). Варианты
 * предлагает провайдер по задаче и принятым урокам или вводит оператор;
 * контрастный отчёт строит провайдер, внедрение лучшего варианта запускает
 * агента рантайма на применение замен в основной папке.
 */

interface VariantDraft {
  id: string;
  label: string;
  contextBlock: string;
}

interface RunSummaryDTO {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  runtimeId: string;
  taskPrompt: string;
  variants: Array<{ id: string; label: string; ok: boolean; costUsd: number | null; durationMs: number }>;
  recommendation: { variantId: string | null; rationale: string } | null;
  adoptedVariantId: string | null;
  error: string | null;
}

interface ProbeStateDTO {
  runs: RunSummaryDTO[];
  runtimes: string[];
  maxVariants: number;
}

function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ProbeSection() {
  const [data, setData] = useState<ProbeStateDTO | null>(null);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [runtimeId, setRuntimeId] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [proposing, setProposing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: ReactNode } | null>(null);

  const maxVariants = data?.maxVariants ?? 4;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/optimization/probe", { cache: "no-store" });
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as ProbeStateDTO;
      setData(json);
      setRuntimeId((prev) => (prev && json.runtimes.includes(prev) ? prev : json.runtimes[0] ?? ""));
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateVariant = (index: number, patch: Partial<VariantDraft>) => {
    setVariants((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const propose = async () => {
    setProposing(true);
    setNotice(null);
    try {
      const res = await fetch("/api/optimization/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose", taskPrompt, k: 3 }),
      });
      const json = (await res.json()) as { ok?: boolean; variants?: VariantDraft[]; error?: string };
      if (!res.ok || !json.ok || !json.variants) {
        setNotice({ tone: "error", text: json.error ?? "варианты не предложены" });
        return;
      }
      setVariants(json.variants.slice(0, maxVariants).map((variant, index) => ({ ...variant, id: variant.id || "v" + (index + 1) })));
      setNotice({ tone: "success", text: `предложено вариантов: ${Math.min(json.variants.length, maxVariants)} - отредактируйте при необходимости` });
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - варианты не предложены" });
    } finally {
      setProposing(false);
    }
  };

  const start = async () => {
    setStarting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/optimization/probe/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskPrompt,
          runtimeId,
          variants: variants.map((variant, index) => ({
            id: variant.id || "v" + (index + 1),
            label: variant.label || "Вариант " + (index + 1),
            contextBlock: variant.contextBlock,
          })),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; detail?: string; error?: string };
      if (!res.ok || !json.ok) {
        setNotice({ tone: "error", text: json.error ?? "проба не запущена" });
        return;
      }
      setNotice({
        tone: "success",
        text: (
          <>
            проба запущена ({json.detail}); задача - в разделе{" "}
            <Link href="/monitoring" className="underline decoration-dotted hover:text-fg-muted">
              Мониторинг
            </Link>
          </>
        ),
      });
      await load();
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - проба не запущена" });
    } finally {
      setStarting(false);
    }
  };

  const adopt = async (run: RunSummaryDTO, variantId: string) => {
    setAdopting(run.id + ":" + variantId);
    setNotice(null);
    try {
      const res = await fetch(`/api/optimization/probe/${run.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adopt", variantId }),
      });
      const json = (await res.json()) as { ok?: boolean; detail?: string; error?: string };
      if (!res.ok || !json.ok) {
        setNotice({ tone: "error", text: json.error ?? "внедрение не запущено" });
        return;
      }
      setNotice({
        tone: "success",
        text: <>внедрение варианта запущено ({json.detail}); одобрение структурных правок - в сессии рантайма</>,
      });
      await load();
    } catch {
      setNotice({ tone: "error", text: "сеть недоступна - внедрение не запущено" });
    } finally {
      setAdopting(null);
    }
  };

  const canStart = Boolean(data) && taskPrompt.trim().length > 0 && variants.length > 0 && runtimeId;

  return (
    <Panel
      as="article"
      title="Контрастивные прогоны"
      actions={
        <div className="flex items-center gap-2">
          {proposing ? <Loading>варианты предлагаются…</Loading> : null}
          {starting ? <Loading>запуск…</Loading> : null}
          <Button variant="ghost" onClick={() => void propose()} disabled={proposing || starting || !taskPrompt.trim()}>
            Предложить варианты
          </Button>
          <Button variant="accent" onClick={() => void start()} disabled={proposing || starting || !canStart}>
            Запустить пробу
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Одна задача выполняется в нескольких вариантах обвеса в изолированных worktree; провайдер сравнивает поведение
        вариантов без эталона. Внедрение выбранного варианта запускает агента на применение замен в основной папке.
      </p>

      {notice ? (
        <Notice tone={notice.tone} className="mb-3">
          {notice.text}
        </Notice>
      ) : null}

      {!data ? (
        <Loading>загрузка…</Loading>
      ) : (
        <div className="space-y-3">
          <textarea
            value={taskPrompt}
            onChange={(event) => setTaskPrompt(event.target.value)}
            placeholder="задача для контрастивного сравнения вариантов обвеса"
            rows={3}
            className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:outline-none"
          />

          <div className="flex flex-wrap gap-1.5">
            {data.runtimes.map((runtime) => (
              <button
                key={runtime}
                type="button"
                onClick={() => setRuntimeId(runtime)}
                className={
                  "rounded-md px-2 py-1 text-xs transition-colors " +
                  (runtimeId === runtime ? "bg-accent/20 text-fg" : "bg-surface text-fg-muted hover:text-fg")
                }
              >
                {runtime}
              </button>
            ))}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">Варианты ({variants.length}/{maxVariants})</p>
              <Button size="xs" variant="ghostDim" onClick={() => setVariants((prev) => (prev.length < maxVariants ? [...prev, { id: "v" + (prev.length + 1), label: "", contextBlock: "" }] : prev))}>
                Добавить
              </Button>
            </div>
            {variants.length === 0 ? (
              <p className="py-2 text-[11px] text-fg-faint">вариантов нет - предложите их провайдером или добавьте вручную</p>
            ) : (
              variants.map((variant, index) => (
                <div key={index} className="border-t border-line/40 py-2 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={variant.label}
                      onChange={(event) => updateVariant(index, { label: event.target.value })}
                      placeholder={"Вариант " + (index + 1)}
                      className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus:outline-none"
                    />
                    <Button size="xs" variant="ghostDim" onClick={() => setVariants((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>
                      Удалить
                    </Button>
                  </div>
                  <textarea
                    value={variant.contextBlock}
                    onChange={(event) => updateVariant(index, { contextBlock: event.target.value })}
                    placeholder="дополнительные инструкции обвеса для этого варианта"
                    rows={3}
                    className="mt-1.5 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus:outline-none"
                  />
                </div>
              ))
            )}
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Прогоны</p>
            {data.runs.length === 0 ? (
              <EmptyState size="sm">Проб ещё не было.</EmptyState>
            ) : (
              data.runs.slice(0, 8).map((run) => (
                <div key={run.id} className="border-t border-line/40 py-2 first:border-t-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-fg-faint">{formatStamp(run.startedAt)}</span>
                    <span className="text-sm text-fg">{run.taskPrompt || "(без заголовка)"}</span>
                    <Chip tone={run.status === "completed" ? "dim" : run.status === "running" ? "sky" : "amber"} size="xs">
                      {run.status === "running" ? "выполняется" : run.status === "completed" ? "завершена" : "ошибка"}
                    </Chip>
                    <Chip tone="dim" size="xs">{run.runtimeId}</Chip>
                    {run.adoptedVariantId ? <Chip tone="emerald" size="xs">внедрён: {run.adoptedVariantId}</Chip> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {run.variants.map((variant) => (
                      <span key={variant.id} className="flex items-center gap-1">
                        <Chip tone={variant.ok ? "neutral" : "amber"} size="xs">
                          {variant.label}: {variant.ok ? "исполнено" : "ошибка"}
                          {variant.costUsd != null ? ` · $${variant.costUsd}` : ""}
                          {` · ${Math.round(variant.durationMs / 1000)} с`}
                        </Chip>
                        {run.status === "completed" && !run.adoptedVariantId ? (
                          <Button
                            size="xs"
                            variant="ghostDim"
                            onClick={() => void adopt(run, variant.id)}
                            disabled={adopting === run.id + ":" + variant.id}
                          >
                            Принять
                          </Button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                  {run.recommendation ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                      Рекомендация: {run.recommendation.variantId ?? "нет"} - {run.recommendation.rationale}
                    </p>
                  ) : null}
                  {run.error ? <p className="mt-1 text-[11px] text-warning">{run.error}</p> : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
