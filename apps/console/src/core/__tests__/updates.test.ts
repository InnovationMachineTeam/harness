import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyUpdateResults,
  buildUpdateSteps,
  latestFromGithubTag,
  latestFromNpmPayload,
  latestFromPypiPayload,
  parseBrewOutdated,
  parseUvToolList,
  readUpdateRegistry,
  syncUpdateRegistry,
  updateRegistryDTO,
  type UpdateTarget,
} from "@/core/updates";

function tmpRepo(): string {
  return mkdtempSync(path.join(tmpdir(), "updates-registry-"));
}

function target(overrides: Partial<UpdateTarget> = {}): UpdateTarget {
  return {
    id: "local:next",
    group: "local",
    kind: "bun",
    name: "next",
    currentVersion: "16.3.8",
    command: ["bun", "update", "--latest", "next"],
    cwd: "/repo",
    ...overrides,
  };
}

describe("parseUvToolList", () => {
  test("читает строки имя-версия и пропускает остальное", () => {
    const output = ["serena-agent v0.4.2", "- serena, serena-mcp-server", "", "headroom-ai v1.8.0"].join("\n");
    const parsed = parseUvToolList(output);
    expect(parsed.get("serena-agent")).toBe("0.4.2");
    expect(parsed.get("headroom-ai")).toBe("1.8.0");
    expect(parsed.size).toBe(2);
  });

  test("пустой вывод - пустая карта", () => {
    expect(parseUvToolList("").size).toBe(0);
  });
});

describe("parseBrewOutdated", () => {
  test("формулы и каски с current_version", () => {
    const payload = {
      formulae: [{ name: "rtk", installed_versions: ["1.0.0"], current_version: "1.1.0" }],
      casks: [{ name: "app", current_version: "2.0" }],
    };
    const parsed = parseBrewOutdated(payload);
    expect(parsed.get("rtk")).toBe("1.1.0");
    expect(parsed.get("app")).toBe("2.0");
  });

  test("некорректный payload - пустая карта", () => {
    expect(parseBrewOutdated(null).size).toBe(0);
    expect(parseBrewOutdated({ formulae: "нет" }).size).toBe(0);
  });
});

describe("разбор полезной нагрузки реестров", () => {
  test("npm: поле version", () => {
    expect(latestFromNpmPayload({ version: "16.3.9" })).toBe("16.3.9");
    expect(latestFromNpmPayload({})).toBeNull();
    expect(latestFromNpmPayload(null)).toBeNull();
  });

  test("pypi: info.version", () => {
    expect(latestFromPypiPayload({ info: { version: "0.9.5" } })).toBe("0.9.5");
    expect(latestFromPypiPayload({ info: {} })).toBeNull();
  });

  test("github: tag_name с префиксами bun-v и v", () => {
    expect(latestFromGithubTag({ tag_name: "bun-v1.2.23" }, /^bun-v/)).toBe("1.2.23");
    expect(latestFromGithubTag({ tag_name: "v0.9.5" }, /^$/)).toBe("0.9.5");
    expect(latestFromGithubTag({}, /^v/)).toBeNull();
  });
});

describe("syncUpdateRegistry", () => {
  test("добавляет новые записи и сохраняет статусы существующих", () => {
    const repo = tmpRepo();
    try {
      syncUpdateRegistry(repo, [target()]);
      applyUpdateResults(repo, [{ stepId: "local:next", label: "Обновление: next", exitCode: 1 }]);
      // повторная синхронизация с обновлённой версией цели
      syncUpdateRegistry(repo, [target({ currentVersion: "16.3.9" })]);
      const registry = readUpdateRegistry(repo);
      const item = registry.items["local:next"];
      expect(item.currentVersion).toBe("16.3.9");
      expect(item.lastUpdateStatus).toBe("error");
      expect(item.lastUpdateAt).toBeTruthy();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("удаляет исчезнувшие записи и сохраняет checkedAt", () => {
    const repo = tmpRepo();
    try {
      syncUpdateRegistry(repo, [target(), target({ id: "global:system:bun", name: "bun", group: "global", kind: "system", command: ["bun", "upgrade"], cwd: null })]);
      const registry = syncUpdateRegistry(repo, [target()]);
      expect(registry.items["global:system:bun"]).toBeUndefined();
      expect(registry.items["local:next"]).toBeDefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("applyUpdateResults", () => {
  test("пишет статус и время по stepId; неизвестные id игнорирует", () => {
    const repo = tmpRepo();
    try {
      syncUpdateRegistry(repo, [target(), target({ id: "local:react", name: "react" })]);
      applyUpdateResults(repo, [
        { stepId: "local:next", label: "Обновление: next", exitCode: 0 },
        { stepId: "local:react", label: "Обновление: react", exitCode: 1 },
        { stepId: "local:absent", label: "Обновление: absent", exitCode: 0 },
      ]);
      const registry = readUpdateRegistry(repo);
      expect(registry.items["local:next"].lastUpdateStatus).toBe("success");
      expect(registry.items["local:react"].lastUpdateStatus).toBe("error");
      expect(registry.items["local:next"].lastUpdateAt).toBeTruthy();
      expect(existsSync(path.join(repo, ".agents", "console", "updates.json"))).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("buildUpdateSteps", () => {
  test("строит шаги только по записям с командой", () => {
    const repo = tmpRepo();
    try {
      syncUpdateRegistry(repo, [
        target(),
        target({ id: "global:system:node", name: "node", group: "global", kind: "system", command: null, cwd: null, note: "вручную" }),
      ]);
      const built = buildUpdateSteps(repo, ["local:next", "global:system:node", "local:absent"]);
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.steps.length).toBe(1);
        expect(built.steps[0].stepId).toBe("local:next");
        expect(built.steps[0].label).toBe("Обновление: next");
        expect(built.steps[0].command).toEqual(["bun", "update", "--latest", "next"]);
        expect(built.steps[0].cwd).toBe("/repo");
        expect(built.steps[0].optional).toBe(true);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("без подходящих записей - ошибка", () => {
    const repo = tmpRepo();
    try {
      syncUpdateRegistry(repo, [target({ command: null, cwd: null })]);
      const built = buildUpdateSteps(repo, ["local:next"]);
      expect(built.ok).toBe(false);
      if (!built.ok) expect(built.error).toContain("нет команд");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("updateRegistryDTO", () => {
  test("группирует и сортирует по имени", () => {
    const registry = {
      checkedAt: "2026-10-01T10:00:00.000Z",
      items: {
        "local:zustand": { ...target({ id: "local:zustand", name: "zustand" }), latestVersion: null, updateAvailable: false, lastUpdateStatus: null, lastUpdateAt: null },
        "global:system:bun": { ...target({ id: "global:system:bun", name: "bun", group: "global", kind: "system", command: ["bun", "upgrade"], cwd: null }), latestVersion: null, updateAvailable: false, lastUpdateStatus: null, lastUpdateAt: null },
        "local:next": { ...target(), latestVersion: null, updateAvailable: false, lastUpdateStatus: null, lastUpdateAt: null },
      },
    };
    const dto = updateRegistryDTO(registry);
    expect(dto.checkedAt).toBe("2026-10-01T10:00:00.000Z");
    expect(dto.local.map((item) => item.name)).toEqual(["next", "zustand"]);
    expect(dto.global.map((item) => item.name)).toEqual(["bun"]);
  });
});
