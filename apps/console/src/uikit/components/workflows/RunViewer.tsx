"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Footnote, Input, Modal, Notice, Segmented, Select, Textarea } from "@/uikit";
import { VirtualList } from "@/uikit/components/VirtualList";
import { Checklist, RunStepSection, StepProgressChips } from "@/uikit/components/workflows/RunSections";

type Event = { id: number; at: string; type: string; stepId: string | null; agentId: string | null; parentAgentId: string | null; payload: Record<string, unknown> };
type InterruptInfo = { kind?: string; stepId?: string; title?: string; plan?: string; summary?: string; assignment?: string; variants?: Array<{ label: string; text: string }>; questions?: string[]; criteria?: Array<{ criterion: string; status: "pass" | "fail"; note?: string }>; attempts?: { used?: number; maxAttempts?: number } };
type StepSnapshot = { id: string; title: string; phase: string; description?: string; roles: string[]; hidden?: boolean; runtime: { candidates: string[]; tier?: string; effort?: string }; inputControl?: { prompt?: string; dor?: string[] } | null; execution?: { prompt?: string; confirmPlan?: boolean } | null; outputControl?: { tests?: string[]; dod?: string[]; ac?: string[]; manualReview?: boolean } | null };
type Run = { id: string; title: string; status: string; privacy: string; input: Record<string, unknown>; snapshot: { nodes: Array<StepSnapshot & { role?: unknown }> }; error: string | null };
type StepAttempt = { id: string; step_id: string; status: string; runtime: string | null; model: string | null; section: string | null; started_at: string | null; finished_at: string | null; error: string | null; input_tokens: number; output_tokens: number; cache_tokens: number; cost_value: number | null; cost_currency: string | null };
type StepArtifact = { id: string; name: string; path: string | null; checksum: string; createdAt: string; size: number; content: string | null };
type StepDetail = { run: { id: string; status: string; privacy: string; error: string | null }; step: (StepSnapshot & { role?: unknown }) | null; endState: string | null; events: Event[]; attempts: StepAttempt[]; artifacts: StepArtifact[] };
type LessonsProposal = { target: string; kind: string; title: string; diff: string; reason: string; category: string };
/** Верхний сегмент панели шага: Данные (по умолчанию) и секции конвейера. */
type StepSection = "data" | "input" | "execution" | "output" | "decision";
/** Вложенный сегмент вкладки "Данные". */
type DataTab = "errors" | "log" | "tools" | "artifacts" | "agents" | "stats";

/** Старые snapshot (до v2) хранят тройку role вместо массива roles - показываем без ролей. */
function stepRoles(node: StepSnapshot & { role?: unknown }): string[] {
  return Array.isArray(node.roles) ? node.roles : [];
}

