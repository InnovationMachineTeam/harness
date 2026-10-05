import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { ConsoleState } from "./state";
import { isActiveProvider, providerBaseUrlError, providerPresetById, type ProviderEntry, type ProviderPreset, type VerifyKind } from "./providers";
import { readProviderEntry } from "./providerSettings";
import { resolveProviderToken, withProviderAuth, type ResolvedProviderAuth } from "./providerAuth";
import { appendUsageRecords, type UsageRecord } from "./providerUsage";
import { finishTaskMeta, saveTaskMeta, taskTitle, type TaskLaunchInfo } from "./tasks";

/**
 * Запуск промта через LLM-провайдера из реестра консоли (задачи "Исполнение
 * команд" и "Создание навыка" со значением "provider:<id>"). Запрос к API
 * выполняется в фоновой задаче того же процесса (без дочерних процессов и
 * оболочки); текст ответа и ошибки пишутся в лог-файл в общем каталоге
 * логов .agents/console/runs/. Usage ответа попадает в статистику токенов
 * (core/providerUsage.ts).
 */

export interface ProviderRunResult {
  ok: boolean;
  runtime: string;
  logFile: string;
  detail: string;
}

/** Таймаут запроса к провайдеру: генерация ответа может занимать минуты. */
const REQUEST_TIMEOUT_MS = 300_000;

/** Тело запроса и URL по kind пресета; тело собирается JSON.stringify. */
function requestPlan(
  preset: ProviderPreset,
  model: string,
  prompt: string,
  token: string,
  baseUrl: string,
): { url: string; headers: Record<string, string>; body: string } {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (preset.verify.kind === "anthropic") {
    return {
      url: `${base}/messages`,
      headers: { ...headers, "x-api-key": token, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 8192, messages: [{ role: "user", content: prompt }] }),
    };
  }
  if (preset.verify.kind === "gemini") {
    return {
      url: `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(token)}`,
      headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    };
  }
  return {
    url: `${base}/chat/completions`,
    headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  };
}

/** Извлечение текста ответа по kind пресета (белый список форматов). */
function extractAnswer(preset: ProviderPreset, json: unknown): string {
  const root = json as Record<string, unknown> | null;
  if (preset.verify.kind === "anthropic") {
    const content = Array.isArray(root?.content) ? root.content : [];
    return content.map((p) => (p as { text?: string })?.text ?? "").join("");
  }
  if (preset.verify.kind === "gemini") {
    const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
    const parts = candidates[0] ? (candidates[0] as { content?: { parts?: { text?: string }[] } }).content?.parts : [];
    return (parts ?? []).map((p) => p?.text ?? "").join("");
  }
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const message = choices[0] ? (choices[0] as { message?: { content?: string } }).message : undefined;
  return message?.content ?? "";
}

/** Usage ответа по kind пресета; null - в ответе нет счётчиков токенов. */
export function extractUsage(kind: VerifyKind, json: unknown): Omit<UsageRecord, "at" | "source" | "provider"> | null {
  const root = json as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return null;
  const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const usage = root.usage as Record<string, unknown> | undefined;
  const build = (input: number, output: number, total: number, details: Record<string, number>) => {
    if (!input && !output && !total) return null;
    const meaningful = Object.fromEntries(Object.entries(details).filter(([, v]) => v > 0));
    return { inputTokens: input, outputTokens: output, totalTokens: total || input + output, details: Object.keys(meaningful).length ? meaningful : undefined };
  };
  if (kind === "gemini") {
    const meta = root.usageMetadata as Record<string, unknown> | undefined;
    if (!meta || typeof meta !== "object") return null;
    return build(num(meta.promptTokenCount), num(meta.candidatesTokenCount), num(meta.totalTokenCount), {
      thoughtsTokenCount: num(meta.thoughtsTokenCount),
    });
  }
  if (!usage || typeof usage !== "object") return null;
  if (kind === "anthropic") {
    return build(num(usage.input_tokens), num(usage.output_tokens), 0, {
      cacheReadInputTokens: num(usage.cache_read_input_tokens),
      cacheCreationInputTokens: num(usage.cache_creation_input_tokens),
    });
  }
  // OpenAI-совместимые (включая GigaChat с precached_prompt_tokens)
  return build(num(usage.prompt_tokens), num(usage.completion_tokens), num(usage.total_tokens), {
    precachedPromptTokens: num(usage.precached_prompt_tokens),
  });
}

/**
 * Один запрос к провайдеру: auth, запрос по kind пресета, извлечение текста
 * ответа. Ошибки сети, HTTP и формата возвращаются значением, функция не бросает.
 */
