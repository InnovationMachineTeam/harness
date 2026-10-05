"use client";

import type { ReactNode } from "react";
import { Chip, Footnote } from "@/uikit";

/** Событие прогона (run-level API). */
export type RunSectionEvent = { id: number; at: string; type: string; stepId: string | null; payload: Record<string, unknown> };
/** Попытка прогона (run-level API, строка attempts). */
export type RunSectionAttempt = { id: string; step_id: string; status: string; section: string | null; runtime: string | null; model: string | null; started_at: string | null; finished_at: string | null; input_tokens: number; output_tokens: number; cache_tokens: number; cost_value: number | null; cost_currency: string | null };
/** Узел snapshot прогона с секциями контроля. */
export type RunSectionNode = { id: string; title: string; phase: string; description?: string; hidden?: boolean; inputControl?: { prompt?: string; dor?: string[] } | null; execution?: { prompt?: string; confirmPlan?: boolean; producesTasks?: boolean } | null; outputControl?: { tests?: string[]; dod?: string[]; ac?: string[]; manualReview?: boolean } | null };
export type RunSectionView = "input" | "execution" | "output";

export type Criterion = { criterion: string; status: "pass" | "fail"; note?: string };
type ChecklistItem = { criterion: string; status: "pass" | "fail" | "unknown"; note?: string };
type SectionStats = { calls: number; completed: number; tokens: { input: number; output: number; cache: number }; cost: number; currencies: string[]; durationMs: number };

/** Значения attempts.section и событий step.prompt для подшагов каждой секции. */
const SECTION_SUBSECTIONS: Record<RunSectionView, string[]> = {
  input: ["входной контроль"],
  execution: ["план", "исполнение", "доработка поставщика"],
  output: ["критерии приёмки", "выходной контроль"],
};

/** Ключ сопоставления критерия: нижний регистр, без ё и знаков. */
function criterionKey(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function criteriaFromPayload(value: unknown): Criterion[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && String((item as Record<string, unknown>).criterion ?? "").trim()))
      .map((item) => ({ criterion: String(item.criterion).trim(), status: item.status === "fail" ? "fail" : "pass", note: typeof item.note === "string" && item.note ? item.note : undefined }))
    : [];
}

