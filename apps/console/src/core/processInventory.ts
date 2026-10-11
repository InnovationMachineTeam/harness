import { spawnSync } from "node:child_process";
import { listAllProcesses, type PsInfoFull } from "@/lib/signals/processes";
import { ADAPTERS } from "@/runtimes";
import { PROVIDER_PRESETS } from "./providers";
import { dashboardPort, managedDashboardPids } from "./dashboards";
import { TOOLS, type ToolDef } from "./tools";

/**
 * Единый список процессов, запущенных рантаймами, провайдерами, MCP-серверами
 * и инструментами (вкладка "Процессы" мониторинга). Классификация - чистые
 * функции над снимком `ps` (lib/signals/processes.ts); маркер "безопасно
 * остановить" ставится консервативно и всегда с причиной.
 */

export type ProcessSource = "runtime" | "mcp" | "tool" | "provider";

/** Почему процесс помечен "безопасно остановить". */
export type ProcessSafety = "none" | "duplicate" | "stale" | "orphan";

export interface InventoryProcess extends PsInfoFull {
  source: ProcessSource;
  /** id рантайма/инструмента/провайдера или имя MCP-сервера. */
  originId: string;
  /** Человекочитаемый ярлык источника. */
  originLabel: string;
  /** Автономный дашборд, запущенный консолью (порт из реестра TOOLS). */
  managedDashboard: boolean;
  /** Порт дашборда - только для managedDashboard. */
  port: number | null;
  safety: ProcessSafety;
  /** Причина маркера (для подсказки в интерфейсе). */
  safetyReason: string | null;
  /** uptime в секундах - для сортировки на клиенте. */
  uptimeSeconds: number;
}

export interface ProcessInventory {
  at: string;
  processes: InventoryProcess[];
  totals: {
    count: number;
    cpu: number;
    mem: number;
    /** Процессов с маркером "безопасно остановить". */
    safe: number;
    bySource: Record<ProcessSource, number>;
  };
}

/* ------------------------------- классификация ------------------------------ */

/** MCP-серверы: управляемые сигнатуры команд (mcpPreset плагинов инструментов). */
const MCP_SIGNATURES: { id: string; label: string; test: RegExp }[] = [
  { id: "serena", label: "Serena MCP", test: /(^|[/\s])serena(\s|$).*\bstart-mcp-server\b/s },
  { id: "qmd", label: "qmd MCP", test: /(^|[/\s])qmd(\s|$).*\bmcp\b/s },
  { id: "headroom", label: "Headroom MCP", test: /(^|[/\s])headroom(\s|$).*\bmcp\b/s },
  { id: "codegraph", label: "CodeGraph MCP", test: /tooling[/\\]mcp[/\\]codegraph(\.ts)?(\s|$)|(^|[/\s])codegraph(\s|$).*\bmcp\b/s },
  { id: "graphify", label: "Graphify MCP", test: /(^|[/\s])graphify(\s|$).*\bmcp\b/s },
  { id: "open-design", label: "Open Design MCP", test: /(^|[/\s])od(\s|$).*\bmcp\b/s },
];

/** Дополнительные детекты локальных провайдеров сверх binaries пресетов. */
const PROVIDER_EXTRA: Record<string, RegExp> = {
  // сервер LM Studio - приложение, а не CLI `lms` из пресета
  lmstudio: /LM Studio(\.app| Helper|\.app\/)/i,
};

/** Паттерн бинарника: отдельное слово пути/команды (не флаг и не расширение файла). */
function binPattern(bin: string): RegExp {
  const escaped = bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s/"])${escaped}(\\s|$|:|\\.ts|\\.js)`);
}

/**
 * Классификация одного процесса. Порядок правил: managed-дашборд консоли →
 * рантайм → MCP-сервер → локальный провайдер → CLI инструмента. null - процесс
 * не относится к консоли (в список не попадает).
 */
export function classifyProcess(info: PsInfoFull, managedPids: Map<number, string>): Omit<InventoryProcess, keyof PsInfoFull | "uptimeSeconds"> | null {
  // 1. Автономный дашборд, запущенный консолью (запись в dashboards.json).
  const managedToolId = managedPids.get(info.pid);
  if (managedToolId) {
    const def = TOOLS.find((t) => t.id === managedToolId);
    if (def) return managedEntry(def);
  }
  // 2. Процессы рантаймов.
  for (const adapter of Object.values(ADAPTERS)) {
    if (adapter.processPattern?.test(info.command)) {
      return { source: "runtime", originId: adapter.id, originLabel: adapter.displayName, managedDashboard: false, port: null, safety: "none", safetyReason: null };
    }
  }
  // 3. MCP-серверы.
  for (const sig of MCP_SIGNATURES) {
    if (sig.test.test(info.command)) {
      return { source: "mcp", originId: sig.id, originLabel: sig.label, managedDashboard: false, port: null, safety: "none", safetyReason: null };
    }
  }
  // 4. Локальные провайдеры (серверы инференса).
  for (const preset of PROVIDER_PRESETS) {
    const binaries = preset.local?.binaries ?? [];
    const extra = PROVIDER_EXTRA[preset.id];
    if (binaries.some((bin) => binPattern(bin).test(info.command)) || extra?.test(info.command)) {
      return { source: "provider", originId: preset.id, originLabel: preset.label, managedDashboard: false, port: null, safety: "none", safetyReason: null };
    }
  }
  // 5. CLI инструментов реестра.
  for (const def of TOOLS) {
    if (binPattern(def.bin).test(info.command)) {
      return { source: "tool", originId: def.id, originLabel: def.title, managedDashboard: false, port: null, safety: "none", safetyReason: null };
    }
  }
  return null;
}

