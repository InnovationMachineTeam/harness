import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { classifyActivity, DEFAULT_RECENT_WINDOW_MS, STATUS_ORDER } from "@/core/activity";
import { sharedIssues } from "@/core/issues";
import { workspaceDirs, type ConsoleState } from "@/core/state";
import type {
  ActivitySignal,
  AwaitingInput,
  DashboardDataDTO,
  Issue,
  ProcessInfo,
  ProbeContext,
  RuntimeAdapter,
  RuntimeSnapshotDTO,
  VendorCard,
} from "@/core/types";
import { fsSignals } from "@/lib/signals/fs";
import { scanProcesses } from "@/lib/signals/processes";

/** Сырой vendor-конфиг из .agents/runtime/<vendor>/config.json (минимум полей, которые мы используем). */
export interface RuntimeVendorConfig {
  id?: string;
  vendorAdapter?: string;
  guard?: { command?: string; hooksSupport?: string; notes?: string; verifyCommand?: string };
  capabilities?: Record<string, string>;
  models?: Record<string, { model: string; label?: string; thinkingLevel?: string; verified?: boolean }>;
  permissions?: {
    filesystem?: { read?: boolean; write?: boolean };
    git?: { commit?: boolean; push?: boolean; forcePush?: boolean };
    shell?: string;
  };
}

const TIER_ORDER = ["fast", "standard", "strong", "subagents"];

/**
 * Дискавери доступных рантаймов: источник правды - сами каталоги
 * .agents/runtime/<vendor>/config.json. Новый рантайм, добавленный в harness,
 * появляется здесь автоматически (возможно, без актуальных сигналов).
 */
export async function loadVendorConfigs(repoRoot: string): Promise<RuntimeVendorConfig[]> {
  const runtimeDir = join(repoRoot, ".agents", "runtime");
  let entries;
  try {
    entries = await readdir(runtimeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const configs: RuntimeVendorConfig[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = join(runtimeDir, entry.name, "config.json");
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as RuntimeVendorConfig;
      if (!parsed?.id) continue;
      configs.push(parsed);
    } catch {
      // каталог без валидного config.json не является рантаймом
    }
  }
  configs.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
  return configs;
}

function toVendorCard(vendor: RuntimeVendorConfig): VendorCard {
  const models = Object.entries(vendor.models ?? {})
    .sort((a, b) => {
      const ai = TIER_ORDER.indexOf(a[0]);
      const bi = TIER_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0]);
    })
    .map(([tier, m]) => ({
      tier,
      model: m.model,
      thinkingLevel: m.thinkingLevel ?? "?",
      verified: m.verified === true,
    }));
  return {
    id: vendor.id ?? "?",
    vendorAdapter: vendor.vendorAdapter ?? "-",
    hooksSupport: vendor.guard?.hooksSupport ?? "?",
    capabilities: vendor.capabilities ?? {},
    models,
    permissions: {
      fsRead: vendor.permissions?.filesystem?.read,
      fsWrite: vendor.permissions?.filesystem?.write,
      gitCommit: vendor.permissions?.git?.commit,
      gitPush: vendor.permissions?.git?.push,
      gitForcePush: vendor.permissions?.git?.forcePush,
      shell: vendor.permissions?.shell,
    },
  };
}

export interface ProbeOptions {
  repoRoot: string;
  adapters: Record<string, RuntimeAdapter>;
  now?: Date;
  recentWindowMs?: number;
  /** Состояние консоли: рабочие папки, оверлеи навыков, ошибки MCP-синка. */
  state: ConsoleState;
  /** Проб только перечисленных рантаймов (страница space не пробит всех). */
  only?: string[];
}

/**
 * Проб всех обнаруженных рантаймов: карточка из vendor-конфига + актуальные сигналы
 * адаптера (если есть) + процессы. Ошибка адаптера не приводит к сбою дашборда - статус unknown.
 */