function stringListFromPayload(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

/** Чеклист из snapshot с результатами последнего контроля; критерии сопоставляются по нормализованному тексту. */
export function checklist(items: string[], results: Criterion[]): ChecklistItem[] {
  if (!items.length) return [];
  const exact = new Map(results.map((item) => [criterionKey(item.criterion), item]));
  return items.map((criterion) => {
    const key = criterionKey(criterion);
    const match = exact.get(key) ?? results.find((item) => {
      const itemKey = criterionKey(item.criterion);
      return itemKey.includes(key) || key.includes(itemKey);
    });
    return match ? { criterion, status: match.status, note: match.note } : { criterion, status: "unknown" as const };
  });
}

/**
 * Результаты последнего контроля секции с учётом возврата: возврат после проверки
 * сбрасывает отметки "пройден" - проваленные критерии остаются проваленными,
 * остальные считаются не проверенными.
 */
function latestResults(stepEvents: RunSectionEvent[], checkedType: string, returnedType: string): { results: Criterion[]; invalidated: boolean } {
  const lastCheck = stepEvents.filter((event) => event.type === checkedType).at(-1);
  const lastReturn = stepEvents.filter((event) => event.type === returnedType).at(-1);
  if (lastCheck && lastReturn && lastReturn.id > lastCheck.id) {
    return { results: criteriaFromPayload(lastReturn.payload.failedCriteria), invalidated: true };
  }
  return { results: lastCheck ? criteriaFromPayload(lastCheck.payload.criteria) : [], invalidated: false };
}

function statsFor(attempts: RunSectionAttempt[], stepId: string, subsections: string[]): SectionStats {
  const rows = attempts.filter((attempt) => attempt.step_id === stepId && subsections.includes(attempt.section ?? ""));
  const durationMs = rows.reduce((sum, attempt) => sum + (attempt.started_at && attempt.finished_at ? Math.max(0, Date.parse(attempt.finished_at) - Date.parse(attempt.started_at)) : 0), 0);
  return {
    calls: rows.length,
    completed: rows.filter((attempt) => attempt.status === "completed").length,
    tokens: rows.reduce((acc, attempt) => ({ input: acc.input + (attempt.input_tokens ?? 0), output: acc.output + (attempt.output_tokens ?? 0), cache: acc.cache + (attempt.cache_tokens ?? 0) }), { input: 0, output: 0, cache: 0 }),
    cost: rows.reduce((sum, attempt) => sum + (attempt.cost_value ?? 0), 0),
    currencies: [...new Set(rows.map((attempt) => attempt.cost_currency).filter((value): value is string => Boolean(value)))],
    durationMs,
  };
}

function formatDuration(ms: number): string {
  if (!ms) return "-";
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes ? `${minutes} мин ${seconds} с` : `${seconds} с`;
}

/** Прогресс чеклистов шага для карточки в списке шагов. */
export function StepProgressChips({ node, events }: { node: RunSectionNode; events: RunSectionEvent[] }) {
  const stepEvents = events.filter((event) => event.stepId === node.id);
  const chips: ReactNode[] = [];
  if (node.inputControl?.dor?.length) {
    const { results, invalidated } = latestResults(stepEvents, "input.checked", "input.returned");
    const items = checklist(node.inputControl.dor, results);
    const passed = items.filter((item) => item.status === "pass").length;
    chips.push(<Chip key="dor" tone={invalidated ? "amber" : passed === items.length && items.length ? "emerald" : "dim"}>{invalidated ? "DoR возврат" : `DoR ${passed}/${items.length}`}</Chip>);
  }
  if (node.outputControl?.dod?.length || node.outputControl?.ac?.length) {
    const { results, invalidated } = latestResults(stepEvents, "acceptance.review", "acceptance.returned");
    const items = checklist([...(node.outputControl.dod ?? []), ...(node.outputControl.ac ?? [])], results);
    const passed = items.filter((item) => item.status === "pass").length;
    chips.push(<Chip key="dod" tone={invalidated ? "amber" : passed === items.length && items.length ? "emerald" : "dim"}>{invalidated ? "DoD+AC возврат" : `DoD+AC ${passed}/${items.length}`}</Chip>);
  }
  const returns = stepEvents.filter((event) => event.type === "input.returned" || event.type === "acceptance.returned").length;
  if (returns) chips.push(<Chip key="returns" tone="amber">возвраты: {returns}</Chip>);
  return chips.length ? <div className="flex flex-wrap gap-1">{chips}</div> : null;
}

/** Содержимое одной секции выбранного шага: чеклисты, возвраты, промты подшагов и статистика. */
export function RunStepSection({ view, node, events, attempts }: {
  view: RunSectionView;
  node: RunSectionNode;
  events: RunSectionEvent[];
  attempts: RunSectionAttempt[];
}) {
  const stepEvents = events.filter((event) => event.stepId === node.id);
  return <div className="space-y-2">
    <StepSectionCard view={view} node={node} stepEvents={stepEvents} attempts={attempts} />
    <Footnote>Статусы критериев берутся из последнего вердикта контроля; возвраты помечены по критериям, вызвавшим возврат, и входят в lessons learned.</Footnote>
  </div>;
}

function StepSectionCard({ view, node, stepEvents, attempts }: { view: RunSectionView; node: RunSectionNode; stepEvents: RunSectionEvent[]; attempts: RunSectionAttempt[] }) {
  if (view === "input") return <InputCard node={node} stepEvents={stepEvents} attempts={attempts} />;
  if (view === "output") return <OutputCard node={node} stepEvents={stepEvents} attempts={attempts} />;
  return <ExecutionCard node={node} stepEvents={stepEvents} attempts={attempts} />;
}

function StepCard({ node, right, children }: { node: RunSectionNode; right?: ReactNode; children: ReactNode }) {
  return <section className="rounded-xl border border-line bg-surface p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">{node.title}</span>
      <Chip tone="dim" mono>{node.id}</Chip>
      {right}
    </div>
    <div className="mt-2 space-y-2">{children}</div>
  </section>;
}

export function Checklist({ title, items }: { title: ReactNode; items: ChecklistItem[] }) {
  if (!items.length) return null;
  const passed = items.filter((item) => item.status === "pass").length;
  return <div>
    <div className="flex items-baseline gap-2 text-xs font-semibold"><span>{title}</span><span className="font-mono text-fg-muted">{passed}/{items.length}</span></div>
    <ul className="mt-1 space-y-1">
      {items.map((item) => <li key={item.criterion} className="flex items-start gap-2 text-xs">
        <Chip tone={item.status === "pass" ? "emerald" : item.status === "fail" ? "red" : "dim"}>{item.status === "pass" ? "пройден" : item.status === "fail" ? "провален" : "не проверен"}</Chip>
        <span className="min-w-0 flex-1 text-fg-muted">{item.criterion}{item.note ? <span className="text-fg-faint"> - {item.note}</span> : null}</span>
      </li>)}
    </ul>
  </div>;
}

function Returns({ title, events }: { title: string; events: RunSectionEvent[] }) {
  if (!events.length) return null;
  return <div>
    <div className="text-xs font-semibold text-warning">{title}: {events.length}</div>
    <ul className="mt-1 space-y-1">
      {events.map((event) => {
        const failed = criteriaFromPayload(event.payload.failedCriteria);
        const attempt = Number(event.payload.attempt ?? 0);
        return <li key={event.id} className="text-xs text-fg-muted">
          {attempt ? <span className="font-mono text-fg-faint">#{attempt} </span> : null}
          {failed.length ? failed.map((item) => item.criterion + (item.note ? " (" + item.note + ")" : "")).join("; ") : String(event.payload.kind ?? "возврат без деталей")}
        </li>;
      })}
    </ul>
  </div>;
}

function Prompts({ events }: { events: RunSectionEvent[] }) {
  if (!events.length) return null;
  return <details>
    <summary className="cursor-pointer text-xs text-fg-muted">Промты подшагов ({events.length})</summary>
    <div className="mt-1 space-y-2">
      {events.map((event) => {
        const prompt = event.payload.prompt;
        const label = [String(event.payload.section ?? "секция"), String(event.payload.runtime ?? "")].filter(Boolean).join(" · ");
        return <div key={event.id} className="rounded border border-line bg-page p-2 text-xs">
          <div className="flex justify-between"><span className="text-fg-muted">{label}</span><time className="text-fg-faint">{new Date(event.at).toLocaleTimeString()}</time></div>
          {typeof prompt === "string"
            ? <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[10px] text-fg-faint">{prompt}</pre>
            : <span className="text-fg-faint">Промт скрыт режимом приватности: доступны размер и контрольная сумма.</span>}
        </div>;
      })}
    </div>
  </details>;
}

function StatsRow({ stats }: { stats: SectionStats }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-fg-muted">
    <span>вызовов: {stats.calls} (успешных: {stats.completed})</span>
    <span>вход {stats.tokens.input.toLocaleString("ru-RU")} · выход {stats.tokens.output.toLocaleString("ru-RU")} · кеш {stats.tokens.cache.toLocaleString("ru-RU")}</span>
    {stats.cost ? <span>{stats.cost.toFixed(4)} {stats.currencies.join(", ") || "USD"}</span> : null}
    <span>время: {formatDuration(stats.durationMs)}</span>
  </div>;
}

/** Пояснение задания секции из workflow: текст берётся из snapshot прогона и виден при любой приватности. */
function Assignment({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return <details>
    <summary className="cursor-pointer text-xs text-fg-muted">Задание секции (из workflow)</summary>
    <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[10px] text-fg-muted">{text}</pre>
  </details>;
}

function InputCard({ node, stepEvents, attempts }: { node: RunSectionNode; stepEvents: RunSectionEvent[]; attempts: RunSectionAttempt[] }) {
  const returns = stepEvents.filter((event) => event.type === "input.returned");
  const { results, invalidated } = latestResults(stepEvents, "input.checked", "input.returned");
  const verdict = String(stepEvents.filter((event) => event.type === "input.checked").at(-1)?.payload.verdict ?? "");
  return <StepCard node={node} right={invalidated
    ? <Chip tone="amber">возврат входа</Chip>
    : verdict
      ? <Chip tone={verdict === "pass" ? "emerald" : "red"}>{verdict === "pass" ? "DoR пройден" : "DoR провален"}</Chip>
      : <Chip tone="dim">вход не проверен</Chip>}>
    <div className="text-[11px] text-fg-muted">Входной контроль: роли проверяют вход по DoR до взятия шага в работу; провал возвращает вход поставщику или оператору на доработку.</div>
    <Assignment text={node.inputControl?.prompt} />
    <Checklist title="DoR" items={checklist(node.inputControl?.dor ?? [], results)} />
    <Returns title="Возвраты на доработку" events={returns} />
    <StatsRow stats={statsFor(attempts, node.id, SECTION_SUBSECTIONS.input)} />
    <Prompts events={stepEvents.filter((event) => event.type === "step.prompt" && SECTION_SUBSECTIONS.input.includes(String(event.payload.section ?? "")))} />
  </StepCard>;
}

function OutputCard({ node, stepEvents, attempts }: { node: RunSectionNode; stepEvents: RunSectionEvent[]; attempts: RunSectionAttempt[] }) {
  const reviews = stepEvents.filter((event) => event.type === "acceptance.review");
  const returns = stepEvents.filter((event) => event.type === "acceptance.returned");
  const acEvent = stepEvents.filter((event) => event.type === "acceptance.criteria").at(-1);
  const staticAc = node.outputControl?.ac ?? [];
  const acItems = staticAc.length ? staticAc : stringListFromPayload(acEvent?.payload.ac);
  const acGenerated = !staticAc.length && acItems.length > 0;
  const { results, invalidated } = latestResults(stepEvents, "acceptance.review", "acceptance.returned");
  const verdict = String(reviews.at(-1)?.payload.verdict ?? "");
  const approvedManually = stepEvents.some((event) => event.type === "acceptance.approved");
  return <StepCard node={node} right={invalidated
    ? <Chip tone="amber">возврат на доработку</Chip>
    : verdict
      ? <Chip tone={verdict === "pass" ? "emerald" : "red"}>{verdict === "pass" ? "приёмка пройдена" : "приёмка не пройдена"}</Chip>
      : <Chip tone="dim">выход не проверен</Chip>}>
    <div className="text-[11px] text-fg-muted">Выходной контроль: чек-лист тестов и ревью по DoD и AC; провал возвращает работу на доработку{node.outputControl?.manualReview ? ", успешный результат подтверждает оператор (manualReview)" : ""}.</div>
    {node.outputControl?.tests?.length ? <div className="text-xs"><span className="font-semibold">Требуемые тесты: </span><span className="text-fg-muted">{node.outputControl.tests.join("; ")}</span></div> : null}
    {node.outputControl?.manualReview ? <div className="text-xs text-fg-muted">Ручная приёмка: {approvedManually ? <Chip tone="emerald">принято оператором</Chip> : <Chip tone="amber">требуется решение оператора</Chip>}</div> : null}
    <Checklist title="DoD" items={checklist(node.outputControl?.dod ?? [], results)} />
    <Checklist title={<>AC {acGenerated ? <Chip tone="sky">сгенерированы движком</Chip> : staticAc.length ? <Chip tone="dim">из workflow</Chip> : null}</>} items={checklist(acItems, results)} />
    <div className="text-[11px] text-fg-faint">Проверок выходного контроля: {reviews.length}.</div>
    <Returns title="Возвраты на доработку" events={returns} />
    <StatsRow stats={statsFor(attempts, node.id, SECTION_SUBSECTIONS.output)} />
    <Prompts events={stepEvents.filter((event) => event.type === "step.prompt" && SECTION_SUBSECTIONS.output.includes(String(event.payload.section ?? "")))} />
  </StepCard>;
}

function ExecutionCard({ node, stepEvents, attempts }: { node: RunSectionNode; stepEvents: RunSectionEvent[]; attempts: RunSectionAttempt[] }) {
  const plans = stepEvents.filter((event) => event.type === "plan.created").length;
  const planRejected = stepEvents.filter((event) => event.type === "plan.rejected").length;
  const planConfirmed = stepEvents.some((event) => event.type === "plan.confirmed");
  const executed = stepEvents.filter((event) => event.type === "step.executed").length;
  const tasksCreated = stepEvents.filter((event) => event.type === "plan.tasks-created").at(-1);
  const toolCalls = stepEvents.filter((event) => event.type === "step.tool-call").length;
  const failures = stepEvents.filter((event) => event.type === "step.runtime-failed" || event.type === "step.attempt-exhausted").length;
  const agentplane = tasksCreated?.payload.agentplane as { created?: number; updated?: number; unavailable?: number; error?: number; ids?: string[] } | undefined;
  return <StepCard node={node} right={<Chip tone={executed ? "emerald" : "dim"}>циклов исполнения: {executed}</Chip>}>
    <div className="text-[11px] text-fg-muted">Исполнение: план по DoD и AC, затем работа ролей шага{node.execution?.confirmPlan ? "; план подтверждает оператор (confirmPlan)" : ""}{node.execution?.producesTasks ? "; задачи из финального списка идут в backlog и AgentsPlane (producesTasks)" : ""}.</div>
    <Assignment text={node.execution?.prompt} />
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      <span>планов: {plans}{planConfirmed ? ", подтверждён" : ""}{planRejected ? `, отклонений: ${planRejected}` : ""}</span>
      {tasksCreated ? <span>задач в backlog: {Number(tasksCreated.payload.count ?? 0)}</span> : null}
      <span>вызовов инструментов: {toolCalls}</span>
      {failures ? <span className="text-danger">сбоев runtime: {failures}</span> : null}
    </div>
    {agentplane && (agentplane.created || agentplane.updated || agentplane.unavailable || agentplane.error) ? <div className="text-[11px] text-fg-muted">
      AgentsPlane: {agentplane.created ? `создано ${agentplane.created}` : ""}{agentplane.updated ? `${agentplane.created ? ", " : ""}обновлено ${agentplane.updated}` : ""}{agentplane.unavailable ? `${agentplane.created || agentplane.updated ? ", " : ""}CLI недоступен (${agentplane.unavailable})` : ""}{agentplane.error ? `${agentplane.created || agentplane.updated || agentplane.unavailable ? ", " : ""}ошибок ${agentplane.error}` : ""}
      {agentplane.ids?.length ? <span className="font-mono text-fg-faint"> · {agentplane.ids.join(", ")}</span> : null}
    </div> : null}
    <StatsRow stats={statsFor(attempts, node.id, SECTION_SUBSECTIONS.execution)} />
    <Prompts events={stepEvents.filter((event) => event.type === "step.prompt" && SECTION_SUBSECTIONS.execution.includes(String(event.payload.section ?? "")))} />
  </StepCard>;
}
