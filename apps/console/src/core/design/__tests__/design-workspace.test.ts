import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presetById } from "@/lib/themes";
import { FRONT_MATTER_RE } from "@/lib/design-format";
import {
  createDesignPack,
  designPackPaths,
  loadDesignPack,
  registerWorkspaceKit,
  saveWorkspaceDesign,
  saveWorkspaceDesignGuide,
  scanWorkspaceComponents,
} from "@/core/design/workspace";
import { designSyncStatus, removeDesignContext, syncDesignContext } from "@/core/design/sync";

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "harness-design-"));
}

/** Корень этого репозитория: __tests__ → design → core → src → console → apps → корень. */
const repoRoot = join(import.meta.dir, "..", "..", "..", "..", "..", "..");

describe("design pack рабочей папки", () => {
  test("пустая папка: пакет отсутствует, exists=false", async () => {
    const dir = await tmpWorkspace();
    try {
      const pack = await loadDesignPack(dir);
      expect(pack.workspaceDir).toBe(dir);
      expect(pack.design.exists).toBe(false);
      expect(pack.uikit.exists).toBe(false);
      expect(pack.components.exists).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("создание из пресета themes/ пишет DESIGN.md, ui-kit.md и components.json; повтор - без overwrite запрещён", async () => {
    const dir = await tmpWorkspace();
    try {
      const first = await createDesignPack(repoRoot, dir, "dark-graphite.md");
      expect(first.ok).toBe(true);
      const pack = await loadDesignPack(dir);
      expect(pack.design.exists).toBe(true);
      expect(pack.design.name).toBe("Graphite");
      expect(pack.design.tokens?.colors.accent).toBe("#34d399");
      expect(pack.uikit.exists).toBe(true);
      expect(pack.brand.exists).toBe(true);
      expect(pack.brand.content).toContain("# Бренд");
      expect(pack.components.exists).toBe(true);
      expect(pack.design.lintErrors).toBe(0);

      const again = await createDesignPack(repoRoot, dir, "dark-nord.md");
      expect(again.ok).toBe(false);
      const forced = await createDesignPack(repoRoot, dir, "dark-nord.md", { overwrite: true });
      expect(forced.ok).toBe(true);
      const reloaded = await loadDesignPack(dir);
      expect(reloaded.design.name).toBe("Nord");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("saveWorkspaceDesign пересобирает front matter, тело сохраняется", async () => {
    const dir = await tmpWorkspace();
    try {
      const tokens = presetById("dracula")!.tokens;
      const result = await saveWorkspaceDesign(dir, tokens, "Моя тема");
      expect(result.ok).toBe(true);
      const content = await readFile(designPackPaths(dir).design, "utf8");
      expect(content).toContain("name: Dracula");
      expect(content).toContain("# Визуальная идентичность проекта");
      expect(content).toContain("#50fa7b");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("saveWorkspaceDesignGuide заменяет только тело, front matter остаётся; ошибка линта запрещает запись", async () => {
    const dir = await tmpWorkspace();
    try {
      const tokens = presetById("dracula")!.tokens;
      await saveWorkspaceDesign(dir, tokens, "Dracula");
      const before = await readFile(designPackPaths(dir).design, "utf8");
      const frontMatch = before.match(FRONT_MATTER_RE);
      expect(frontMatch).not.toBeNull();
      const front = frontMatch![0];

      const result = await saveWorkspaceDesignGuide(dir, "\n# Новый гайд\n\nПравила проекта.\n");
      expect(result.ok).toBe(true);
      const after = await readFile(designPackPaths(dir).design, "utf8");
      expect(after.startsWith(front)).toBe(true);
      expect(after).toContain("# Новый гайд");
      expect(after).not.toContain("# Визуальная идентичность проекта");

      const second = await saveWorkspaceDesignGuide(dir, "\nПравила проекта, вторая версия.\n");
      expect(second.ok).toBe(true);
      const secondContent = await readFile(designPackPaths(dir).design, "utf8");
      expect(secondContent.startsWith(front)).toBe(true);
      expect(secondContent).toContain("вторая версия");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("сканирование компонентов собирает PascalCase-файлы, компоненты-папки и mobile-каталоги", async () => {
    const dir = await tmpWorkspace();
    try {
      await mkdir(join(dir, "src", "components"), { recursive: true });
      await mkdir(join(dir, "src", "components", "mobile"), { recursive: true });
      await mkdir(join(dir, "src", "uikit", "components", "Panel"), { recursive: true });
      await writeFile(join(dir, "src", "components", "Button.tsx"), "export {}");
      await writeFile(join(dir, "src", "components", "helpers.ts"), "export {}");
      await writeFile(join(dir, "src", "components", "Button.test.tsx"), "export {}");
      await writeFile(join(dir, "src", "components", "mobile", "Card.tsx"), "export {}");
      await writeFile(join(dir, "src", "uikit", "components", "Panel", "index.tsx"), "export {}");
      const manifest = await scanWorkspaceComponents(dir);
      expect(manifest.web.map((item) => item.name)).toEqual(["Button", "Panel"]);
      expect(manifest.mobile.map((item) => item.name)).toEqual(["Card"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("registerWorkspaceKit регистрирует компоненты-папки кита и точку входа плоского layout", async () => {
    const dir = await tmpWorkspace();
    try {
      await createDesignPack(repoRoot, dir, "dark-graphite.md");
      await mkdir(join(dir, "src", "uikit", "components", "UIKit"), { recursive: true });
      await mkdir(join(dir, "src", "uikit", "components", "VirtualList"), { recursive: true });
      await writeFile(join(dir, "src", "uikit", "components", "UIKit", "index.tsx"), "export {}");
      await writeFile(join(dir, "src", "uikit", "components", "VirtualList", "index.tsx"), "export {}");
      await writeFile(join(dir, "src", "uikit", "components", "helpers.ts"), "export {}");

      const first = await registerWorkspaceKit(dir);
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.kitDir).toBe("src/uikit");
        expect(first.added.map((item) => item.name).sort()).toEqual(["UIKit", "VirtualList"]);
        expect(first.added.every((item) => item.path.startsWith("src/uikit/components/"))).toBe(true);
      }
      const again = await registerWorkspaceKit(dir);
      expect(again.ok).toBe(true);
      if (again.ok) {
        expect(again.added).toHaveLength(0);
        expect(again.manifest.web).toHaveLength(2);
      }

      const flat = await tmpWorkspace();
      try {
        await mkdir(join(flat, "uikit"), { recursive: true });
        await writeFile(join(flat, "uikit", "index.tsx"), "export {}");
        const result = await registerWorkspaceKit(flat);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.added.map((item) => item.name)).toEqual(["UIKit"]);
      } finally {
        await rm(flat, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("группа навыков design", () => {
  test("loadInternalSkills различает master и design", async () => {
    const { loadInternalSkills } = await import("@/core/workflows/catalog");
    const items = await loadInternalSkills(repoRoot);
    const impeccable = items.find((item) => item.value.id === "impeccable");
    const system = items.find((item) => item.value.id === "system-design");
    expect(impeccable?.group).toBe("design");
    expect(system?.group).toBe("master");
    expect(items.filter((item) => item.group === "design").length).toBeGreaterThan(5);
    // design-навыки привязаны к рантаймам и провайдеру манифестом
    for (const item of items.filter((entry) => entry.group === "design")) {
      expect(item.value.runtimes).toContain("provider");
      expect(item.value.runtimes.length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("синхронизация дизайн-контекста", () => {
  const mcpServers = {
    "open-design": { name: "open-design", enabled: true, transport: { type: "stdio" as const, command: "od", args: [] } },
    figma: { name: "figma", enabled: false, transport: { type: "http" as const, url: "https://mcp.figma.com/mcp" } },
  };

  test("sync пишет блоки в CLAUDE.md и AGENTS.md; повторная запись не дублирует; desync удаляет", async () => {
    const dir = await tmpWorkspace();
    try {
      await writeFile(join(dir, "AGENTS.md"), "# Инструкции проекта\n");
      const pack = await loadDesignPack(dir);
      const first = await syncDesignContext(dir, pack, mcpServers);
      expect(first.updated.sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
      expect(first.status.enabledMcp).toEqual(["open-design"]);
      expect(first.status.missingMcp).toEqual(["figma"]);

      const claude = await readFile(join(dir, "CLAUDE.md"), "utf8");
      expect(claude).toContain("<!-- harness-design:start -->");
      expect(claude).toContain("@DESIGN.md");
      expect(claude).toContain("@BRAND.md");
      const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
      expect(agents).toContain("# Инструкции проекта");
      expect(agents).toContain("harness-design");
      expect(agents).toContain("BRAND.md");
      expect(agents).toContain("Дизайн-MCP этого проекта: open-design");

      const second = await syncDesignContext(dir, pack, mcpServers);
      expect(second.updated).toEqual([]);
      const agentsAgain = await readFile(join(dir, "AGENTS.md"), "utf8");
      expect((agentsAgain.match(/harness-design:start/g) ?? []).length).toBe(1);

      const removed = await removeDesignContext(dir, mcpServers);
      expect(removed.removed.sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
      const status = await designSyncStatus(dir, mcpServers);
      expect(status.targets.every((target) => !target.synced)).toBe(true);
      expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Инструкции проекта\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
