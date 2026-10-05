import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Локальная история Direct-чатов вкладки "Агент". Каждый чат - папка
 * .agents/console/direct/<id>/ с transcript'ом chat.json и пустыми папками
 * input/ и output/ (резерв под будущую загрузку и выдачу файлов). Каталог
 * .agents/ исключён из git - история остаётся машиной пользователя.
 */

export interface DirectChatMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface DirectChatMessage {
  id?: string;
  role: string;
  parts: Array<Record<string, unknown>>;
  metadata?: unknown;
}

export interface DirectChatRecord extends DirectChatMeta {
  messages: DirectChatMessage[];
  /** Время реплик, восстановленное вместе с чатом (id сообщения → штампы). */
  times: Record<string, { startedAt?: string; repliedAt?: string }>;
}

const CHAT_ID_RE = /^direct-[0-9a-zA-Z-]+$/;
const MAX_MESSAGES = 500;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function directChatsDir(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "direct");
}

function chatDir(repoRoot: string, id: string): string {
  return path.join(directChatsDir(repoRoot), id);
}

function newChatId(at = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `direct-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Первая строка первого сообщения пользователя - заголовок чата (до 100 символов). */
function chatTitle(messages: DirectChatMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const line = message.parts
      .filter((part) => part.type === "text")
      .map((part) => String((part as { text?: string }).text ?? ""))
      .join(" ")
      .trim()
      .split("\n", 1)[0] ?? "";
    return line.slice(0, 100) || "диалог";
  }
  return "диалог";
}

/** Сохранить чат (создание или перезапись); id без префикса direct- отвергается. */
export async function saveDirectChat(
  repoRoot: string,
  input: { id?: string; messages: DirectChatMessage[]; times?: DirectChatRecord["times"] },
): Promise<DirectChatRecord> {
  const id = input.id && CHAT_ID_RE.test(input.id) ? input.id : newChatId();
  const messages = input.messages.slice(-MAX_MESSAGES);
  const now = new Date().toISOString();
  let createdAt = now;
  if (input.id) {
    const existing = await readDirectChat(repoRoot, input.id);
    if (existing) createdAt = existing.createdAt;
  }
  const record: DirectChatRecord = {
    id,
    title: chatTitle(messages),
    createdAt,
    updatedAt: now,
    messageCount: messages.length,
    messages,
    times: input.times ?? {},
  };
  const dir = chatDir(repoRoot, id);
  await mkdir(path.join(dir, "input"), { recursive: true });
  await mkdir(path.join(dir, "output"), { recursive: true });
  const body = JSON.stringify(record, null, 2);
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("чат превышает лимит размера");
  const tmp = path.join(dir, "chat.json.tmp");
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path.join(dir, "chat.json"));
  return record;
}

/** Прочитать чат; null - нет такого или неверный id. */
export async function readDirectChat(repoRoot: string, id: string): Promise<DirectChatRecord | null> {
  if (!CHAT_ID_RE.test(id)) return null;
  try {
    const raw = JSON.parse(await readFile(path.join(chatDir(repoRoot, id), "chat.json"), "utf8")) as Partial<DirectChatRecord>;
    if (!Array.isArray(raw.messages)) return null;
    return {
      id: String(raw.id ?? id),
      title: String(raw.title ?? "диалог"),
      createdAt: String(raw.createdAt ?? ""),
      updatedAt: String(raw.updatedAt ?? ""),
      messageCount: raw.messages.length,
      messages: raw.messages as DirectChatMessage[],
      times: raw.times ?? {},
    };
  } catch {
    return null;
  }
}

/** Список чатов, свежие сверху. */
export async function listDirectChats(repoRoot: string): Promise<DirectChatMeta[]> {
  let names: string[];
  try {
    names = await readdir(directChatsDir(repoRoot));
  } catch {
    return [];
  }
  const chats: DirectChatMeta[] = [];
  for (const name of names) {
    if (!name.startsWith("direct-")) continue;
    const chat = await readDirectChat(repoRoot, name);
    if (chat) chats.push({ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messageCount });
  }
  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Объём вложений сессии (input/ и output/) - резерв под будущие файлы. */
export async function chatAttachmentsUsage(repoRoot: string, id: string): Promise<{ input: number; output: number }> {
  const usage = { input: 0, output: 0 };
  for (const kind of ["input", "output"] as const) {
    try {
      const files = await readdir(path.join(chatDir(repoRoot, id), kind));
      for (const file of files) {
        const info = await stat(path.join(chatDir(repoRoot, id), kind, file)).catch(() => null);
        if (info) usage[kind] += info.size;
      }
    } catch {
      /* папки нет - объём 0 */
    }
  }
  return usage;
}
