/**
 * Минимальный посекционный редактор TOML для управления `[mcp_servers.<name>]`
 * в ~/.codex/config.toml. Правит только наши секции, остальной файл не меняется.
 * Строки/массивы сериализуются через JSON - это валидный TOML-синтаксис.
 */

export interface TomlMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

const HEADER_RE = /^\s*\[\[?[^\]]*\]\]\s*$/;

function sectionRanges(lines: string[], name: string): Array<[number, number]> {
  const main = `[mcp_servers.${name}]`;
  const env = `[mcp_servers.${name}.env]`;
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed !== main && trimmed !== env) continue;
    let end = i + 1;
    while (end < lines.length && !HEADER_RE.test(lines[end])) end++;
    // забираем хвостовые пустые строки в удаляемый диапазон
    while (end < lines.length && lines[end].trim() === "" && !HEADER_RE.test(lines[end])) end++;
    ranges.push([i, end]);
    i = end - 1;
  }
  return ranges;
}

/** Удалить все секции [mcp_servers.<name>] (включая подсекцию .env). */
export function removeMcpSection(toml: string, name: string): string {
  const lines = toml.split("\n");
  for (const [start, end] of sectionRanges(lines, name).reverse()) {
    lines.splice(start, end - start);
  }
  return lines.join("\n");
}

function serializeEntry(name: string, entry: TomlMcpEntry): string {
  const out: string[] = [`[mcp_servers.${name}]`];
  if (entry.url !== undefined) {
    out.push(`url = ${JSON.stringify(entry.url)}`);
  } else {
    if (entry.command === undefined) throw new Error(`MCP ${name}: не задан command`);
    out.push(`command = ${JSON.stringify(entry.command)}`);
    if (entry.args?.length) out.push(`args = ${JSON.stringify(entry.args)}`);
  }
  const env = Object.entries(entry.env ?? {});
  if (env.length > 0) {
    out.push("", `[mcp_servers.${name}.env]`);
    for (const [key, value] of env) out.push(`${key} = ${JSON.stringify(value)}`);
  }
  return out.join("\n");
}

/** Заменить/добавить секцию [mcp_servers.<name>] с подсекцией .env. */
export function upsertMcpSection(toml: string, name: string, entry: TomlMcpEntry): string {
  const cleared = removeMcpSection(toml, name);
  const block = serializeEntry(name, entry);
  const base = cleared.replace(/\s*$/, "");
  return base.length === 0 ? `${block}\n` : `${base}\n\n${block}\n`;
}