const STEP_END_EVENTS = ["step.completed", "step.failed", "step.skipped"];
const RUN_STATUSES_FOR_RETRY = ["failed", "interrupted", "cancelled"];
/** Расширения текстовых файлов: артефакт с таким расширением открывается в просмотре содержимого. */
const TEXT_EXTENSIONS = new Set(["md", "txt", "json", "yaml", "yml", "csv", "tsv", "log", "xml", "html", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "sh", "bash", "zsh", "fish", "sql", "toml", "ini", "cfg", "conf"]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Текстовый артефакт: расширение пути или имени; у имён без расширения решает наличие содержимого. */
function isTextArtifact(artifact: StepArtifact): boolean {
  const ext = fileExtension(artifact.path ?? artifact.name);
  return ext ? TEXT_EXTENSIONS.has(ext) : artifact.content != null;
}

/** Человекочитаемые метки групп служебных маркеров: префикс имени без номера цикла. */
const MARKER_LABELS: Record<string, string> = {
  "__ic": "Вызовы входного контроля",
  "__ic-parsefail": "Входной контроль без вердикта",
  "__plan": "Планы",
  "__rejplan": "Отклонённые планы",
  "__work": "Циклы исполнения",
  "__review": "Вызовы выходного контроля",
  "__review-parsefail": "Выходной контроль без вердикта",
  "__ret-accept": "Возвраты приёмки",
  "__ret-tests": "Возвраты по тестам",
  "__ret-input": "Возвраты входа",
  "__rej": "Отклонения ревью",
};

function markerPrefix(name: string): string {
  return name.replace(/-\d+$/, "");
}

export function RunViewer({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [lessons, setLessons] = useState<LessonsProposal[] | null>(null);
  const [reason, setReason] = useState("Действие оператора в Console");
  const [comment, setComment] = useState("");
  const [answer, setAnswer] = useState("");
  const [stepId, setStepId] = useState("");
  const [runtime, setRuntime] = useState("");
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [lessonsTab, setLessonsTab] = useState<"auto" | "manual">("auto");
  const [lessonsSelected, setLessonsSelected] = useState<Record<string, boolean>>({});
  const [applyRuntime, setApplyRuntime] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<StepAttempt[]>([]);

  const load = () => fetch(`/api/workflow-runs/${id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
    setRun(j.run); setEvents(j.events ?? []); setLessons(j.lessons ?? null); setAttempts(j.attempts ?? []);
  });
  useEffect(() => {
    void load();
    const source = new EventSource(`/api/workflow-runs/${id}/events`);
    const receive = (event: MessageEvent) => {
      const value = JSON.parse(event.data) as Event;
      setEvents((old) => old.some((item) => item.id === value.id) ? old : [...old, value]);
      // Попытки и вердикты контролей обновляют статистику секций: перезагружаем данные прогона.
      if (value.type.startsWith("run.") || value.type.startsWith("lessons.") || value.type.startsWith("input.") || value.type.startsWith("acceptance.") || value.type.startsWith("plan.")) void load();
    };
    source.addEventListener("workflow", receive as EventListener);
    source.addEventListener("done", () => { void load(); source.close(); });
    return () => source.close();
  }, [id]);

  const action = async (name: string, payload: Record<string, unknown> = {}) => {
    const response = await fetch(`/api/workflow-runs/${id}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: name, payload: { reason, ...payload } }) });
    const result = await response.json().catch(() => ({}));
    setActionMessage(response.ok ? "Действие отправлено" : result.error ?? "Ошибка действия");
    setComment("");
    void load();
  };
  const fork = async () => {
    const response = await fetch("/api/workflow-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ forkFromRunId: id }) });
    const result = await response.json();
    if (response.ok && result.run?.id) window.location.href = `/workflows/runs/${result.run.id}`;
  };

  const waitingInterrupt = useMemo<InterruptInfo | null>(() => {
    if (run?.status !== "waiting") return null;
    const waiting = [...events].reverse().find((event) => event.type === "run.waiting");
    const interrupts = waiting?.payload?.interrupts;
    if (!Array.isArray(interrupts) || !interrupts.length) return null;
    // LangGraph кладёт {id, value}: payload решения - в value.
    const raw = interrupts[0] as InterruptInfo & { value?: InterruptInfo };
    return (raw.value ?? raw) as InterruptInfo;
  }, [run?.status, events]);

  const latest = new Map(events.filter((e) => e.stepId).map((e) => [e.stepId!, e.type]));
  const endStates = new Map<string, string>();
  for (const event of events) {
    if (event.stepId && STEP_END_EVENTS.includes(event.type)) endStates.set(event.stepId, event.type);
  }
  // Панель шага открыта всегда: по умолчанию - шаг с ошибкой, без ошибок - первый шаг.
  const nodes = (run?.snapshot.nodes ?? []).filter((node) => !node.hidden);
  const autoStepId = nodes.find((node) => endStates.get(node.id) === "step.failed")?.id ?? nodes[0]?.id ?? null;
  const selectedStep = activeStep ?? autoStepId;
  const completedCount = [...endStates.values()].filter((type) => type === "step.completed").length;
  const runtimeOptions = [...new Set(run?.snapshot.nodes.flatMap((node) => node.runtime.candidates) ?? [])];
  const lessonsAuto = lessons?.filter((item) => item.category === "auto") ?? [];
  const lessonsManual = lessons?.filter((item) => item.category !== "auto") ?? [];
  const selectedCount = Object.values(lessonsSelected).filter(Boolean).length;
  const canRetry = Boolean(run && RUN_STATUSES_FOR_RETRY.includes(run.status));
  const waitingFallback = run?.status === "waiting" && !waitingInterrupt;
  const capabilityWarnings = events.filter((event) => event.type === "run.preflight-warning");

  return <div className="space-y-4">
    <section className="space-y-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={run?.status === "completed" ? "emerald" : run?.status === "waiting" ? "amber" : run?.status === "interrupted" ? "red" : "sky"}>{run?.status ?? "загрузка"}</Chip>
        <span className="text-xs text-fg-muted">{run?.title}</span>
        {actionMessage ? <span className="text-xs text-fg-faint">{actionMessage}</span> : null}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button href="/agent?tab=tasks">К задачам</Button>
          <Button href="/agent?tab=workflow">К workflow</Button>
          {lessons && lessons.length ? <Button variant="accent" onClick={() => setLessonsOpen(true)}>Lessons learned ({lessons.length})</Button> : null}
          <Button onClick={fork}>Fork</Button>
          <Button variant="danger" onClick={() => action("abort")}>Abort</Button>
        </span>
      </div>
      {waitingInterrupt ? <InterruptPanel info={waitingInterrupt} comment={comment} setComment={setComment} answer={answer} setAnswer={setAnswer} action={action} /> : canRetry ? (
        <div className="grid gap-2 md:grid-cols-3">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина для повтора/skip/replace" />
          <Select value={stepId} onChange={setStepId} options={[{ value: "", label: "Выберите шаг" }, ...(run?.snapshot.nodes ?? []).map((node) => ({ value: node.id, label: node.title }))]} />
          <Select value={runtime} onChange={setRuntime} options={[{ value: "", label: "Runtime для замены" }, ...runtimeOptions.map((rid) => ({ value: rid, label: rid }))]} />
          <div className="flex flex-wrap gap-2 md:col-span-3">
            <Button onClick={() => action("restart")}>Повторить с начала</Button>
            <Button onClick={() => action("retry-from-success")} disabled={completedCount === 0}>Повторить с последнего удачного шага</Button>
            <Button onClick={() => action("skip", { stepId })} disabled={!stepId}>Skip</Button>
            <Button onClick={() => action("replace", { stepId, runtime })} disabled={!stepId || !runtime}>Replace</Button>
          </div>
          <Footnote className="md:col-span-3">Повтор с начала перезаписывает артефакты всех шагов; находки ошибок, возвраты и предложения lessons learned сохраняются. Повтор с последнего удачного шага перезаписывает только неуспешные шаги.</Footnote>
        </div>
      ) : waitingFallback ? (
        <div className="grid gap-2 md:grid-cols-3">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина для retry/skip/replace" />
          <Select value={stepId} onChange={setStepId} options={[{ value: "", label: "Выберите шаг" }, ...(run?.snapshot.nodes ?? []).map((node) => ({ value: node.id, label: node.title }))]} />
          <Select value={runtime} onChange={setRuntime} options={[{ value: "", label: "Runtime для замены" }, ...runtimeOptions.map((rid) => ({ value: rid, label: rid }))]} />
          <div className="flex flex-wrap gap-2 md:col-span-3">
            <Button onClick={() => action("retry")}>Продолжить</Button>
            <Button onClick={() => action("skip", { stepId })} disabled={!stepId}>Skip</Button>
            <Button onClick={() => action("replace", { stepId, runtime })} disabled={!stepId || !runtime}>Replace</Button>
          </div>
        </div>
      ) : null}
    </section>
    {capabilityWarnings.length ? <Notice tone="info">Запуск продолжен без {capabilityWarnings.length} capabilities: {capabilityWarnings.map((event) => String(event.payload.capabilityKind ?? event.payload.code) + ":" + String(event.payload.capabilityId ?? "?")).join(", ")}. Агенты используют fallback и фиксируют ограничения в артефактах.</Notice> : null}
    <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
      <section className="space-y-2">{nodes.map((n) => {
        const end = endStates.get(n.id);
        const selected = n.id === selectedStep;
        // Шаг ещё не начинал работу (событий нет): карточка не нажимается.
        const idle = !latest.has(n.id) && !end;
        return <button key={n.id} type="button" disabled={idle} onClick={() => setActiveStep(n.id)} title={idle ? "Шаг ожидает запуска" : undefined} className={`block w-full rounded-lg border bg-surface p-2 text-left transition-colors ${idle ? "cursor-not-allowed border-line opacity-50" : `cursor-pointer hover:border-info/50 ${selected ? "border-info/60" : "border-line"}`}`}>
          <div className="flex justify-between text-xs"><span>{n.title}</span><StepStateTone end={end} fallback={latest.get(n.id)} /></div>
          <div className="mt-1 flex flex-wrap gap-1">{stepRoles(n).map((role) => <Chip key={role} tone="dim" mono>{role}</Chip>)}</div>
          <StepProgressChips node={n} events={events} />
          <div className="font-mono text-[10px] text-fg-faint">{n.phase} · {n.id}</div>
        </button>;
      })}</section>
      {selectedStep
        ? <StepDetailPanel runId={id} stepId={selectedStep} refreshKey={events.length} pending={waitingInterrupt?.stepId === selectedStep ? waitingInterrupt : null} runInput={run?.input ?? {}} action={action} />
        : <section className="rounded-xl border border-line bg-page p-3"><Notice>Шагов в прогоне нет.</Notice></section>}
    </div>
    <LessonsModal
      open={lessonsOpen}
      lessons={lessons ?? []}
      auto={lessonsAuto}
      manual={lessonsManual}
      tab={lessonsTab}
      setTab={setLessonsTab}
      selected={lessonsSelected}
      setSelected={setLessonsSelected}
      runtime={applyRuntime}
      setRuntime={setApplyRuntime}
      runtimeOptions={runtimeOptions}
      selectedCount={selectedCount}
      onClose={() => setLessonsOpen(false)}
      apply={() => {
        const selected = (lessons ?? []).filter((item) => lessonsSelected[item.target]).map((item) => item.target);
        if (!selected.length) return;
        void action("apply-lessons", { selected, runtime: applyRuntime });
        setLessonsOpen(false);
      }}
    />
  </div>;
}

