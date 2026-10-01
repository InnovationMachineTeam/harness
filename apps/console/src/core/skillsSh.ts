/**
 * Клиент реестра skills.sh: поиск по сайту/CLI, обогащение описанием и аудитом.
 *
 * Безопасность серверных запросов (SSRF): только http/https, hostname из
 * allowlist (skills.sh, github.com, deepwiki.com), запрет localhost/частных
 * адресов, таймауты. Публичный API skills.sh требует Vercel OIDC-токен -
 * поэтому описания собираются скрейпингом страниц-фолбэков.
 */

const ALLOWED_HOSTS = new Set(["skills.sh", "www.skills.sh", "github.com", "deepwiki.com", "www.deepwiki.com"]);

export interface ShSkill {
  id: string;
  slug?: string;
  name: string;
  source: string;
  installs?: number;
  url?: string;
}

export interface ShAudit {
  provider: string;
  status: "pass" | "warn" | "fail" | string;
  summary?: string;
  riskLevel?: string;
  auditedAt?: string;
}

export interface ShDetail {
  id: string;
  description?: string;
  descriptionSource?: "registry" | "skills.sh" | "github" | "deepwiki";
  audits: ShAudit[];
  url: string;
}

function assertSafeUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("только http/https");
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) throw new Error(`хост не разрешён: ${host}`);
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("частные адреса запрещены");
  }
}

async function apiGet(path: string): Promise<unknown> {
  const url = new URL(path, "https://skills.sh");
  assertSafeUrl(url);
  const headers: Record<string, string> = { accept: "application/json" };
  const token = process.env.VERCEL_OIDC_TOKEN ?? process.env.SKILLS_SH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!res.ok) throw new Error(`skills.sh ${res.status}`);
  return res.json();
}

/** Кеш поиска в памяти (TTL 60 c) - автодополнение не должно долбить API. */
const searchCache = new Map<string, { at: number; items: ShSkill[] }>();
const SEARCH_TTL_MS = 60_000;

export async function searchSkills(query: string): Promise<ShSkill[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const cached = searchCache.get(q);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.items;
  try {
    const json = (await apiGet(`/api/v1/skills/search?q=${encodeURIComponent(q)}&limit=8`)) as {
      data?: ShSkill[];
    };
    const items = (json.data ?? []).map((s) => ({ ...s, name: s.name || s.slug || s.id }));
    searchCache.set(q, { at: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}

/** Разные HTML-энтити в meta-описаниях. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Скачать страницу и вытащить og:description / meta description. */
async function fetchPageDescription(pageUrl: string): Promise<string | null> {
  try {
    const url = new URL(pageUrl);
    assertSafeUrl(url);
    const res = await fetch(url, {
      headers: { accept: "text/html", "user-agent": "agentic-os-console/0.1 (+skill descriptions)" },
      signal: AbortSignal.timeout(9_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);
    const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    const meta =
      og ??
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const text = meta ? decodeEntities(meta[1]) : null;
    return text && text.length > 20 ? text.slice(0, 700) : null;
  } catch {
    return null;
  }
}

/** source вида owner/repo (не домен) → страница репозитория GitHub. */
function githubSource(source: string): string | null {
  const m = source.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m || m[1].includes(".")) return null; // первый сегмент с точкой = домен (open.feishu.cn)
  return `https://github.com/${m[1]}/${m[2]}`;
}

const descCache = new Map<string, { at: number; value: string | null }>();
const DESC_TTL_MS = 5 * 60_000;

async function cachedFetchPageDescription(url: string): Promise<string | null> {
  const cached = descCache.get(url);
  if (cached && Date.now() - cached.at < DESC_TTL_MS) return cached.value;
  const value = await fetchPageDescription(url);
  descCache.set(url, { at: Date.now(), value });
  return value;
}

const detailCache = new Map<string, { at: number; item: ShDetail | null }>();
const DETAIL_TTL_MS = 5 * 60_000;

/**
 * Детали навыка: описание + аудит.
 * Цепочка описания: снапшот реестра (нужен токен) → страница навыка на
 * skills.sh → страница репозитория GitHub → DeepWiki. Если пусто - UI
 * показывает iframe со страницей навыка.
 */
export async function skillDetail(id: string): Promise<ShDetail | null> {
  const key = id.toLowerCase();
  if (!/^[A-Za-z0-9][A-Za-z0-9@/._-]{0,140}$/.test(key)) return null;
  const cached = detailCache.get(key);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.item;
  const item = await fetchDetail(key);
  detailCache.set(key, { at: Date.now(), item });
  return item;
}

async function fetchDetail(key: string): Promise<ShDetail | null> {
  // id: owner/repo@skill или owner@skill
  const at = key.lastIndexOf("@");
  const source = at > 0 ? key.slice(0, at) : key.split("/").slice(0, -1).join("/");
  const skillName = at > 0 ? key.slice(at + 1) : key.split("/").pop() ?? key;
  const skillPage = `https://skills.sh/${source}/${skillName}`;

  let description: string | undefined;
  let descriptionSource: ShDetail["descriptionSource"] | undefined;

  // 1) снапшот реестра (если есть OIDC-токен): SKILL.md из files
  try {
    const detail = (await apiGet(`/api/v1/skills/${source}/${skillName}`)) as {
      files?: { path: string; contents: string }[] | null;
    };
    const skillMd = detail.files?.find((f) => f.path.endsWith("SKILL.md"));
    if (skillMd) {
      description = firstParagraph(skillMd.contents);
      descriptionSource = "registry";
    }
  } catch {
    /* без токена закрыто - идём по страницам */
  }

  // 2) страница навыка на skills.sh (og:description)
  if (!description) {
    const fromPage = await cachedFetchPageDescription(skillPage);
    if (fromPage) {
      description = fromPage;
      descriptionSource = "skills.sh";
    }
  }

  // 3) страница репозитория GitHub
  const gh = githubSource(source);
  if (!description && gh) {
    const fromGh = await cachedFetchPageDescription(gh);
    if (fromGh) {
      description = fromGh;
      descriptionSource = "github";
    }
  }

  // 4) DeepWiki (документация репозитория)
  if (!description && gh) {
    const dw = await cachedFetchPageDescription(gh.replace("https://github.com/", "https://deepwiki.com/"));
    if (dw) {
      description = dw;
      descriptionSource = "deepwiki";
    }
  }

  // аудит (только при наличии токена; 404 - аудита ещё нет)
  let audits: ShAudit[] = [];
  try {
    const audit = (await apiGet(`/api/v1/skills/audit/${source}/${skillName}`)) as { audits?: ShAudit[] };
    audits = audit.audits ?? [];
  } catch {
    /* без токена/аудита - пусто */
  }

  if (description === undefined && audits.length === 0) {
    // описание всё равно отдаём с url - UI покажет iframe
    return { id: key, description: undefined, audits, url: skillPage };
  }
  return { id: key, description, descriptionSource, audits, url: skillPage };
}

/** Первая содержательная часть SKILL.md после frontmatter. */
export function firstParagraph(markdown: string): string | undefined {
  const withoutFrontmatter = markdown.replace(/^---[\s\S]*?---\s*/, "");
  for (const block of withoutFrontmatter.split(/\n\s*\n/)) {
    const text = block.replace(/[#>*`-]/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 30 && !/^name|description/i.test(text)) {
      return text.slice(0, 600);
    }
  }
  return undefined;
}
