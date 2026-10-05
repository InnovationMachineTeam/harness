"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CreditCard, FileUp, PlugZap, ShieldCheck, Star, Trash2, X } from "lucide-react";
import type { ModelTier, ProviderDTO } from "@/core/providers";
import { FALLBACK_PROVIDER_ID, MODEL_TIERS } from "@/core/providers";
import type { ModelPriceEntry, VendorBilling } from "@/core/pricingCatalog";
import type { BillingDeposit, BillingSelection } from "@/core/state";
import { relativeTime, formatTokens } from "@/lib/format";
import { useConsoleStore } from "@/store/console";
import { Button, Chip, confirmDialog, Footnote, FieldLabel, IconButton, Input, SectionLabel, Select } from "@/uikit";
import { ProviderBillingModal } from "@/uikit/components/pricing/ProviderBillingModal";

const STATUS_BADGE: Record<
  ProviderDTO["status"],
  { tone: "dashed" | "amber" | "red" | "emerald"; label: string; title?: string }
> = {
  "not-installed": { tone: "dashed", label: "не установлен", title: "бинарник локального сервиса не найден" },
  "not-running": { tone: "amber", label: "не запущен", title: "локальный сервис установлен, но endpoint не отвечает" },
  empty: { tone: "dashed", label: "не заполнен" },
  filled: { tone: "amber", label: "заполнен - нужна проверка" },
  error: { tone: "red", label: "проверка не пройдена" },
  active: { tone: "emerald", label: "активен" },
};

const TASK_LABELS: Record<string, string> = {
  promptExecution: "исполнение команд",
  skillCreation: "создание навыка",
};

interface ProviderForm {
  apiKey: string;
  baseUrl: string;
  models: Record<ModelTier, string>;
  authScope: string;
}

/** Начальная форма: собранная запись (файлы настроек) или значения пресета. */
function initialForm(provider: ProviderDTO): ProviderForm {
  const entry = provider.entry;
  return {
    apiKey: entry?.apiKey ?? "",
    baseUrl: entry?.baseUrl ?? provider.baseUrl,
    models: { ...(entry?.models ?? provider.presetModels) },
    authScope: entry?.authScope ?? provider.auth?.scopeDefault ?? "",
  };
}

function sameForm(form: ProviderForm, provider: ProviderDTO): boolean {
  const entry = provider.entry;
  if (!entry) {
    return (
      form.apiKey === "" &&
      form.baseUrl === provider.baseUrl &&
      MODEL_TIERS.every((t) => form.models[t] === provider.presetModels[t]) &&
      form.authScope === (provider.auth?.scopeDefault ?? "")
    );
  }
  return (
    form.apiKey === entry.apiKey &&
    form.baseUrl === entry.baseUrl &&
    MODEL_TIERS.every((t) => form.models[t] === entry.models[t]) &&
    form.authScope === (entry.authScope ?? "")
  );
}

/** Все поля заполнены - доступна кнопка проверки. */
function formComplete(provider: ProviderDTO, form: ProviderForm): boolean {
  if (provider.apiKeyEnv && !form.apiKey.trim()) return false;
  if (!form.baseUrl.trim()) return false;
  return MODEL_TIERS.every((t) => form.models[t].trim().length > 0);
}

/**
 * Карточка провайдера: пресет (онлайн/локально) с полями ключа, base URL и
 * моделей по tiers (как у рантаймов). Не заполненный провайдер выглядит
 * отключенным; у заполненного появляется кнопка проверки; проверенный -
 * активен и может экспортироваться в LangGraph.
 */
/** Сводка статистики токенов провайдера (GET /api/providers/usage). */
export interface ProviderUsageChip {
  tokens30d: number;
  calls: number;
}

/** Данные подписки/PAYG провайдера: срез каталога цен и текущий выбор (загружает ProvidersPanel). */
export interface ProviderBillingProps {
  vendor?: VendorBilling;
  selection: BillingSelection;
  deposits: BillingDeposit[];
  spent: number | null;
  /** Каталог моделей (models.json) для справочной таблицы цен в модалке. */
  catalogModels: Record<string, ModelPriceEntry>;
  onSaveSelection: (next: BillingSelection) => void;
  onSaveDeposits: (next: BillingDeposit[]) => void;
}

