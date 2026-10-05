"use client";

import { CheckCircle2, ChevronDown, Download, FileCog, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Chip, EmptyState, Input, Loading, Notice, Panel, SectionLabel, Segmented, cx } from "@/uikit";

type Status = "verified" | "degraded" | "missing";

interface RuleAudit {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  effect: string;
  status: string;
  failureMode: string;
  cases: number;
  remediation: string;
  threats: string[];
  limitations: string[];
  implementation: string;
  examples: { blocked: string; allowed: string; edge: string };
}

interface IntegrationAudit {
  id: string;
  title: string;
  purpose: string;
  protects: string;
  kind: string;
  source: string;
  expectedFailureMode: string;
  status: Status;
  detail: string;
  notes: string;
}

interface CheckAudit {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  purpose: string;
  protects: string;
  evidence: string;
}

interface DecisionEvent {
  schemaVersion?: number;
  decisionId?: string;
  at?: string;
  runtime?: string;
  integrationId?: string;
  effect?: string;
  ruleId?: string | null;
  reason?: string;
  latencyMs?: number;
  exceptionId?: string | null;
  effect_unknown?: never;
}

interface ExceptionRecord {
  id: string;
  ruleId: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
}

interface JournalAggregates {
  total: number;
  byEffect?: Record<string, number>;
  topRules?: Array<{ name: string; count: number }>;
  topIntegrations?: Array<{ name: string; count: number }>;
  exceptions?: number;
  p95LatencyMs?: number | null;
}

interface Snapshot {
  policyVersion: string;
  policyDigest: string;
  generatedAt: string;
  totals: {
    rules: number;
    enforced: number;
    critical: number;
    integrations: number;
    verifiedIntegrations: number;
    degradedIntegrations: number;
    missingIntegrations: number;
    cases: number;
  };
  rules: RuleAudit[];
  integrations: IntegrationAudit[];
  checks: CheckAudit[];
}

const STATUS_LABELS: Record<Status, string> = { verified: "Подтверждено", degraded: "Требует внимания", missing: "Не подключено" };
const SEVERITY_LABELS: Record<string, string> = { critical: "Критическое", high: "Высокое", medium: "Среднее", low: "Низкое" };
const EFFECT_LABELS: Record<string, string> = { block: "Блокирует", warn: "Предупреждает", sanitize: "Очищает данные", "require-approval": "Требует подтверждение" };
const KIND_LABELS: Record<string, string> = { "runtime-hook": "Хук runtime", code: "Вызов из кода", "git-hook": "Git hook", verification: "Верификация", ci: "CI" };
const CATEGORY_EXPLANATIONS: Record<string, string> = {
  filesystem: "Файлы проекта и рабочие каталоги от необратимого удаления или опасных прав доступа.",
  git: "Историю Git, локальные изменения и удалённый репозиторий.",
  database: "Данные и схему базы от массового или необратимого удаления.",
  secrets: "Пароли, токены, ключи и другие секреты от чтения, записи и попадания в журнал.",
  "supply-chain": "Проект и компьютер от исполнения скачанного кода без предварительной проверки.",
  integrity: "Служебные файлы, которыми управляют Git, Bun, npm и другие инструменты.",
  infrastructure: "Облачную и кластерную инфраструктуру от прямого изменения или удаления.",
  deployment: "Production-среды и развёрнутые ресурсы от обхода release-процесса.",
  approval: "Решения человека от самоодобрения агентом.",
  governance: "Политику, роли и настройки агентной системы от неконтролируемого изменения.",
  cost: "Бюджет от неявного создания платных облачных ресурсов.",
  host: "Компьютер пользователя от необязательного повышения системных прав.",
};

const statusTone = (status: Status) => status === "verified" ? "emerald" : status === "degraded" ? "amber" : "red";
const severityTone = (severity: string) => severity === "critical" ? "red" : severity === "high" ? "amber" : "neutral";