export async function probeRuntimes(options: ProbeOptions): Promise<RuntimeSnapshotDTO[]> {
  const { repoRoot, adapters, state, only } = options;
  const now = options.now ?? new Date();
  const recentWindowMs = options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const allVendors = await loadVendorConfigs(repoRoot);
  const vendors = only ? allVendors.filter((v) => only.includes(v.id ?? "")) : allVendors;
  const ctx: ProbeContext = {
    repoRoot,
    home: homedir(),
    fs: fsSignals,
    workspaces: workspaceDirs(state),
  };

  const snapshots = await Promise.all(
    vendors.map(async (vendor): Promise<RuntimeSnapshotDTO> => {
      const id = vendor.id ?? "?";
      const adapter = adapters[id];
      let signals: ActivitySignal[] = [];
      let processes: ProcessInfo[] = [];
      let probeError: string | undefined;
      let issues: Issue[] = [];
      let awaiting: AwaitingInput | null = null;

      // Неустановленный рантайм - disabled, актуальные сигналы и ps не проверяем.
      let installed = true;
      if (adapter?.isInstalled) {
        try {
          installed = await adapter.isInstalled(ctx);
        } catch {
          installed = true; // не смогли определить - не считаем отключённым
        }
      }

      if (!installed) {
        return {
          id,
          displayName: adapter?.displayName ?? id,
          adapterKind: adapter?.probeSignals ? "signals" : "generic",
          status: "disabled",
          vendor: toVendorCard(vendor),
          signals: [],
          processes: [],
          issues: [
            {
              severity: "info",
              title: "Рантайм не установлен на этой машине",
              hint: "Установите CLI/приложение рантайма, чтобы карточка ожила",
            },
          ],
          awaiting: null,
        };
      }

      if (adapter?.probeSignals) {
        try {
          signals = await adapter.probeSignals(ctx);
        } catch (err) {
          probeError = err instanceof Error ? err.message : String(err);
        }
      }
      if (adapter?.processPattern) {
        try {
          processes = await scanProcesses(adapter.processPattern);
        } catch {
          /* ps недоступен - просто без процессов */
        }
      }
      if (adapter?.detectIssues) {
        try {
          issues.push(...(await adapter.detectIssues(ctx)));
        } catch {
          /* диагностика не должна ронять проб */
        }
      }
      issues.push(...sharedIssues(vendor, state));
      if (adapter?.awaitingInput) {
        try {
          awaiting = await adapter.awaitingInput(ctx);
        } catch {
          awaiting = null;
        }
      }

      const status = !adapter
        ? "unknown"
        : probeError
          ? "unknown"
          : classifyActivity(signals, now, recentWindowMs).status;

      return {
        id,
        displayName: adapter?.displayName ?? id,
        adapterKind: adapter?.probeSignals ? "signals" : "generic",
        status,
        vendor: toVendorCard(vendor),
        signals: signals
          .slice()
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .map((s) => ({ ...s, at: s.at.toISOString() })),
        processes,
        issues,
        awaiting,
        probeError,
      };
    }),
  );

  return snapshots.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (b.signals[0]?.at ?? "").localeCompare(a.signals[0]?.at ?? ""),
  );
}

/** Guard-активность в репо (vendor-слепой признак: свежие записи в .mimosa/). */
export async function probeGuardActivity(repoRoot: string): Promise<{ at: string; source: string } | null> {
  const candidates = await Promise.all(
    ["hook-status", "hook-state"].map(async (sub) => {
      const newest = await fsSignals.newestMtime(join(repoRoot, ".mimosa", sub), {
        match: (name) => name.endsWith(".json"),
        maxDepth: 1,
      });
      return newest ? { ...newest, source: `.mimosa/${sub}/${newest.source}` } : null;
    }),
  );
  const best = candidates.reduce<{ at: Date; source: string } | null>(
    (acc, c) => (c && (!acc || c.at > acc.at) ? { at: c.at, source: c.source } : acc),
    null,
  );
  return best ? { at: best.at.toISOString(), source: best.source } : null;
}

/** Полный DTO дашборда - общий для RSC-страницы и /api/runtimes. */
export async function buildDashboardData(options: ProbeOptions): Promise<DashboardDataDTO> {
  const [runtimes, guardActivity] = await Promise.all([
    probeRuntimes(options),
    probeGuardActivity(options.repoRoot),
  ]);
  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    repoRoot: options.repoRoot,
    recentWindowMs: options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS,
    defaultRuntime: options.state.defaultRuntime ?? null,
    guardActivity,
    runtimes,
  };
}