export function ProviderCard({
  provider,
  nowMs,
  usage,
  billing,
  onUpdate,
}: {
  provider: ProviderDTO;
  nowMs: number;
  usage?: ProviderUsageChip | null;
  billing?: ProviderBillingProps;
  onUpdate: (next: ProviderDTO) => void;
}) {
  const [form, setForm] = useState<ProviderForm>(() => initialForm(provider));
  const [busy, setBusy] = useState<"save" | "verify" | "export" | "clear" | "cert" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const defaultProvider = useConsoleStore((s) => s.defaultProvider);
  const setDefaultProvider = useConsoleStore((s) => s.setDefaultProvider);
  // эффективный дефолт: выбор пользователя (★) или Ollama (FALLBACK_PROVIDER_ID)
  const isDefault = (defaultProvider ?? FALLBACK_PROVIDER_ID) === provider.id;

  const toggleDefault = async () => {
    if (provider.status !== "active") return;
    const ok = await setDefaultProvider(isDefault ? null : provider.id);
    if (!ok) setError("не удалось сохранить провайдера по умолчанию");
  };

  useEffect(() => {
    setForm(initialForm(provider));
    setError(null);
    setNotice(null);
  }, [provider]);

  const dirty = !sameForm(form, provider);
  const complete = formComplete(provider, form);
  const status = STATUS_BADGE[provider.status];
  const localDown = provider.status === "not-installed" || provider.status === "not-running";
  const disabledLook = provider.status === "empty" || provider.status === "not-installed";
  const canVerify = !dirty && complete && !localDown;
  // незаполненный: подсветка фоном при наведении (ярким фоном + полная
  // непрозрачность), рамка не выделяется; неустановленный: при выборе поля
  // внутри карточки - та же подсветка и пунктирная рамка
  const emptyHover = provider.status === "empty" ? "hover:bg-raised hover:opacity-100" : "";
  const focusHighlight = provider.status === "not-installed"
    ? "focus-within:bg-raised focus-within:opacity-100 focus-within:border-accent/60"
    : "";

  const patch = (part: Partial<ProviderForm>) => setForm((v) => ({ ...v, ...part }));

  const call = async (init: RequestInit, busyKey: typeof busy) => {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/providers", init);
      const json = (await res.json()) as { provider?: ProviderDTO; error?: string };
      if (!res.ok) {
        setError(json.error ?? "действие не выполнено");
        return;
      }
      if (json.provider) onUpdate(json.provider);
      return json;
    } catch {
      setError("сеть недоступна - действие не выполнено");
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    call(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: provider.id,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl,
          models: form.models,
          authScope: form.authScope,
        }),
      },
      "save",
    );

  const verify = async () => {
    const json = await call(
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: provider.id, action: "verify" }) },
      "verify",
    );
    if (json && "ok" in json) {
      const result = json as { ok: boolean; models?: string[] };
      setNotice(
        result.ok
          ? `проверка пройдена${result.models?.length ? ` - доступно моделей: ${result.models.length}` : ""}`
          : null,
      );
    }
  };

  const exportLanggraph = () =>
    call(
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: provider.id, action: "export-langgraph" }) },
      "export",
    );

  const clear = async () => {
    if (!(await confirmDialog({ title: `Очистить ${provider.label}?`, message: "Ключ, модели и статус проверки будут удалены.", tone: "danger", confirmLabel: "Очистить" }))) {
      return;
    }
    await call(
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: provider.id, action: "clear" }) },
      "clear",
    );
  };

  // сертификат выбирается из файловой системы; сервер сохраняет его под
  // стандартным именем ca.pem в папке провайдера (.agents/providers/<id>/)
  const uploadCert = async (file: File) => {
    if (file.size > 64 * 1024) {
      setError("файл сертификата больше 64 КБ");
      return;
    }
    const content = await file.text();
    const json = await call(
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: provider.id, action: "upload-cert", content }),
      },
      "cert",
    );
    if (json && "ok" in json) setNotice("сертификат загружен: ca.pem");
  };

  const removeCert = () =>
    call(
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: provider.id, action: "remove-cert" }) },
      "cert",
    );

  const integration = (on: boolean, label: string, title: string) => (
    <Chip tone={on ? "emerald" : "dim"} title={title}>
      {on ? <Check size={10} aria-hidden className="mr-1 inline" /> : null}
      {label}
    </Chip>
  );

  return (
    <article
      className={`flex h-full flex-col gap-3 rounded-xl border bg-surface/60 p-4 transition-colors ${
        provider.status === "active" ? "border-accent/30" : "border-line"
      } ${disabledLook ? "border-dashed opacity-60" : ""} ${emptyHover} ${focusHighlight}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised font-mono text-sm font-semibold text-fg-muted">
            {provider.label.charAt(0)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-fg">{provider.label}</h2>
            <p className="truncate font-mono text-[11px] text-fg-faint">{provider.baseUrl}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          {billing && (billing.vendor?.plans.length || billing.vendor?.payg.available) ? (
            <IconButton
              icon={CreditCard}
              label={`Подписка и оплата ${provider.label}`}
              title={
                billing.selection.mode === "plan"
                  ? `выбран тариф: ${billing.vendor?.plans.find((p) => p.id === billing.selection.planId)?.name ?? billing.selection.planId}`
                  : billing.selection.mode === "payg"
                    ? "Pay as You Go: пополнения и расход"
                    : "подписка не выбрана (по умолчанию)"
              }
              variant="ghostDim"
              size="xs"
              onClick={() => setBillingOpen(true)}
            />
          ) : null}
          <button
            type="button"
            onClick={() => void toggleDefault()}
            disabled={provider.status !== "active"}
            aria-label={isDefault ? "убрать провайдера по умолчанию" : "назначить провайдером AI SDK по умолчанию"}
            title={
              provider.status !== "active"
                ? "по умолчанию может быть только активный провайдер"
                : isDefault
                  ? "провайдер AI SDK по умолчанию (★)"
                  : "назначить провайдером AI SDK по умолчанию"
            }
            className={`rounded p-1 ${provider.status !== "active" ? "cursor-not-allowed opacity-30" : "hover:bg-raised"} ${
              isDefault ? "text-warning" : "text-fg-faint"
            }`}
          >
            <Star size={14} aria-hidden fill={isDefault ? "currentColor" : "none"} />
          </button>
          <div className="flex flex-col items-end gap-0.5">
            <Chip tone={status.tone} title={status.title}>
              {status.label}
            </Chip>
            <Chip tone={provider.kind === "local" ? "neutral" : "sky"}>{provider.kind === "local" ? "локально" : "онлайн"}</Chip>
          </div>
        </div>
      </header>

      {provider.kind === "local" && provider.local ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Chip tone={provider.local.installed ? "emerald" : "red"} title="бинарник локального сервиса найден в PATH или в известном пути">
            {provider.local.installed ? "установлен" : "не установлен"}
          </Chip>
          <Chip tone={provider.local.running ? "emerald" : "amber"} title="endpoint локального сервиса отвечает">
            {provider.local.running ? "запущен" : "не запущен"}
          </Chip>
        </div>
      ) : null}

      <div className="space-y-2">
        {provider.apiKeyEnv ? (
          <div>
            <FieldLabel htmlFor={`key-${provider.id}`}>API-ключ (env {provider.apiKeyEnv})</FieldLabel>
            <Input
              id={`key-${provider.id}`}
              size="compact"
              type="password"
              value={form.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
              placeholder="ключ провайдера"
              className="mt-1 w-full font-mono"
              autoComplete="off"
            />
            {provider.auth?.hint ? <Footnote className="mt-1">{provider.auth.hint}</Footnote> : null}
          </div>
        ) : null}
        {provider.auth ? (
          <div>
            <FieldLabel htmlFor={`scope-${provider.id}`}>Scope обмена токена</FieldLabel>
            <Select
              id={`scope-${provider.id}`}
              size="sm"
              className="mt-1"
              value={form.authScope}
              options={provider.auth.scopeOptions.map((scope) => ({ value: scope, label: scope }))}
              onChange={(value) => patch({ authScope: value })}
              ariaLabel={`Scope обмена токена ${provider.label}`}
            />
          </div>
        ) : null}
        <div>
          <FieldLabel htmlFor={`url-${provider.id}`}>Base URL</FieldLabel>
          <Input
            id={`url-${provider.id}`}
            size="compact"
            value={form.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            placeholder={provider.baseUrl}
            className="mt-1 w-full font-mono"
          />
        </div>
        {provider.certRequired || provider.certHint || provider.certPresent ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Сертификат CA</FieldLabel>
              {provider.certPresent ? (
                <IconButton
                  icon={X}
                  label={`Удалить сертификат ${provider.label}`}
                  variant="ghostDim"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => void removeCert()}
                />
              ) : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".pem,.crt,.cer,application/x-x509-ca-cert"
              className="hidden"
              aria-label={`Файл сертификата CA ${provider.label}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadCert(file);
              }}
            />
            <Button
              variant="ghostDim"
              size="xs"
              disabled={busy !== null}
              title="выбрать PEM-файл сертификата; он сохранится под стандартным именем ca.pem в папке провайдера"
              onClick={() => fileInput.current?.click()}
            >
              {busy === "cert" ? "Сохранение…" : <><FileUp size={12} aria-hidden className="mr-1 inline" /> Загрузить PEM-файл</>}
            </Button>
            {provider.certPresent ? (
              <p className="text-[11px] text-fg-faint">сертификат загружен: ca.pem (запросы провайдера используют этот файл)</p>
            ) : provider.certRequired ? (
              <p className="text-[11px] leading-relaxed text-danger">
                сертификат не найден - без него запросы к API провайдера не проходят{provider.certHint ? `. ${provider.certHint}` : ""}
              </p>
            ) : (
              <Footnote>{provider.certHint ?? "сертификат не требуется"}</Footnote>
            )}
          </div>
        ) : null}
      </div>

      <section>
        <SectionLabel as="h3" className="mb-1">Модели по tiers</SectionLabel>
        <table className="w-full text-xs">
          <tbody>
            {MODEL_TIERS.map((tier) => (
              <tr key={tier} className="border-b border-line/60 last:border-0">
                <td className="w-20 whitespace-nowrap py-1 pr-2 align-middle font-mono text-[11px] text-fg-faint">{tier}</td>
                <td className="py-1">
                  <Input
                    size="compact"
                    value={form.models[tier]}
                    onChange={(e) => patch({ models: { ...form.models, [tier]: e.target.value } })}
                    placeholder={provider.presetModels[tier]}
                    aria-label={`модель ${tier} провайдера ${provider.label}`}
                    className="w-full font-mono"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {provider.entry?.verifyModels.length ? (
          <Footnote className="mt-1" >
            доступные модели: {provider.entry.verifyModels.slice(0, 6).join(", ")}
            {provider.entry.verifyModels.length > 6 ? " …" : ""}
          </Footnote>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="xs" disabled={!dirty || busy !== null} onClick={() => void save()}>
          {busy === "save" ? "Сохранение…" : "Сохранить"}
        </Button>
        {provider.status !== "empty" ? (
          <Button
            variant={provider.status === "active" ? "ghostDim" : "accent"}
            size="xs"
            disabled={!canVerify || busy !== null}
            title={
              provider.status === "not-installed"
                ? "локальный сервис не установлен"
                : provider.status === "not-running"
                  ? "локальный сервис не запущен - запустите его и обновите страницу"
                  : dirty
                    ? "сначала сохраните изменения"
                    : "проверить соединение с API провайдера"
            }
            onClick={() => void verify()}
          >
            {busy === "verify" ? "Проверка…" : provider.status === "active" ? "Проверить снова" : "Проверка"}
          </Button>
        ) : null}
        {provider.entry ? (
          <IconButton icon={Trash2} label={`Очистить ${provider.label}`} variant="ghostDim" size="xs" disabled={busy !== null} onClick={() => void clear()} />
        ) : null}
        {provider.status === "active" && provider.entry?.verifiedAt ? (
          <span className="text-[10px] text-fg-faint">проверен {relativeTime(provider.entry.verifiedAt, nowMs)}</span>
        ) : null}
      </div>

      {provider.entry?.verifyError ? (
        <p className="line-clamp-3 text-[11px] leading-relaxed text-danger" title={provider.entry.verifyError}>
          {provider.entry.verifyError}
        </p>
      ) : null}
      {error ? <p className="text-[11px] leading-relaxed text-danger">{error}</p> : null}
      {notice ? <p className="text-[11px] leading-relaxed text-accent">{notice}</p> : null}

      {billing ? (
        <ProviderBillingModal
          open={billingOpen}
          onClose={() => setBillingOpen(false)}
          providerId={provider.id}
          providerLabel={provider.label}
          vendor={billing.vendor}
          selection={billing.selection}
          deposits={billing.deposits}
          models={MODEL_TIERS.map((tier) => ({ tier, model: provider.entry?.models[tier] || provider.presetModels[tier] }))}
          catalogModels={billing.catalogModels}
          spent={billing.spent}
          onSaveSelection={billing.onSaveSelection}
          onSaveDeposits={billing.onSaveDeposits}
        />
      ) : null}

      {usage && usage.calls > 0 ? (
        <p className="text-[11px] text-fg-faint">токены за 30 дней: {formatTokens(usage.tokens30d)} · вызовов всего: {usage.calls}</p>
      ) : null}

      <section className="mt-auto border-t border-line/60 pt-2">
        <SectionLabel as="h3" className="mb-1">Интеграции</SectionLabel>
        <div className="flex flex-wrap items-center gap-1">
          {integration(provider.integrations.openwiki, "OpenWiki", provider.integrations.openwiki ? "LLM-провайдер сборки OpenWiki" : "в настройках OpenWiki выбран другой провайдер")}
          {integration(provider.integrations.graphify, "Graphify", provider.integrations.graphify ? "LLM-бэкенд сборки Graphify" : "в настройках Graphify выбран другой бэкенд")}
          {integration(provider.integrations.langgraph, "LangGraph", provider.integrations.langgraph ? "переменные экспортированы в .agents/console/langgraph.env" : "переменные окружения не экспортированы")}
          {provider.tasks.map((task) => (
            <Chip key={task} tone="sky" title={`назначен задаче "${TASK_LABELS[task] ?? task}"`}>
              {TASK_LABELS[task] ?? task}
            </Chip>
          ))}
        </div>
        {provider.langgraphSupported ? (
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              variant="ghostDim"
              size="xs"
              disabled={provider.status !== "active" || busy !== null}
              title={provider.status === "active" ? "записать ключ, base URL и модели в .agents/console/langgraph.env" : "экспорт доступен активному провайдеру"}
              onClick={() => void exportLanggraph()}
            >
              {busy === "export" ? <PlugZap size={12} aria-hidden className="animate-pulse" /> : <PlugZap size={12} aria-hidden />}
              Экспорт для LangGraph
            </Button>
            {provider.integrations.langgraph && provider.langgraphExportedAt ? (
              <span className="flex items-center gap-1 text-[10px] text-fg-faint">
                <ShieldCheck size={10} aria-hidden /> {relativeTime(provider.langgraphExportedAt, nowMs)}
              </span>
            ) : null}
          </div>
        ) : (
          <Footnote className="mt-1">экспорт для LangGraph не поддерживается: получатель .env не сможет обменять OAuth-ключ на токен</Footnote>
        )}
      </section>
    </article>
  );
}
