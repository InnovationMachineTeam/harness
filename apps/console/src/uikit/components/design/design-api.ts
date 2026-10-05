/**
 * Общие типы и хелпер запросов клиентских компонентов вкладки "Дизайн".
 */

export interface PackStatus {
  dir: string;
  pack: {
    design: { exists: boolean; name: string; tokens: import("@/lib/themes").ThemeTokens | null; content: string; lintErrors: number; lintWarnings: number };
    uikit: { exists: boolean; content: string };
    brand: { exists: boolean; content: string };
    components: { exists: boolean; manifest: { web: { name: string; path: string }[]; mobile: { name: string; path: string }[] } | null };
  };
  sync: { targets: { file: string; synced: boolean }[]; enabledMcp: string[]; missingMcp: string[] };
  providers: string[];
  router: { executor: string; designMcp: string[] };
  designTools: Record<string, { ready: boolean; detail: string }>;
}

export interface LintFinding {
  rule: string;
  severity: string;
  message: string;
}

/** POST JSON; не-2xx бросает ошибку с текстом из поля error. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok && json.error) throw new Error(json.error);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return json;
}