export async function executeProviderRequest(opts: {
  preset: ProviderPreset;
  providerId: string;
  model: string;
  prompt: string;
  entry: ProviderEntry;
  baseUrl: string;
}): Promise<{ ok: true; text: string; json: unknown } | { ok: false; error: string }> {
  const { preset, providerId, model, prompt, entry, baseUrl } = opts;
  try {
    const outcome = await withProviderAuth(
      preset,
      entry,
      async (auth: ResolvedProviderAuth) => {
        const plan = requestPlan(preset, model, prompt, auth.token, baseUrl);
        return auth.fetch(plan.url, {
          method: "POST",
          headers: plan.headers,
          body: plan.body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      },
      (res) => res.status === 401,
    );
    if (!outcome.ok) {
      return { ok: false, error: outcome.error };
    }
    const res = outcome.value;
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 4000)}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: text.slice(0, 4000) || "пустой ответ провайдера" };
    }
    return { ok: true, text: extractAnswer(preset, json), json };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `соединение не удалось: ${message}` };
  }
}

/**
 * Фоновая задача: один запрос к провайдеру, результат - в лог-файл.
 * Ошибки сети и HTTP пишутся в тот же лог; задача никогда не бросает.
 */
async function runProviderRequest(opts: {
  repoRoot: string;
  preset: ProviderPreset;
  providerId: string;
  model: string;
  prompt: string;
  entry: ProviderEntry;
  baseUrl: string;
  taskKind: string;
  logFile: string;
  taskId: string;
}): Promise<void> {
  const { repoRoot, preset, providerId, model, prompt, entry, baseUrl, taskKind, logFile, taskId } = opts;
  const result = await executeProviderRequest({ preset, providerId, model, prompt, entry, baseUrl });
  if (!result.ok) {
    await appendFile(logFile, `${result.error}\n`, "utf8");
    await finishTaskMeta(repoRoot, taskId, "failed");
    return;
  }
  await appendFile(logFile, `${result.text}\n`, "utf8");
  await finishTaskMeta(repoRoot, taskId, "completed");
  const usage = extractUsage(preset.verify.kind, result.json);
  if (usage) {
    const record: UsageRecord = { at: new Date().toISOString(), source: "provider-run", provider: providerId, model, kind: taskKind, ...usage };
    await appendUsageRecords(repoRoot, [record]).catch(() => undefined);
  }
}

/**
 * Запустить промт через провайдера. Провайдер должен существовать и быть
 * активным (проверка пройдена); иначе ok: false с причиной. Функция
 * возвращается сразу после старта фоновой задачи; ответ провайдера - в logFile.
 */
export async function launchProviderRun(opts: {
  repoRoot: string;
  state: ConsoleState;
  providerId: string;
  prompt: string;
  /** Вид задачи для статистики: "prompt-run" (по умолчанию) или "skill-create". */
  taskKind?: string;
}): Promise<ProviderRunResult> {
  const { repoRoot, state, providerId } = opts;
  const runtime = `provider:${providerId}`;
  const preset = providerPresetById(providerId);
  if (!preset) {
    return { ok: false, runtime, logFile: "", detail: `провайдер не найден в реестре: ${providerId}` };
  }
  // запись собирается из файлов настроек (.agents/providers/<id>/) и результата проверки
  const entry = await readProviderEntry(repoRoot, preset, state.providers?.entries?.[providerId] ?? null);
  if (!isActiveProvider(preset, entry)) {
    return {
      ok: false,
      runtime,
      logFile: "",
      detail: `провайдер ${preset.label} не активен - заполните поля и пройдите проверку на вкладке "Провайдеры"`,
    };
  }
  const model = entry.models.standard.trim();
  if (!model) {
    return { ok: false, runtime, logFile: "", detail: "у провайдера не задана модель standard" };
  }
  const baseUrlError = providerBaseUrlError(entry.baseUrl, preset.kind);
  if (baseUrlError) {
    return { ok: false, runtime, logFile: "", detail: baseUrlError };
  }
  // доступность ключа и CA-файла проверяется до старта фоновой задачи
  const precheck = await resolveProviderToken(preset, entry);
  if (!precheck.ok) {
    return { ok: false, runtime, logFile: "", detail: precheck.error };
  }

  const runsDir = path.join(repoRoot, ".agents", "console", "runs");
  await mkdir(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(runsDir, `${stamp}-provider-${providerId}.log`);
  const fh = await open(logFile, "a");
  await fh.close();

  // реестр задач: запрос выполняется в процессе консоли (pid нет) и
  // финализирует мету сам; после рестарта сервера мета станет interrupted
  const taskId = await saveTaskMeta(repoRoot, {
    kind: "prompt",
    title: taskTitle(opts.prompt),
    executor: { type: "provider", id: providerId },
    model,
    pid: null,
    sessionRuntime: null,
    logFile,
    detail: `задача: ${opts.taskKind}`,
  }).catch(() => "");

  void runProviderRequest({
    repoRoot,
    preset,
    providerId,
    model,
    prompt: opts.prompt.replace(/\0/g, " ").trim().slice(0, 32_000),
    entry,
    baseUrl: entry.baseUrl.trim(),
    taskKind: opts.taskKind ?? "prompt-run",
    logFile,
    taskId,
  });

  return {
    ok: true,
    runtime,
    logFile,
    detail: `промт отправлен провайдеру ${preset.label} (модель ${model}); ответ - в .agents/console/runs`,
  };
}
