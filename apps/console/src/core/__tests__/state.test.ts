import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultState,
  expandHome,
  loadConsoleState,
  saveConsoleState,
  validateWorkspaces,
  workspaceDirs,
} from "@/core/state";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "console-state-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("validateWorkspaces", () => {
  test("обязательная папка обязательна", () => {
    const r = validateWorkspaces({ mandatory: "", additional: [] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("Обязательная");
  });

  test("относительный путь отклоняется", () => {
    expect(validateWorkspaces({ mandatory: "relative/path" }).ok).toBe(false);
  });

  test("дубликаты отклоняются", () => {
    const r = validateWorkspaces({ mandatory: "/a", additional: ["/a", "/b"] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("Дубликат"))).toBe(true);
  });

  test("корректный набор проходит", () => {
    const r = validateWorkspaces({ mandatory: "/a", additional: ["/b"] });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ mandatory: "/a", additional: ["/b"], openwiki: [], graphify: [], docs: [] });
  });

  test("openwiki: посторонние и дубликаты отбрасываются молча", () => {
    const r = validateWorkspaces({
      mandatory: "/a",
      additional: ["/b"],
      openwiki: ["/a", "/b", "/outsider", "/a", "relative"],
    });
    expect(r.ok).toBe(true);
    expect(r.value?.openwiki).toEqual(["/a", "/b"]);
  });

  test("openwiki: убранная из списка папка снимается с вики", () => {
    const r = validateWorkspaces({ mandatory: "/a", additional: [], openwiki: ["/removed"] });
    expect(r.ok).toBe(true);
    expect(r.value?.openwiki).toEqual([]);
  });

  test("graphify: подмножество папок, посторонние отбрасываются", () => {
    const r = validateWorkspaces({
      mandatory: "/a",
      additional: ["/b"],
      graphify: ["/a", "/outsider", "/a"],
    });
    expect(r.ok).toBe(true);
    expect(r.value?.graphify).toEqual(["/a"]);
  });

  test("~/… разворачивается в домашний каталог до абсолютного пути", () => {
    const r = validateWorkspaces({ mandatory: "~/work/project", openwiki: ["~/work/project"] });
    expect(r.ok).toBe(true);
    const home = expandHome("~");
    expect(r.value?.mandatory).toBe(join(home, "work/project"));
    expect(r.value?.openwiki).toEqual([join(home, "work/project")]);
  });

  test("tilde-дубликат дополнительной папки разворачивается до проверки", () => {
    const r = validateWorkspaces({ mandatory: "/a", additional: ["~/b", "~/b"] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("Дубликат"))).toBe(true);
  });
});

describe("хранилище состояния", () => {
  test("roundtrip: save → load со значениями по умолчанию при частичном файле", async () => {
    process.env.HARNESS_CONSOLE_STATE = join(dir, "state.json");
    const state = defaultState("/repo");
    state.mcp.servers["smoke"] = {
      name: "smoke",
      transport: { type: "stdio", command: "echo" },
      enabled: false,
      runtimeOverrides: { cursor: true },
    };
    state.workspaces.additional.push("/extra/dir");
    await saveConsoleState("/repo", state);

    const loaded = await loadConsoleState("/repo");
    expect(loaded.mcp.servers["smoke"]?.enabled).toBe(false);
    expect(loaded.mcp.servers["smoke"]?.runtimeOverrides?.cursor).toBe(true);
    expect(loaded.workspaces.additional).toEqual(["/repo/docs", "/repo/sources", "/extra/dir"]);
    expect(workspaceDirs(loaded)).toEqual(["/repo", "/repo/docs", "/repo/sources", "/extra/dir"]);

    delete process.env.HARNESS_CONSOLE_STATE;
  });

  test("повреждённый файл отдаёт значения по умолчанию, а не вызывает ошибку", async () => {
    process.env.HARNESS_CONSOLE_STATE = join(dir, "broken.json");
    await writeFile(join(dir, "broken.json"), "{ не json", "utf8");
    const loaded = await loadConsoleState("/repo");
    expect(loaded.mcp.servers).toEqual({});
    expect(loaded.workspaces.mandatory).toBe("/repo");
    delete process.env.HARNESS_CONSOLE_STATE;
  });

  test("tilde-пути из файла разворачиваются при загрузке", async () => {
    process.env.HARNESS_CONSOLE_STATE = join(dir, "tilde.json");
    await writeFile(
      join(dir, "tilde.json"),
      JSON.stringify({ workspaces: { mandatory: "~/work/project", additional: [], openwiki: ["~/work/project"] } }),
      "utf8",
    );
    const loaded = await loadConsoleState("/repo");
    const home = expandHome("~");
    expect(loaded.workspaces.mandatory).toBe(join(home, "work/project"));
    expect(loaded.workspaces.openwiki).toEqual([join(home, "work/project")]);
    delete process.env.HARNESS_CONSOLE_STATE;
  });
});
