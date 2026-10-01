import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState } from "@/core/state";
import { buildDashboardData, loadVendorConfigs, probeRuntimes } from "@/core/registry";
import type { RuntimeAdapter } from "@/core/types";

const NOW = new Date("2026-09-30T12:00:00Z");

let root = "";

async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "console-test-"));
  const rt = join(dir, ".agents", "runtime");
  await mkdir(join(rt, "alpha"), { recursive: true });
  await mkdir(join(rt, "beta"), { recursive: true });
  await mkdir(join(rt, "broken"), { recursive: true });
  await writeFile(
    join(rt, "alpha", "config.json"),
    JSON.stringify({
      id: "alpha",
      vendorAdapter: ".alpha/settings.json",
      guard: { hooksSupport: "native" },
      capabilities: { subagentSpawn: "verified", resume: "unknown" },
      models: { fast: { model: "M1", thinkingLevel: "low", verified: true } },
      permissions: {
        filesystem: { read: true, write: true },
        git: { commit: true, push: false, forcePush: false },
        shell: "policy-guarded",
      },
    }),
  );
  await writeFile(join(rt, "beta", "config.json"), JSON.stringify({ id: "beta", vendorAdapter: ".beta/hooks.json" }));
  await writeFile(join(rt, "broken", "config.json"), "{ не json");
  await mkdir(join(dir, ".mimosa", "hook-status"), { recursive: true });
  await writeFile(join(dir, ".mimosa", "hook-status", "sess_x.json"), "{}");
  return dir;
}

beforeAll(async () => {
  root = await makeFixture();
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("loadVendorConfigs", () => {
  test("обнаруживает валидные конфиги и пропускает повреждённые", async () => {
    const configs = await loadVendorConfigs(root);
    expect(configs.map((c) => c.id)).toEqual(["alpha", "beta"]);
  });

  test("несуществующий корень → пустой список", async () => {
    expect(await loadVendorConfigs(join(root, "nope"))).toEqual([]);
  });
});

describe("probeRuntimes", () => {
  test("адаптер даёт active-now, отсутствие адаптера - unknown", async () => {
    const adapters: Record<string, RuntimeAdapter> = {
      alpha: {
        id: "alpha",
        displayName: "Alpha Runtime",
        async probeSignals() {
          return [{ at: new Date(NOW.getTime() - 60_000), scope: "repo", source: "fixture.jsonl" }];
        },
      },
    };
    const snapshots = await probeRuntimes({ repoRoot: root, state: defaultState(root), adapters, now: NOW });
    const byId = Object.fromEntries(snapshots.map((s) => [s.id, s]));
    expect(byId.alpha.status).toBe("active-now");
    expect(byId.alpha.displayName).toBe("Alpha Runtime");
    expect(byId.alpha.adapterKind).toBe("signals");
    expect(byId.beta.status).toBe("unknown");
    expect(byId.beta.adapterKind).toBe("generic");
    expect(snapshots[0].id).toBe("alpha");
  });

  test("vendor-карточка урезана до UI-полей", async () => {
    const snapshots = await probeRuntimes({ repoRoot: root, state: defaultState(root), adapters: {}, now: NOW });
    const alpha = snapshots.find((s) => s.id === "alpha");
    expect(alpha?.vendor?.hooksSupport).toBe("native");
    expect(alpha?.vendor?.models).toEqual([{ tier: "fast", model: "M1", thinkingLevel: "low", verified: true }]);
    expect(alpha?.vendor?.permissions.gitPush).toBe(false);
    expect(alpha?.vendor?.capabilities).toEqual({ subagentSpawn: "verified", resume: "unknown" });
  });

  test("ошибка probeSignals не приводит к сбою дашборда", async () => {
    const adapters: Record<string, RuntimeAdapter> = {
      alpha: {
        id: "alpha",
        displayName: "Alpha Runtime",
        probeSignals: async () => {
          throw new Error("boom");
        },
      },
    };
    const snapshots = await probeRuntimes({ repoRoot: root, state: defaultState(root), adapters, now: NOW });
    const alpha = snapshots.find((s) => s.id === "alpha");
    expect(alpha?.status).toBe("unknown");
    expect(alpha?.probeError).toBe("boom");
  });

  test("неустановленный рантайм → disabled без провба сигналов", async () => {
    let probed = false;
    const adapters: Record<string, RuntimeAdapter> = {
      alpha: {
        id: "alpha",
        displayName: "Alpha Runtime",
        isInstalled: async () => false,
        probeSignals: async () => {
          probed = true;
          return [{ at: new Date(NOW.getTime() - 60_000), scope: "repo", source: "x" }];
        },
      },
    };
    const snapshots = await probeRuntimes({ repoRoot: root, state: defaultState(root), adapters, now: NOW });
    const alpha = snapshots.find((s) => s.id === "alpha");
    expect(alpha?.status).toBe("disabled");
    expect(alpha?.signals).toEqual([]);
    expect(probed).toBe(false);
    // disabled сортируется перед unknown (нет адаптера)
    expect(snapshots.map((s) => s.id)).toEqual(["alpha", "beta"]);
  });

  test("buildDashboardData собирает полный DTO с guard-активностью", async () => {
    const data = await buildDashboardData({ repoRoot: root, state: defaultState(root), adapters: {}, now: NOW });
    expect(data.generatedAt).toBe(NOW.toISOString());
    expect(data.runtimes.map((r) => r.id)).toEqual(["alpha", "beta"]);
    expect(data.guardActivity?.source).toContain("hook-status");
  });
});