function Detail({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return <div className={cx("rounded-lg border border-line/70 bg-page/40 p-3", wide && "md:col-span-2")}>
    <SectionLabel>{title}</SectionLabel>
    <div className="mt-1.5 text-[11px] leading-relaxed text-fg-muted">{children}</div>
  </div>;
}

export function GuardrailsPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<DecisionEvent[] | null>(null);
  const [eventsTruncated, setEventsTruncated] = useState(false);
  const [aggregates, setAggregates] = useState<JournalAggregates | null>(null);
  const [exceptions, setExceptions] = useState<{ active: ExceptionRecord[]; expired: ExceptionRecord[]; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"rules" | "integrations" | "journal" | "exceptions">("rules");
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [expandedIntegration, setExpandedIntegration] = useState<string | null>(null);
  const [expandedException, setExpandedException] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/guardrails", { cache: "no-store" });
    const json = await response.json() as Snapshot & { error?: string };
    if (!response.ok) { setError(json.error ?? "Снимок аудита не получен."); return; }
    setSnapshot(json);
    const eventsResponse = await fetch("/api/guardrails/events", { cache: "no-store" });
    if (eventsResponse.ok) {
      const eventsJson = await eventsResponse.json() as { events?: DecisionEvent[]; truncated?: boolean; aggregates?: JournalAggregates | null };
      setEvents(eventsJson.events ?? []);
      setEventsTruncated(Boolean(eventsJson.truncated));
      setAggregates(eventsJson.aggregates ?? null);
    }
    const exceptionsResponse = await fetch("/api/guardrails/exceptions", { cache: "no-store" });
    if (exceptionsResponse.ok) {
      const exceptionsJson = await exceptionsResponse.json() as { active?: ExceptionRecord[]; expired?: ExceptionRecord[]; errors?: string[] };
      setExceptions({ active: exceptionsJson.active ?? [], expired: exceptionsJson.expired ?? [], errors: exceptionsJson.errors ?? [] });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: "check" | "test" | "generate") => {
    setBusy(action); setError(null); setOutput(null);
    try {
      const response = await fetch("/api/guardrails", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const json = await response.json() as { ok?: boolean; output?: string; snapshot?: Snapshot; error?: string };
      if (json.snapshot) setSnapshot(json.snapshot);
      setOutput(json.output || (json.ok ? "Команда выполнена." : null));
      if (!response.ok || !json.ok) setError(json.error ?? "Проверка завершилась с ошибкой.");
    } catch { setError("API Guardrails недоступен."); }
    finally { setBusy(null); }
  };

  const download = () => {
    if (!snapshot) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = href; link.download = `guardrails-audit-${snapshot.policyVersion}.json`; link.click(); URL.revokeObjectURL(href);
  };

  const normalized = query.trim().toLowerCase();
  const rules = useMemo(() => snapshot?.rules.filter((rule) => !normalized || `${rule.id} ${rule.title} ${rule.category} ${rule.description}`.toLowerCase().includes(normalized)) ?? [], [snapshot, normalized]);
  const integrations = useMemo(() => snapshot?.integrations.filter((item) => !normalized || `${item.id} ${item.title} ${item.kind} ${item.source} ${item.status}`.toLowerCase().includes(normalized)) ?? [], [snapshot, normalized]);
  const journal = useMemo(() => (events ?? []).filter((event) => !normalized || `${event.integrationId ?? ""} ${event.ruleId ?? ""} ${event.effect ?? ""} ${event.reason ?? ""}`.toLowerCase().includes(normalized)), [events, normalized]);

  const effectTone = (effect?: string) => effect === "block" ? "red" : effect === "warn" ? "amber" : effect === "allow" ? "emerald" : "neutral";
  const EFFECT_DECISION_LABELS: Record<string, string> = { block: "Блок", warn: "Предупреждение", allow: "Разрешено" };

  if (!snapshot && !error) return <Loading />;
  return <div className="space-y-4">
    {error ? <Notice tone="error">{error}</Notice> : null}
    {snapshot ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Правила", snapshot.totals.rules, `${snapshot.totals.critical} критических`],
          ["Тестовые сценарии", snapshot.totals.cases, "опасные · допустимые · граничные"],
          ["Точки применения", `${snapshot.totals.verifiedIntegrations}/${snapshot.totals.integrations}`, `${snapshot.totals.degradedIntegrations} требуют внимания`],
          ["Отпечаток политики", snapshot.policyDigest.slice(0, 12), `версия ${snapshot.policyVersion}`],
        ].map(([label, value, hint]) => <Panel key={String(label)} className="min-w-0">
          <SectionLabel>{label}</SectionLabel>
          <p className="mt-2 truncate font-mono text-xl text-fg">{value}</p>
          <p className="mt-1 text-[10px] text-fg-faint">{hint}</p>
        </Panel>)}
      </div>

      <Panel title="Действия аудитора" actions={<Chip tone={snapshot.checks.every((check) => check.ok) ? "emerald" : "red"}>{snapshot.checks.filter((check) => check.ok).length}/{snapshot.checks.length} проверок</Chip>}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void run("check")} disabled={Boolean(busy)}><ShieldCheck size={13}/>{busy === "check" ? "Проверка…" : "Проверить политику"}</Button>
          <Button variant="accent" onClick={() => void run("test")} disabled={Boolean(busy)}><Play size={13}/>{busy === "test" ? "Тесты…" : "Запустить тесты"}</Button>
          <Button onClick={() => void run("generate")} disabled={Boolean(busy)}><FileCog size={13}/>{busy === "generate" ? "Обновление…" : "Обновить отчёт"}</Button>
          <Button onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={13}/>Перечитать</Button>
          <Button onClick={download}><Download size={13}/>Скачать JSON</Button>
        </div>
        {output ? <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-line bg-page p-3 text-[10px] leading-relaxed text-fg-muted">{output}</pre> : null}
      </Panel>

      <Panel title="Контрольные проверки" actions={<span className="text-[10px] text-fg-faint">Нажмите строку для расшифровки</span>}>
        <div className="grid gap-2 md:grid-cols-2">{snapshot.checks.map((check) => {
          const open = expandedCheck === check.id;
          return <button key={check.id} type="button" aria-expanded={open} onClick={() => setExpandedCheck(open ? null : check.id)} className="rounded-lg border border-line/70 bg-page/40 p-3 text-left transition-colors hover:border-line-strong">
            <div className="flex items-start gap-2">
              <CheckCircle2 size={15} className={check.ok ? "mt-0.5 shrink-0 text-accent" : "mt-0.5 shrink-0 text-danger"}/>
              <div className="min-w-0 flex-1"><p className="text-xs font-medium text-fg">{check.title}</p><p className="mt-0.5 font-mono text-[9px] text-fg-faint">{check.id}</p><p className="mt-1 text-[10px] text-fg-muted">{check.detail}</p></div>
              <ChevronDown size={14} className={cx("mt-0.5 shrink-0 text-fg-faint transition-transform", open && "rotate-180")}/>
            </div>
            {open ? <div className="mt-3 space-y-2 border-t border-line/70 pt-3 text-[10px] leading-relaxed">
              <p><span className="font-medium text-fg">Для чего:</span> <span className="text-fg-muted">{check.purpose}</span></p>
              <p><span className="font-medium text-fg">От чего защищает:</span> <span className="text-fg-muted">{check.protects}</span></p>
              <p><span className="font-medium text-fg">Доказательство:</span> <span className="text-fg-muted">{check.evidence}</span></p>
            </div> : null}
          </button>;
        })}</div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={scope} onChange={setScope} ariaLabel="Раздел аудита" options={[{ key: "rules", label: "Защитные правила", count: snapshot.totals.rules }, { key: "integrations", label: "Точки применения", count: snapshot.totals.integrations, countTone: snapshot.totals.missingIntegrations ? "danger" : "neutral" }, { key: "journal", label: "Журнал решений", count: events?.length }, { key: "exceptions", label: "Исключения", count: (exceptions?.active.length ?? 0) + (exceptions?.expired.length ?? 0), countTone: exceptions?.expired.length ? "danger" : "neutral" }]} />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, ID, категория или файл…" className="min-w-64 flex-1" aria-label="Фильтр Guardrails"/>
      </div>

      {scope === "journal" ? <Panel title="Последние решения" actions={<span className="text-[10px] text-fg-faint">{eventsTruncated ? "показан хвост журнала" : "audit/events.jsonl"}</span>}>
        {aggregates && aggregates.total ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line/70 bg-page/40 px-3 py-2">
          <span className="text-[10px] text-fg-muted">7 дней: {aggregates.total} решений</span>
          <Chip tone="emerald">разрешено {aggregates.byEffect?.allow ?? 0}</Chip>
          <Chip tone="amber">предупреждений {aggregates.byEffect?.warn ?? 0}</Chip>
          <Chip tone="red">блокировок {aggregates.byEffect?.block ?? 0}</Chip>
          {aggregates.exceptions ? <Chip tone="sky">исключений {aggregates.exceptions}</Chip> : null}
          {typeof aggregates.p95LatencyMs === "number" ? <span className="text-[10px] text-fg-faint">p95 {aggregates.p95LatencyMs} мс</span> : null}
          {aggregates.topRules?.slice(0, 3).map((row) => <span key={row.name} className="font-mono text-[9px] text-fg-faint">{row.name} ({row.count})</span>)}
        </div> : null}
        {journal.length ? <div className="space-y-1.5">{journal.map((event, index) => <div key={event.decisionId ?? index} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/70 bg-page/40 px-3 py-2">
          <Chip tone={effectTone(event.effect)}>{EFFECT_DECISION_LABELS[event.effect ?? ""] ?? event.effect ?? "-"}</Chip>
          <span className="font-mono text-[10px] text-fg">{event.ruleId ?? "-"}</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-fg-muted" title={event.reason}>{event.reason}</span>
          <span className="font-mono text-[9px] text-fg-faint">{event.integrationId ?? event.runtime ?? ""}</span>
          {event.exceptionId ? <Chip tone="sky">исключение {event.exceptionId}</Chip> : null}
          <span className="font-mono text-[9px] text-fg-faint">{event.at ? new Date(event.at).toLocaleTimeString() : ""}{typeof event.latencyMs === "number" ? ` · ${event.latencyMs} мс` : ""}</span>
        </div>)}</div> : <EmptyState size="sm">Решений пока нет - журнал заполняется хуками и проверками.</EmptyState>}
      </Panel> : null}
      {scope === "exceptions" ? <Panel title="Исключения политики" actions={<span className="text-[10px] text-fg-faint">guardrails/exceptions/*.json</span>}>
        {exceptions?.active.length ? <div className="space-y-2">{exceptions.active.map((item) => {
          const open = expandedException === item.id;
          const expiredSoon = Date.parse(item.expiresAt) - Date.now() < 7 * 24 * 60 * 60 * 1000;
          return <button type="button" key={item.id} aria-expanded={open} onClick={() => setExpandedException(open ? null : item.id)} className="block w-full rounded-xl border border-line bg-surface/60 p-4 text-left transition-colors hover:border-line-strong">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1"><h3 className="font-mono text-xs font-semibold text-fg">{item.id}</h3><p className="mt-1 text-[11px] text-fg-muted">{item.reason}</p></div>
              <div className="flex shrink-0 items-center gap-1.5"><Chip tone="emerald">активно</Chip>{expiredSoon ? <Chip tone="amber">истекает</Chip> : null}<ChevronDown size={14} className={cx("text-fg-faint transition-transform", open && "rotate-180")}/></div>
            </div>
            {open ? <div className="mt-3 grid gap-2 border-t border-line/70 pt-3 text-[10px] leading-relaxed md:grid-cols-2">
              <Detail title="Правило"><span className="font-mono">{item.ruleId}</span></Detail>
              <Detail title="Действует до">{new Date(item.expiresAt).toLocaleString()}</Detail>
              <Detail title="Одобрил" wide>{item.approvedBy}</Detail>
            </div> : null}
          </button>;
        })}</div> : <EmptyState size="sm">Активных исключений нет.</EmptyState>}
        {exceptions?.expired.length ? <div className="mt-3">
          <SectionLabel>Просроченные ({exceptions.expired.length})</SectionLabel>
          <div className="mt-2 space-y-1.5">{exceptions.expired.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/70 bg-page/40 px-3 py-2 text-[10px]">
            <Chip tone="neutral">истёкло</Chip>
            <span className="font-mono text-fg">{item.id}</span>
            <span className="font-mono text-fg-faint">{item.ruleId}</span>
            <span className="ml-auto text-fg-faint">{new Date(item.expiresAt).toLocaleDateString()}</span>
          </div>)}</div>
        </div> : null}
        {exceptions?.errors.length ? <Notice tone="error">{exceptions.errors.join("; ")}</Notice> : null}
      </Panel> : null}

      {scope === "rules" ? <div className="space-y-2">{rules.map((rule) => {
        const open = expandedRule === rule.id;
        return <button type="button" key={rule.id} aria-expanded={open} onClick={() => setExpandedRule(open ? null : rule.id)} className="block w-full rounded-xl border border-line bg-surface/60 p-4 text-left transition-colors hover:border-line-strong">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-fg">{rule.title}</h3><p className="mt-0.5 font-mono text-[9px] text-fg-faint">{rule.id}</p><p className="mt-1.5 text-[11px] text-fg-muted">{rule.description}</p></div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5"><Chip tone={severityTone(rule.severity)}>{SEVERITY_LABELS[rule.severity] ?? rule.severity}</Chip><Chip>{EFFECT_LABELS[rule.effect] ?? rule.effect}</Chip><ChevronDown size={14} className={cx("ml-1 text-fg-faint transition-transform", open && "rotate-180")}/></div>
          </div>
          {open ? <div className="mt-4 grid gap-2 border-t border-line/70 pt-4 md:grid-cols-2">
            <Detail title="Для чего нужно">{rule.description}</Detail>
            <Detail title="От чего защищает">{CATEGORY_EXPLANATIONS[rule.category] ?? rule.threats.join(", ")}</Detail>
            <Detail title="Что произойдёт">{EFFECT_LABELS[rule.effect] ?? rule.effect}. {rule.failureMode === "closed" ? "Если проверка сломается, действие также будет остановлено." : "При сбое проверки действие может продолжиться."}</Detail>
            <Detail title="Что делать при срабатывании">{rule.remediation}</Detail>
            <Detail title="Проверяемые примеры" wide>
              <div className="grid gap-2 lg:grid-cols-3">
                <div><span className="text-danger">Опасный — срабатывает</span><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[9px]">{rule.examples.blocked}</pre></div>
                <div><span className="text-accent">Допустимый — пропускается</span><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[9px]">{rule.examples.allowed}</pre></div>
                <div><span className="text-warning">Граничный</span><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[9px]">{rule.examples.edge}</pre></div>
              </div>
            </Detail>
            <Detail title="Технические сведения" wide><span className="font-mono">{rule.implementation}</span> · {rule.cases} тестовых сценария · категория <span className="font-mono">{rule.category}</span>{rule.limitations.length ? ` · ограничения: ${rule.limitations.join("; ")}` : ""}</Detail>
          </div> : null}
        </button>;
      })}{!rules.length ? <EmptyState>Правила не найдены.</EmptyState> : null}</div> : <div className="space-y-2">{integrations.map((item) => {
        const open = expandedIntegration === item.id;
        return <button type="button" key={item.id} aria-expanded={open} onClick={() => setExpandedIntegration(open ? null : item.id)} className="block w-full rounded-xl border border-line bg-surface/60 p-4 text-left transition-colors hover:border-line-strong">
          <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-fg">{item.title}</h3><p className="mt-0.5 font-mono text-[9px] text-fg-faint">{item.id}</p><p className="mt-1.5 text-[11px] text-fg-muted">{item.purpose}</p></div><div className="flex shrink-0 flex-wrap items-center gap-1.5"><Chip tone={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Chip><Chip>{KIND_LABELS[item.kind] ?? item.kind}</Chip><ChevronDown size={14} className={cx("ml-1 text-fg-faint transition-transform", open && "rotate-180")}/></div></div>
          {open ? <div className="mt-4 grid gap-2 border-t border-line/70 pt-4 md:grid-cols-2">
            <Detail title="Для чего нужна">{item.purpose}</Detail><Detail title="Что защищает">{item.protects}</Detail>
            <Detail title="Где подключена"><span className="font-mono text-info">{item.source}</span></Detail><Detail title="Текущее состояние">{item.detail} {item.notes}</Detail>
            <Detail title="Поведение при сбое" wide>{item.expectedFailureMode === "closed" ? "Fail-closed: действие будет остановлено, если Guardrails недоступен или завершился с ошибкой." : "Fail-open: действие может продолжиться при сбое проверки."}</Detail>
          </div> : null}
        </button>;
      })}{!integrations.length ? <EmptyState>Интеграции не найдены.</EmptyState> : null}</div>}
    </> : null}
  </div>;
}