function managedEntry(def: ToolDef): Omit<InventoryProcess, keyof PsInfoFull | "uptimeSeconds"> {
  const port = def.dashboard ? dashboardPort(def.dashboard.url) : null;
  return {
    source: "tool",
    originId: def.id,
    originLabel: `${def.title} · дашборд`,
    managedDashboard: true,
    port,
    safety: "none",
    safetyReason: null,
  };
}

/* ------------------------------ маркер безопасности ------------------------------ */

/** PID-ы, слушающие TCP-порт (lsof, LISTEN). Ошибка/пусто - пустое множество. */
export function portOwnerPids(port: number): Set<number> {
  try {
    const res = spawnSync("lsof", ["-tiTCP:" + String(port), "-sTCP:LISTEN"], { encoding: "utf8", timeout: 3000 });
    if (res.error || res.status !== 0) return new Set();
    return new Set(
      res.stdout
        .split("\n")
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
  } catch {
    return new Set();
  }
}

/**
 * "etime" из ps в секунды: "mm:ss", "hh:mm:ss", "dd-hh:mm:ss".
 * Неразбираемая строка - 0.
 */
export function parseEtimeSeconds(uptime: string): number {
  const m = uptime.trim().match(/^(?:(\d+)-)?(\d+):(\d+):(\d+)$|^(\d+):(\d+)$/);
  if (!m) return 0;
  if (m[5] !== undefined) return Number(m[5]) * 60 + Number(m[6]);
  const days = Number(m[1] ?? 0);
  return ((days * 24 + Number(m[2])) * 60 + Number(m[3])) * 60 + Number(m[4]);
}

/**
 * Маркер "безопасно остановить" - консервативные правила:
 * - duplicate: managed-дашборд, чей порт обслуживает другой процесс;
 * - stale: managed-дашборд, чей порт не принимает соединения;
 * - orphan: MCP-сервер, чей родитель (рантайм) завершился - ppid стал 1;
 * рантаймы и MCP-серверы с живым владельцем никогда не помечаются.
 */
export function markSafety(processes: InventoryProcess[], ownersByPort: Map<number, Set<number>>): void {
  for (const proc of processes) {
    if (proc.managedDashboard && proc.port !== null) {
      const owners = ownersByPort.get(proc.port) ?? new Set<number>();
      const other = [...owners].find((pid) => pid !== proc.pid);
      if (other !== undefined) {
        proc.safety = "duplicate";
        proc.safetyReason = `порт ${proc.port} обслуживает другой процесс (PID ${other})`;
      } else if (owners.size === 0) {
        proc.safety = "stale";
        proc.safetyReason = `порт ${proc.port} не принимает соединения - инстанс не обслуживает дашборд`;
      }
      continue;
    }
    if (proc.source === "mcp" && proc.ppid === 1) {
      proc.safety = "orphan";
      proc.safetyReason = "родительский рантайм завершился - сервер остался без владельца";
    }
  }
}

/* --------------------------------- сборка --------------------------------- */

function toInventory(info: PsInfoFull, managedPids: Map<number, string>): InventoryProcess | null {
  const classified = classifyProcess(info, managedPids);
  if (!classified) return null;
  return {
    ...info,
    ...classified,
    uptimeSeconds: parseEtimeSeconds(info.uptime),
  };
}

/** Снимок процессов консоли: классификация + маркеры безопасности. */
export async function buildProcessInventory(repoRoot: string): Promise<ProcessInventory> {
  const managedPids = await managedDashboardPids(repoRoot);

  const processes = listAllProcesses()
    .map((info) => toInventory(info, managedPids))
    .filter((p): p is InventoryProcess => p !== null);

  // lsof только для портов реально запущенных managed-дашбордов (максимум 3)
  const ownersByPort = new Map<number, Set<number>>();
  for (const proc of processes) {
    if (proc.managedDashboard && proc.port !== null && !ownersByPort.has(proc.port)) {
      ownersByPort.set(proc.port, portOwnerPids(proc.port));
    }
  }
  markSafety(processes, ownersByPort);

  const bySource: Record<ProcessSource, number> = { runtime: 0, mcp: 0, tool: 0, provider: 0 };
  for (const proc of processes) bySource[proc.source] += 1;
  return {
    at: new Date().toISOString(),
    processes,
    totals: {
      count: processes.length,
      cpu: Number(processes.reduce((s, p) => s + p.cpu, 0).toFixed(1)),
      mem: Number(processes.reduce((s, p) => s + p.mem, 0).toFixed(1)),
      safe: processes.filter((p) => p.safety !== "none").length,
      bySource,
    },
  };
}

/**
 * Предикат "PID относится к процессам консоли" для остановки: тот же
 * классификатор на свежем снимке ps исключает переиспользованный PID.
 */
export async function inventoryMatcher(repoRoot: string): Promise<(info: PsInfoFull) => boolean> {
  const managedPids = await managedDashboardPids(repoRoot);
  return (info) => classifyProcess(info, managedPids) !== null;
}