function StepStateTone({ end, fallback }: { end?: string; fallback?: string }) {
  const tone = end === "step.completed" ? "emerald" : end === "step.failed" ? "red" : end === "step.skipped" ? "dim" : "sky";
  const label = end === "step.completed" ? "завершён" : end === "step.failed" ? "ошибка" : end === "step.skipped" ? "пропущен" : fallback ?? "ожидается";
  return <Chip tone={tone}>{label}</Chip>;
}

/** Панель решения оператора для ожидающего interrupt шага. */
function DecisionPanel({ pending, artifacts, privacyFull, runInput, action }: {
  pending: InterruptInfo;
  artifacts: StepArtifact[];
  privacyFull: boolean;
  runInput: Record<string, unknown>;
  action: (name: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  if (pending.kind === "input-rework") return <InputConfirmDecision pending={pending} runInput={runInput} action={action} />;
  if (pending.kind === "acceptance") return <AcceptanceDecision pending={pending} artifacts={artifacts} privacyFull={privacyFull} action={action} />;
  if (pending.kind === "plan-confirm") return <PlanConfirmDecision pending={pending} action={action} />;
  return <Notice>Прогон ожидает решения оператора ({pending.kind ?? "interrupt"}); используйте карточку на доске задач.</Notice>;
}

/** Доработка входа первого шага: уточняющие вопросы контролёра и ручное переписывание промта. */
function InputConfirmDecision({ pending, runInput, action }: { pending: InterruptInfo; runInput: Record<string, unknown>; action: (name: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [tab, setTab] = useState<"questions" | "prompt">("questions");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [prompt, setPrompt] = useState("");
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState("");
  const questions = pending.questions ?? [];
  const answered = questions.filter((question, index) => (answers[index] ?? "").trim()).length;
  const promptText = prompt.trim();
  const canSubmit = Boolean(promptText) || answered > 0;
  const improve = async () => {
    const source = promptText || questions.map((question) => question).join(" ") || Object.values(runInput).map(String).join(" ");
    if (!source.trim()) { setImproveError("Нет текста для улучшения - заполните промт"); return; }
    setImproving(true);
    setImproveError("");
    try {
      const response = await fetch("/api/prompts/improve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: source }) });
      const result = await response.json();
      if (!response.ok) setImproveError(result.error ?? "Ошибка улучшения");
      else setPrompt(String(result.prompt ?? ""));
    } catch (error) {
      setImproveError(error instanceof Error ? error.message : String(error));
    } finally {
      setImproving(false);
    }
  };
  const submit = async () => {
    const questionsPayload = questions.map((question, index) => ({ question, answer: (answers[index] ?? "").trim() })).filter((item) => item.answer);
    await action("answer-questions", { answer: promptText, questions: questionsPayload });
    setAnswers({});
    setPrompt("");
  };
  return <div className="space-y-3">
    <Notice tone="info">Вход шага {pending.stepId} возвращён на доработку: выберите вариант из "Входного контроля", ответьте на вопросы и/или перепишите промт. Ответ уходит на повторную проверку входного контроля.</Notice>
    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[11px]">{pending.assignment ?? ""}</pre>
    <Segmented
      className="w-fit"
      ariaLabel="Способ подтверждения входа"
      value={tab}
      onChange={setTab}
      options={[
        { key: "questions", label: `Уточняющие вопросы${questions.length ? ` (${answered}/${questions.length})` : ""}` },
        { key: "prompt", label: "Промпт" },
      ]}
    />
    {tab === "questions" ? <div className="space-y-2">
      {questions.length ? questions.map((question, index) => <div key={index} className="rounded-lg border border-line bg-surface p-2">
        <div className="text-xs font-semibold">{index + 1}. {question}</div>
        <Textarea value={answers[index] ?? ""} onChange={(e) => setAnswers({ ...answers, [index]: e.target.value })} rows={2} placeholder="Ваш ответ" className="mt-1 w-full" />
      </div>) : <Notice>Вопросов от контролёра нет - используйте вкладку "Промпт" или варианты во вкладке "Входной контроль".</Notice>}
      {attemptsFootnote(pending)}
      <Button variant="primary" disabled={!canSubmit} onClick={submit}>Отправить на повторную проверку</Button>
    </div> : <div className="space-y-2">
      <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="Перепишите задание вручную или нажмите Автоулучшить" className="w-full" />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={improving} onClick={improve}>{improving ? "Улучшение…" : "Автоулучшить промпт"}</Button>
        {improveError ? <span className="text-xs text-danger">{improveError}</span> : null}
      </div>
      {attemptsFootnote(pending)}
      <Button variant="primary" disabled={!canSubmit} onClick={submit}>Отправить на повторную проверку</Button>
    </div>}
  </div>;
}

function attemptsFootnote(pending: InterruptInfo) {
  return pending.attempts ? <Footnote>Попытки: {pending.attempts.used ?? 0} из {pending.attempts.maxAttempts ?? "?"}</Footnote> : null;
}

/** Ручная приёмка: критерии ревью, артефакт шага и решение оператора. */
function AcceptanceDecision({ pending, artifacts, privacyFull, action }: { pending: InterruptInfo; artifacts: StepArtifact[]; privacyFull: boolean; action: (name: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const outputs = artifacts.filter((artifact) => !artifact.name.startsWith("__"));
  return <div className="space-y-2">
    <Notice tone="info">Ручная приёмка шага {pending.stepId}: {pending.title ?? ""}. Авто-проверки пройдены; решение за оператором. Отложить - пауза без расхода попыток.</Notice>
    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[11px]">{pending.summary ?? ""}</pre>
    {outputs.length ? <div className="text-xs"><span className="font-semibold">Артефакт шага: </span>{privacyFull
      ? <details><summary className="cursor-pointer text-fg-muted">{outputs[0].name}</summary><pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[10px] text-fg-faint">{outputs[0].content}</pre></details>
      : <span className="text-fg-muted">{outputs[0].name} - содержимое скрыто режимом приватности</span>}</div> : null}
    {attemptsFootnote(pending)}
    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Комментарий для отклонения или отложения (обязателен)" className="w-full" />
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => action("accept", { decision: "approve" })}>Принять</Button>
      <Button disabled={!comment.trim()} onClick={() => action("accept", { decision: "defer", comment })}>Отложить</Button>
      <Button variant="danger" disabled={!comment.trim()} onClick={() => action("accept", { decision: "reject", comment })}>Отклонить с комментарием</Button>
    </div>
  </div>;
}

/** Подтверждение плана шага. */
function PlanConfirmDecision({ pending, action }: { pending: InterruptInfo; action: (name: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [comment, setComment] = useState("");
  return <div className="space-y-2">
    <Notice tone="info">Требуется подтверждение плана шага {pending.stepId}: {pending.title ?? ""}.</Notice>
    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[11px]">{pending.plan ?? ""}</pre>
    {attemptsFootnote(pending)}
    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Комментарий для отклонения (обязателен)" className="w-full" />
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => action("confirm-plan", { decision: "approve" })}>Подтвердить план</Button>
      <Button variant="danger" disabled={!comment.trim()} onClick={() => action("confirm-plan", { decision: "reject", comment })}>Отклонить с комментарием</Button>
    </div>
  </div>;
}

function StepDetailPanel({ runId, stepId, refreshKey, pending, runInput, action }: { runId: string; stepId: string; refreshKey: number; pending: InterruptInfo | null; runInput: Record<string, unknown>; action: (name: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [detail, setDetail] = useState<StepDetail | null>(null);
  const [section, setSection] = useState<StepSection>("data");
  const [dataTab, setDataTab] = useState<DataTab | null>(null);
  const [viewedArtifact, setViewedArtifact] = useState<StepArtifact | null>(null);
  const [viewedGroup, setViewedGroup] = useState<{ prefix: string; group: StepArtifact[] } | null>(null);
  const load = useCallback(() => {
    return fetch(`/api/workflow-runs/${runId}/steps/${stepId}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setDetail(j as StepDetail)).catch(() => undefined);
  }, [runId, stepId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { setSection("data"); setDataTab(null); }, [stepId]);

  // Появилось решение для этого шага - переключаем сегмент на "Решение" (по ключу, без навязчивых сбросов).
  const pendingKey = pending ? `${pending.stepId}|${pending.kind}|${pending.attempts?.used ?? 0}` : "";
  const lastPendingKey = useRef("");
  useEffect(() => {
    if (pendingKey && pendingKey !== lastPendingKey.current) setSection("decision");
    lastPendingKey.current = pendingKey;
  }, [pendingKey]);

  const step = detail?.step;
  const agents = [...new Map((detail?.events ?? []).filter((event) => event.agentId).map((event) => [event.agentId!, { id: event.agentId!, parent: event.parentAgentId }])).values()];
  const errors = detail?.events.filter((event) => ["step.failed", "step.runtime-failed", "step.attempt-exhausted"].includes(event.type)) ?? [];
  const failedAttempts = detail?.attempts.filter((attempt) => attempt.error || attempt.status === "failed") ?? [];
  const errorArtifacts = detail?.artifacts.filter((artifact) => artifact.name.startsWith("__err-")) ?? [];
  const toolCalls = detail?.events.filter((event) => event.type === "step.tool-call") ?? [];
  const visibleArtifacts = detail?.artifacts.filter((artifact) => !artifact.name.startsWith("__")) ?? [];
  const internalArtifacts = detail?.artifacts.filter((artifact) => artifact.name.startsWith("__") && !artifact.name.startsWith("__err-")) ?? [];
  const fullContent = detail?.run.privacy === "full";
  const runError = detail?.run.error ?? null;
  const hasErrors = Boolean(runError) || errors.length > 0 || failedAttempts.length > 0 || errorArtifacts.length > 0;
  const hasInput = Boolean(step?.inputControl);
  const hasOutput = Boolean(step?.outputControl);
  const stepHasErrors = errors.length > 0 || failedAttempts.length > 0 || errorArtifacts.length > 0;
  // Вкладка "Данные" по умолчанию; внутри неё - "Ошибки" при наличии ошибок, иначе "Лог".
  const activeDataTab: DataTab = dataTab ?? (stepHasErrors ? "errors" : "log");
  const sectionOptions: ReadonlyArray<{ key: StepSection; label: string }> = [
    { key: "data", label: "Данные" },
    ...(hasInput ? [{ key: "input" as StepSection, label: "Входной контроль" }] : []),
    { key: "execution", label: "Исполнение" },
    ...(hasOutput ? [{ key: "output" as StepSection, label: "Выходной контроль" }] : []),
    ...(pending ? [{ key: "decision" as StepSection, label: "Решение" }] : []),
  ];
  const dataTabOptions: ReadonlyArray<{ key: DataTab; label: string; count?: number; countTone?: "neutral" | "danger" }> = [
    { key: "errors", label: "Ошибки", count: errors.length + failedAttempts.length, countTone: "danger" },
    { key: "log", label: "Лог", count: detail?.events.length ?? 0 },
    { key: "tools", label: "Инструменты", count: toolCalls.length },
    { key: "artifacts", label: "Артефакты", count: visibleArtifacts.length },
    { key: "agents", label: "Агенты", count: agents.length },
    { key: "stats", label: "Статистика" },
  ];

  // Статистика шага: токены и стоимость по попыткам, срез по runtime и моделям.
  const tokens = (detail?.attempts ?? []).reduce(
    (acc, attempt) => ({ input: acc.input + (attempt.input_tokens ?? 0), output: acc.output + (attempt.output_tokens ?? 0), cache: acc.cache + (attempt.cache_tokens ?? 0) }),
    { input: 0, output: 0, cache: 0 },
  );
  const tokensTotal = tokens.input + tokens.output + tokens.cache;
  const costTotal = (detail?.attempts ?? []).reduce((sum, attempt) => sum + (attempt.cost_value ?? 0), 0);
  const costCurrencies = [...new Set((detail?.attempts ?? []).map((attempt) => attempt.cost_currency).filter(Boolean))];
  const pricedAttempts = (detail?.attempts ?? []).filter((attempt) => attempt.cost_value != null).length;
  const runtimeRows = new Map<string, { runtime: string; model: string; calls: number; completed: number; input: number; output: number; cache: number; cost: number }>();
  for (const attempt of detail?.attempts ?? []) {
    const key = (attempt.runtime ?? "-") + "|" + (attempt.model ?? "-");
    const row = runtimeRows.get(key) ?? { runtime: attempt.runtime ?? "-", model: attempt.model ?? "-", calls: 0, completed: 0, input: 0, output: 0, cache: 0, cost: 0 };
    row.calls += 1;
    if (attempt.status === "completed") row.completed += 1;
    row.input += attempt.input_tokens ?? 0;
    row.output += attempt.output_tokens ?? 0;
    row.cache += attempt.cache_tokens ?? 0;
    row.cost += attempt.cost_value ?? 0;
    runtimeRows.set(key, row);
  }
  const markerGroups = new Map<string, StepArtifact[]>();
  for (const artifact of internalArtifacts) {
    const prefix = markerPrefix(artifact.name);
    markerGroups.set(prefix, [...(markerGroups.get(prefix) ?? []), artifact]);
  }
  const tier = step?.runtime.tier;
  const effort = step?.runtime.effort;

  return <section className="max-h-[640px] overflow-y-auto rounded-xl border border-line bg-page">
    <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-page p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{step ? step.title : stepId}</span>
        <StepStateTone end={detail?.endState ?? undefined} fallback={detail?.events.at(-1)?.type} />
        <span className="ml-auto text-xs text-fg-muted">{detail ? `Событий: ${detail.events.length}, попыток: ${detail.attempts.length}, артефактов: ${detail.artifacts.length}` : "загрузка…"}</span>
      </div>
      <div className="font-mono text-[10px] text-fg-faint">{step ? [step.phase, step.id, stepRoles(step).join(", ")].filter(Boolean).join(" · ") : stepId}</div>
      {step?.description ? <div className="text-[11px] text-fg-muted">{step.description}</div> : null}
      <Segmented
        className="w-fit max-w-full flex-wrap"
        ariaLabel="Разделы шага"
        value={section}
        onChange={setSection}
        options={sectionOptions}
      />
      {section === "data" ? <Segmented
        className="w-fit max-w-full flex-wrap"
        ariaLabel="Данные шага"
        value={activeDataTab}
        onChange={setDataTab}
        options={dataTabOptions}
      /> : null}
    </div>
    <div className="space-y-3 p-3">
      {detail && !fullContent ? <Notice tone="info">Режим приватности {detail.run.privacy}: тексты промтов и содержимое артефактов не выдаются; показаны размер и контрольная сумма.</Notice> : null}
      {section === "data" && activeDataTab === "log" ? <div className="space-y-1">{(detail?.events ?? []).map((event) => <div key={event.id} className="border-b border-line/50 py-2 text-xs last:border-b-0"><div className="flex justify-between"><span className="text-info">{event.type}</span><time className="text-fg-faint">{new Date(event.at).toLocaleTimeString()}</time></div><div className="font-mono text-[10px] text-fg-muted">{[event.agentId, event.payload.section ? String(event.payload.section) : ""].filter(Boolean).join(" · ")}</div><pre className="mt-1 whitespace-pre-wrap text-[10px] text-fg-faint">{JSON.stringify(event.payload)}</pre></div>)}</div> : null}
      {section === "data" && activeDataTab === "errors" ? <div className="space-y-2">
        {hasErrors ? <>
          {runError ? <div className="rounded border border-danger/40 bg-surface p-2 text-xs">
            <Chip tone="red">Ошибка прогона</Chip>
            <pre className="mt-1 whitespace-pre-wrap text-[11px] text-danger">{runError}</pre>
          </div> : null}
          {failedAttempts.map((attempt) => <div key={attempt.id} className="rounded border border-danger/40 bg-surface p-2 text-xs">
            <div className="flex flex-wrap gap-2"><Chip tone="red" mono>{attempt.status}</Chip><span className="text-fg-muted">{[attempt.section, attempt.runtime, attempt.model].filter(Boolean).join(" · ")}</span>{attempt.finished_at ? <time className="ml-auto text-fg-faint">{new Date(attempt.finished_at).toLocaleTimeString()}</time> : null}</div>
            {attempt.error ? <pre className="mt-1 whitespace-pre-wrap text-[11px] text-danger">{attempt.error}</pre> : null}
          </div>)}
          {errors.map((event) => <div key={event.id} className="rounded border border-line bg-surface p-2 text-xs">
            <div className="flex justify-between"><span className="text-info">{event.type}</span><time className="text-fg-faint">{new Date(event.at).toLocaleTimeString()}</time></div>
            <pre className="mt-1 whitespace-pre-wrap text-[11px] text-danger">{String(event.payload.error ?? JSON.stringify(event.payload))}</pre>
          </div>)}
          {errorArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} onOpen={() => setViewedArtifact(artifact)} />)}
        </> : <Notice>Ошибок на шаге нет.</Notice>}
      </div> : null}
      {section === "decision" && pending ? <DecisionPanel pending={pending} artifacts={detail?.artifacts ?? []} privacyFull={Boolean(fullContent)} runInput={runInput} action={action} /> : null}
      {section !== "data" && section !== "decision" ? (step
        ? <RunStepSection view={section} node={step} events={detail?.events ?? []} attempts={detail?.attempts ?? []} />
        : <Notice>Шага нет в snapshot прогона.</Notice>) : null}
      {section === "data" && activeDataTab === "tools" ? <div className="space-y-2">
        {toolCalls.length ? toolCalls.map((event) => {
          const status = String(event.payload.status ?? "ok");
          return <div key={event.id} className="rounded border border-line bg-surface p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={status === "ok" ? "emerald" : status === "blocked" ? "amber" : "red"} mono>{String(event.payload.tool ?? "")}</Chip>
              <span className="text-fg-muted">{status === "ok" ? "выполнено" : status === "blocked" ? "отклонено политикой" : "ошибка"}</span>
              <span className="text-fg-faint">{Number(event.payload.durationMs ?? 0)} мс · {Number(event.payload.size ?? 0)} B</span>
              <time className="ml-auto text-fg-faint">{new Date(event.at).toLocaleTimeString()}</time>
            </div>
            {event.payload.args ? <pre className="mt-1 whitespace-pre-wrap text-[10px] text-fg-muted">{String(event.payload.args)}</pre> : null}
            {event.payload.error ? <pre className="mt-1 whitespace-pre-wrap text-[11px] text-danger">{String(event.payload.error)}</pre> : null}
          </div>;
        }) : <Notice>Вызовов инструментов на шаге нет: цикл доступен у provider-кандидатов шагов.</Notice>}
      </div> : null}
      {section === "data" && activeDataTab === "artifacts" ? <div className="space-y-2">
        {visibleArtifacts.length ? <>
          {visibleArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} onOpen={() => setViewedArtifact(artifact)} />)}
        </> : <Notice>Артефактов на шаге нет.</Notice>}
      </div> : null}
      {section === "data" && activeDataTab === "stats" ? <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-xs font-semibold">Токены</div>
            <div className="mt-1 font-mono text-sm">{tokensTotal.toLocaleString("ru-RU")}</div>
            <div className="text-[11px] text-fg-muted">вход: {tokens.input.toLocaleString("ru-RU")} · выход: {tokens.output.toLocaleString("ru-RU")}</div>
            <div className="text-[11px] text-fg-muted">кеш: {tokens.cache.toLocaleString("ru-RU")}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-xs font-semibold">Стоимость</div>
            <div className="mt-1 font-mono text-sm">{pricedAttempts ? costTotal.toFixed(4) + " " + (costCurrencies.join(", ") || "USD") : "н/д"}</div>
            <div className="text-[11px] text-fg-muted">{pricedAttempts === (detail?.attempts.length ?? 0) ? "все попытки оценены по price card" : pricedAttempts ? "оценены попыток: " + pricedAttempts + " из " + (detail?.attempts.length ?? 0) : "прайс card рантайма не подтверждён"}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-xs font-semibold">Исполнение</div>
            <div className="mt-1 font-mono text-sm">{tier ?? "tier: не задан"}</div>
            <div className="text-[11px] text-fg-muted">effort: {effort ?? "не задан (наследуется: шаг → роль → medium)"}</div>
            <div className="text-[11px] text-fg-muted">попыток: {(detail?.attempts.length ?? 0)}, успешных: {(detail?.attempts ?? []).filter((attempt) => attempt.status === "completed").length}</div>
          </div>
        </div>
        <section>
          <h3 className="mb-1 text-xs font-semibold">Runtime, провайдер и модели шага</h3>
          {runtimeRows.size ? <div className="space-y-1">{[...runtimeRows.values()].map((row) => <div key={row.runtime + "|" + row.model} className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface px-2 py-1.5 text-[11px]">
            <span className="font-mono text-fg">{row.runtime}</span>
            <span className="text-fg-muted">{row.model}</span>
            <span className="ml-auto font-mono text-fg-faint">вызовов: {row.calls} (успешных: {row.completed})</span>
            <span className="font-mono text-fg-faint">вход {row.input.toLocaleString("ru-RU")} · выход {row.output.toLocaleString("ru-RU")} · кеш {row.cache.toLocaleString("ru-RU")}</span>
            {row.cost ? <span className="font-mono text-fg-faint">{row.cost.toFixed(4)} {costCurrencies.join(", ") || "USD"}</span> : null}
          </div>)}</div>
            : null}
          {!runtimeRows.size ? <Notice>Попыток на шаге нет.</Notice> : null}
          <Footnote className="mt-1">Провайдер совпадает с runtime: вызовы шага идут через CLI-рантаймы; модель - tier из snapshot прогона.</Footnote>
        </section>
        <section>
          <h3 className="mb-1 text-xs font-semibold">Служебные маркеры циклов и счётчики</h3>
          {markerGroups.size ? <div className="grid gap-2 sm:grid-cols-3">{[...markerGroups.entries()].map(([prefix, group]) => <button key={prefix} type="button" onClick={() => setViewedGroup({ prefix, group })} className="cursor-pointer rounded-xl border border-line bg-surface p-2 text-left transition-colors hover:border-info/50">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-fg-muted">{MARKER_LABELS[prefix] ?? prefix}</span>
              <span className="font-mono text-sm">{group.length}</span>
            </div>
          </button>)}</div>
            : <Notice>Служебных маркеров на шаге нет.</Notice>}
          <Footnote className="mt-1">Нажмите на счётчик, чтобы увидеть состав маркеров; содержимое открывается кликом по имени с учётом приватности.</Footnote>
        </section>
      </div> : null}
      {section === "data" && activeDataTab === "agents" ? <div className="space-y-2">
        {agents.length ? <div className="flex flex-wrap gap-1">{agents.map((agent) => <div key={agent.id} className="rounded border border-line bg-surface px-2 py-1 text-[10px]"><div className="font-mono">{agent.id}</div>{agent.parent ? <div className="text-fg-faint">↳ {agent.parent}</div> : null}</div>)}</div>
          : <Notice>Агентов на шаге нет.</Notice>}
      </div> : null}
    </div>
    {viewedGroup ? <MarkerGroupModal prefix={viewedGroup.prefix} group={viewedGroup.group} onClose={() => setViewedGroup(null)} onOpenArtifact={setViewedArtifact} /> : null}
    {viewedArtifact ? <ArtifactModal artifact={viewedArtifact} fullContent={Boolean(fullContent)} onClose={() => setViewedArtifact(null)} /> : null}
  </section>;
}

function MarkerGroupModal({ prefix, group, onClose, onOpenArtifact }: { prefix: string; group: StepArtifact[]; onClose: () => void; onOpenArtifact: (artifact: StepArtifact) => void }) {
  return <Modal
    open
    onClose={onClose}
    width="max-w-2xl"
    title={MARKER_LABELS[prefix] ?? prefix}
    description={"Маркеров: " + group.length}
    footer={<Button onClick={onClose}>Закрыть</Button>}
  >
    <VirtualList
      items={group}
      itemHeight={40}
      height={420}
      keyOf={(artifact) => artifact.id}
      ariaLabel={"Маркеры группы: " + (MARKER_LABELS[prefix] ?? prefix)}
      empty={<Notice>Маркеров нет.</Notice>}
      renderRow={(artifact) => <div className="h-full overflow-hidden"><ArtifactRow artifact={artifact} onOpen={() => onOpenArtifact(artifact)} /></div>}
    />
    <Footnote className="mt-2">Нажмите на маркер, чтобы открыть содержимое с учётом режима приватности.</Footnote>
  </Modal>;
}

function ArtifactRow({ artifact, onOpen }: { artifact: StepArtifact; onOpen: () => void }) {
  const text = isTextArtifact(artifact);
  const body = <div className="flex flex-wrap items-center gap-2">
    <span className="font-mono text-fg-muted">{artifact.name}</span>
    {artifact.path ? <span className="font-mono text-[10px] text-fg-faint">{artifact.path}</span> : null}
    <span className="ml-auto font-mono text-[10px] text-fg-faint">{artifact.checksum.slice(0, 10)} · {artifact.size} Б</span>
  </div>;
  if (!text) {
    return <div className="rounded border border-line bg-surface p-2 text-xs">{body}{artifact.content != null ? <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap text-[10px] text-fg-faint">{artifact.content}</pre> : null}</div>;
  }
  return <button type="button" onClick={onOpen} className="block w-full cursor-pointer rounded border border-line bg-surface p-2 text-left text-xs transition-colors hover:border-info/50">{body}</button>;
}

function ArtifactModal({ artifact, fullContent, onClose }: { artifact: StepArtifact; fullContent: boolean; onClose: () => void }) {
  return <Modal
    open
    onClose={onClose}
    width="max-w-3xl"
    title={artifact.name}
    description={[artifact.path, artifact.checksum.slice(0, 10) + " · " + artifact.size + " Б"].filter(Boolean).join(" · ")}
    footer={<Button onClick={onClose}>Закрыть</Button>}
  >
    {artifact.content != null
      ? <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[10px] text-fg-faint">{artifact.content}</pre>
      : <Notice tone="info">Содержимое скрыто режимом приватности{fullContent ? "" : " (доступны размер и контрольная сумма)"}.</Notice>}
  </Modal>;
}

function InterruptPanel({ info, comment, setComment, answer, setAnswer, action }: {
  info: InterruptInfo;
  comment: string;
  setComment: (value: string) => void;
  answer: string;
  setAnswer: (value: string) => void;
  action: (name: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const attempts = info.attempts ? <Footnote>Попытки: {info.attempts.used ?? 0} из {info.attempts.maxAttempts ?? "?"}</Footnote> : null;
  if (info.kind === "plan-confirm") {
    return <div className="space-y-2">
      <Notice tone="info">Требуется подтверждение плана шага {info.stepId}: {info.title ?? ""}. Закрытие окна оставляет прогон на паузе; карточка подтверждения доступна на доске задач.</Notice>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[11px]">{info.plan ?? ""}</pre>
      {attempts}
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Комментарий для отклонения плана (обязателен)" className="w-full" />
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => action("confirm-plan", { decision: "approve" })}>Подтвердить план</Button>
        <Button variant="danger" disabled={!comment.trim()} onClick={() => action("confirm-plan", { decision: "reject", comment })}>Отклонить с комментарием</Button>
      </div>
    </div>;
  }
  if (info.kind === "acceptance") {
    return <div className="space-y-2">
      <Notice tone="info">Ручная приёмка шага {info.stepId}: {info.title ?? ""}. Отложить - пауза без расхода попыток.</Notice>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[11px]">{info.summary ?? ""}</pre>
      {info.criteria?.length ? <Checklist title="Критерии приёмки" items={info.criteria.map((item) => ({ criterion: item.criterion, status: item.status, note: item.note }))} /> : null}
      {attempts}
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Комментарий для отклонения (обязателен)" className="w-full" />
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => action("accept", { decision: "approve" })}>Принять</Button>
        <Button disabled={!comment.trim()} onClick={() => action("accept", { decision: "defer" })}>Отложить</Button>
        <Button variant="danger" disabled={!comment.trim()} onClick={() => action("accept", { decision: "reject", comment })}>Отклонить с комментарием</Button>
      </div>
    </div>;
  }
  if (info.kind === "input-rework") {
    return <div className="space-y-2">
      <Notice tone="info">Входной контроль вернул вход шага {info.stepId}: {info.title ?? ""} на доработку. Выберите вариант формулировки или перепишите задание сами.</Notice>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-page p-2 text-[11px]">{info.assignment ?? ""}</pre>
      {info.variants?.length ? <div className="space-y-1">
        <div className="text-xs font-semibold">Варианты входа от контролёра</div>
        {info.variants.map((variant, index) => <button key={index} type="button" onClick={() => setAnswer(variant.text)} className={`block w-full cursor-pointer rounded border p-2 text-left transition-colors hover:border-info/50 ${answer === variant.text ? "border-info/60 bg-raised" : "border-line bg-surface"}`}>
          <span className="text-xs font-semibold">{variant.label}</span>
          <p className="mt-0.5 text-[11px] text-fg-muted">{variant.text}</p>
        </button>)}
      </div> : null}
      {attempts}
      <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} placeholder="Улучшенный вход (обязателен): клик по варианту подставит его текст; текст можно отредактировать или переписать задание полностью" className="w-full" />
      <Button variant="primary" disabled={!answer.trim()} onClick={() => action("rework-input", { answer })}>Отправить на повторную проверку</Button>
    </div>;
  }
  return <Notice>Прогон ожидает решения оператора ({info.kind ?? "interrupt"}).</Notice>;
}

function LessonsModal({ open, lessons, auto, manual, tab, setTab, selected, setSelected, runtime, setRuntime, runtimeOptions, selectedCount, onClose, apply }: {
  open: boolean;
  lessons: LessonsProposal[];
  auto: LessonsProposal[];
  manual: LessonsProposal[];
  tab: "auto" | "manual";
  setTab: (tab: "auto" | "manual") => void;
  selected: Record<string, boolean>;
  setSelected: (next: Record<string, boolean>) => void;
  runtime: string;
  setRuntime: (value: string) => void;
  runtimeOptions: string[];
  selectedCount: number;
  onClose: () => void;
  apply: () => void;
}) {
  const list = tab === "auto" ? auto : manual;
  const autoSelected = auto.filter((item) => selected[item.target]).length;
  return <Modal
    open={open}
    onClose={onClose}
    width="max-w-3xl"
    title="Lessons learned: предложения обновления ролей и навыков"
    description="Обход ошибок и возвратов прогона. Отметьте изменения к применению; правки выполняет агент выбранного runtime."
    footer={<>
      <Select value={runtime} onChange={setRuntime} options={[{ value: "", label: "Runtime применения" }, ...runtimeOptions.map((id) => ({ value: id, label: id }))]} className="mr-auto w-48" />
      <span className="self-center text-xs text-fg-muted">Автоисправление: {autoSelected} из {auto.length}; ручное: {manual.length}; выбрано: {selectedCount}</span>
      <Button variant="primary" disabled={!selectedCount || !runtime} onClick={apply}>Применить выбранные</Button>
      <Button onClick={onClose}>Закрыть</Button>
    </>}
  >
    <Segmented
      className="mb-3 w-fit"
      ariaLabel="Категории предложений"
      value={tab}
      onChange={setTab}
      options={[
        { key: "auto", label: `Автоисправление (${auto.length})` },
        { key: "manual", label: `Ручное исправление (${manual.length})` },
      ]}
    />
    {tab === "manual" ? <Notice tone="info" className="mb-3">Ручные предложения требуют настроек, runtime или действий пользователя; применение отмеченных выполняет агент по инструкциям diff.</Notice> : null}
    <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
      {list.length ? list.map((item) => <label key={item.target} className="block cursor-pointer rounded-lg border border-line bg-page/60 p-2">
        <div className="flex items-start gap-2">
          <input type="checkbox" checked={Boolean(selected[item.target])} onChange={(e) => setSelected({ ...selected, [item.target]: e.target.checked })} className="mt-1" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">{item.title || item.target}</span><Chip tone="dim" mono>{item.kind}</Chip><Chip tone={item.category === "auto" ? "emerald" : "amber"}>{item.category === "auto" ? "авто" : "ручное"}</Chip></div>
            <div className="mt-1 font-mono text-[10px] text-fg-faint">{item.target}</div>
            {item.reason ? <p className="mt-1 text-[11px] text-fg-muted">{item.reason}</p> : null}
            {item.diff ? <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-surface p-1.5 text-[10px]">{item.diff}</pre> : null}
          </div>
        </div>
      </label>) : <Notice>Предложений в этой категории нет.</Notice>}
    </div>
    <Footnote className="mt-2">Всего предложений: {lessons.length}. Источник: файлы errors/ и returns/ папки задачи прогона.</Footnote>
  </Modal>;
}
