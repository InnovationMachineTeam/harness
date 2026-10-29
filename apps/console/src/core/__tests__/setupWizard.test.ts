import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSystemInstallSteps,
  nodeMajor,
  sanitizeSystemTargets,
  setupGateRequired,
  type SetupSystemInfo,
} from "@/core/setupWizard";
import { normalizeSetupWizard } from "@/core/state";

/** Каталог состояния изолированно от HARNESS_CONSOLE_STATE окружения. */
async function makeRepo(): Promise<string> {
  const root = join(tmpdir(), `setup-wizard-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(join(root, ".agents", "console"), { recursive: true });
  return root;
}

const previousStateEnv = process.env.HARNESS_CONSOLE_STATE;

beforeEach(() => {
  // изоляция от override пути состояния в окружении
  delete process.env.HARNESS_CONSOLE_STATE;
});

afterEach(() => {
  // присваивание undefined превратило бы переменную в строку "undefined"
  if (previousStateEnv === undefined) delete process.env.HARNESS_CONSOLE_STATE;
  else process.env.HARNESS_CONSOLE_STATE = previousStateEnv;
});

describe("setupGateRequired", () => {
  test("файла состояния нет - новая установка, визард требуется", async () => {
    const root = await makeRepo();
    try {
      expect(setupGateRequired(root)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("файл есть без поля setupWizard (установка до появления визарда) - не требуется", async () => {
    const root = await makeRepo();
    try {
      await writeFile(join(root, ".agents", "console", "state.json"), JSON.stringify({ mcp: { servers: {} } }));
      expect(setupGateRequired(root)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("setupWizard.done=false - визард в процессе, требуется; done=true - не требуется", async () => {
    const root = await makeRepo();
    try {
      const file = join(root, ".agents", "console", "state.json");
      await writeFile(file, JSON.stringify({ setupWizard: { done: false, completedAt: null, skippedAt: null } }));
      expect(setupGateRequired(root)).toBe(true);
      await writeFile(file, JSON.stringify({ setupWizard: { done: true, completedAt: "2026-10-29T00:00:00.000Z", skippedAt: null } }));
      expect(setupGateRequired(root)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("битый state.json консоль не блокирует", async () => {
    const root = await makeRepo();
    try {
      await writeFile(join(root, ".agents", "console", "state.json"), "{bitый json");
      expect(setupGateRequired(root)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("normalizeSetupWizard", () => {
  test("поля нормализуются, лишние отбрасываются", () => {
    expect(normalizeSetupWizard({ done: true, completedAt: "t", skippedAt: null, extra: 1 })).toEqual({
      done: true,
      completedAt: "t",
      skippedAt: null,
    });
    expect(normalizeSetupWizard({})).toEqual({ done: false, completedAt: null, skippedAt: null });
  });

  test("не объект - null", () => {
    expect(normalizeSetupWizard(null)).toBeNull();
    expect(normalizeSetupWizard("да")).toBeNull();
    expect(normalizeSetupWizard(42)).toBeNull();
  });
});

describe("nodeMajor", () => {
  test("v-префикс, без префикса, мусор", () => {
    expect(nodeMajor("v22.4.0")).toBe(22);
    expect(nodeMajor("18.0.1")).toBe(18);
    expect(nodeMajor("vX")).toBe(0);
    expect(nodeMajor(null)).toBe(0);
  });
});

describe("sanitizeSystemTargets", () => {
  test("фильтр и канонический порядок", () => {
    expect(sanitizeSystemTargets(["workspace", "булка", "bun", "workspace"])).toEqual(["bun", "workspace"]);
    expect(sanitizeSystemTargets("bun")).toEqual([]);
    expect(sanitizeSystemTargets(undefined)).toEqual([]);
  });
});

const darwinBrew: SetupSystemInfo = { platform: "darwin", arch: "arm64", hasBrew: true, hasApt: false, hasPasswordlessSudo: false };
const darwinNoBrew: SetupSystemInfo = { platform: "darwin", arch: "arm64", hasBrew: false, hasApt: false, hasPasswordlessSudo: false };
const linux: SetupSystemInfo = { platform: "linux", arch: "x64", hasBrew: false, hasApt: true, hasPasswordlessSudo: false };

describe("buildSystemInstallSteps", () => {
  const repoRoot = "/repo";
  const noDeps = { bunInstalled: false, nodeInstalled: false, nodeVersion: null };
  const allDeps = { bunInstalled: true, nodeInstalled: true, nodeVersion: "v22.4.0" };

  test("macOS с brew: bun и node ставятся brew", () => {
    const built = buildSystemInstallSteps({ targets: ["bun", "node"], system: darwinBrew, repoRoot, deps: noDeps });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.steps.map((step) => step.command)).toEqual([["brew", "install", "bun"], ["brew", "install", "node"]]);
  });

  test("macOS без brew: отказ с подсказкой terminal-скрипта", () => {
    const built = buildSystemInstallSteps({ targets: ["bun"], system: darwinNoBrew, repoRoot, deps: noDeps });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toContain("bun run setup");
  });

  test("Linux: bun - инсталлер файлом в .agents/.tmp/setup; node - только через терминал", () => {
    const built = buildSystemInstallSteps({ targets: ["bun"], system: linux, repoRoot, deps: noDeps });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.steps.map((step) => step.command[0])).toEqual(["mkdir", "curl", "bash"]);
    const curlStep = built.steps[1];
    expect(curlStep.command[curlStep.command.length - 1]).toBe(join(repoRoot, ".agents", ".tmp", "setup", "bun-install.sh"));

    const nodeBuilt = buildSystemInstallSteps({ targets: ["node"], system: linux, repoRoot, deps: { bunInstalled: true, nodeInstalled: false, nodeVersion: null } });
    expect(nodeBuilt.ok).toBe(false);
    if (nodeBuilt.ok) return;
    expect(nodeBuilt.error).toContain("sudo");
  });

  test("устаревший node попадает в установку, достаточный - нет", () => {
    const old = buildSystemInstallSteps({
      targets: ["node"],
      system: darwinBrew,
      repoRoot,
      deps: { bunInstalled: true, nodeInstalled: true, nodeVersion: "v18.0.1" },
    });
    expect(old.ok).toBe(true);
    const fresh = buildSystemInstallSteps({ targets: ["node"], system: darwinBrew, repoRoot, deps: allDeps });
    expect(fresh.ok).toBe(false);
  });

  test("workspace: bun install в корне репозитория; без bun - отказ", () => {
    const withBun = buildSystemInstallSteps({
      targets: ["workspace"],
      system: darwinBrew,
      repoRoot,
      deps: { bunInstalled: true, nodeInstalled: true, nodeVersion: "v22.0.0" },
    });
    expect(withBun.ok).toBe(true);
    if (withBun.ok) {
      expect(withBun.steps).toHaveLength(1);
      expect(withBun.steps[0].command).toEqual(["bun", "install"]);
      expect(withBun.steps[0].cwd).toBe(repoRoot);
    }
    const withoutBun = buildSystemInstallSteps({
      targets: ["workspace"],
      system: darwinBrew,
      repoRoot,
      deps: { bunInstalled: false, nodeInstalled: true, nodeVersion: "v22.0.0" },
    });
    expect(withoutBun.ok).toBe(false);
  });

  test("устанавливать нечего - отказ", () => {
    const built = buildSystemInstallSteps({ targets: ["bun"], system: darwinBrew, repoRoot, deps: allDeps });
    expect(built.ok).toBe(false);
  });
});
