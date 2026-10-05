import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkspace,
  deleteWorkspace,
  isValidWorkspaceName,
  readWorkspaceRegistry,
  setActiveWorkspace,
  wikiIdFromName,
  wikiRootFor,
  workspaceOverview,
  writeWorkspaceRegistry,
} from "@/core/openwikiWorkspaces";

let root = "";
let configDir = "";

/** Папка, похожая на собранную вики: маркер openwiki/.last-update.json. */
async function makeWikiDir(name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, "openwiki"), { recursive: true });
  await writeFile(join(dir, "openwiki", ".last-update.json"), "{}", "utf8");
  return dir;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ow-workspaces-"));
});

// каждый тест - чистый реестр: тесты чтения не засоряют мутации
beforeEach(async () => {
  configDir = join(root, `config-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(configDir, { recursive: true });
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("реестр wiki-workspaces.json", () => {
  test("чтение: отсутствующий файл - null; валидный - разбирается", async () => {
    expect(await readWorkspaceRegistry(configDir)).toBeNull();
    await writeWorkspaceRegistry(
      {
        version: 1,
        wikis: [{ id: "a", name: "a", root: "/tmp/a" }],
        workspaces: [{ id: "ws", name: "WS", wikis: ["a", "b"] }],
        active: [],
      },
      configDir,
    );
    const registry = await readWorkspaceRegistry(configDir);
    expect(registry?.version).toBe(1);
    expect(registry?.workspaces[0].wikis).toEqual(["a", "b"]);
  });

  test("чтение: воркспейс с одной вики - невалидный реестр (null)", async () => {
    const bad = join(root, "bad-config");
    await mkdir(bad, { recursive: true });
    await writeFile(
      join(bad, "wiki-workspaces.json"),
      JSON.stringify({ version: 1, wikis: [], workspaces: [{ id: "x", name: "X", wikis: ["a"] }], active: [] }),
      "utf8",
    );
    expect(await readWorkspaceRegistry(bad)).toBeNull();
  });
});

describe("id и имена", () => {
  test("wikiIdFromName: латиница, кириллица, мусор", () => {
    expect(wikiIdFromName("Платформа Core")).toBe("platforma-core");
    expect(wikiIdFromName("My WS!")).toBe("my-ws");
    expect(wikiIdFromName("!!!")).toBeNull();
  });
  test("isValidWorkspaceName: длина и печатаемость", () => {
    expect(isValidWorkspaceName("Платформа")).toBe(true);
    expect(isValidWorkspaceName("")).toBe(false);
    expect(isValidWorkspaceName("x".repeat(81))).toBe(false);
  });
});

describe("создание воркспейса", () => {
  test("нужны минимум две папки с собранной вики", async () => {
    const dir = await makeWikiDir("alpha");
    const few = await createWorkspace("WS1", [dir], configDir);
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.error).toContain("минимум две");
  });

  test("создание: вики регистрируются, состав сохраняется; дубль имени отклоняется", async () => {
    const a = await makeWikiDir("alpha");
    const b = await makeWikiDir("beta");
    const ok = await createWorkspace("Платформа", [a, b], configDir);
    expect(ok.ok).toBe(true);
    const registry = (await readWorkspaceRegistry(configDir))!;
    expect(registry.workspaces).toHaveLength(1);
    expect(registry.workspaces[0].name).toBe("Платформа");
    expect(registry.wikis.map((w) => w.id).sort()).toEqual(["alpha", "beta"]);

    const dup = await createWorkspace("Платформа", [a, b], configDir);
    expect(dup.ok).toBe(false);

    const noWiki = await createWorkspace("Третий", [a, join(root, "empty")], configDir);
    expect(noWiki.ok).toBe(false);
  });
});

describe("активный воркспейс и обзор", () => {
  test("use для незарегистрированной папки отклоняется; для участника - пишется active", async () => {
    const dirs = [await makeWikiDir("alpha"), await makeWikiDir("beta")];
    await createWorkspace("Платформа", dirs, configDir);

    const outside = join(root, "outside");
    await mkdir(outside, { recursive: true });
    const unlinked = await setActiveWorkspace(outside, "platforma", configDir);
    expect(unlinked.ok).toBe(false);

    const use = await setActiveWorkspace(dirs[0], "platforma", configDir);
    expect(use.ok).toBe(true);

    const overview = await workspaceOverview(dirs, configDir);
    const alpha = overview.folders.find((f) => f.dir === dirs[0])!;
    const beta = overview.folders.find((f) => f.dir === dirs[1])!;
    expect(alpha.wikiId).toBe("alpha");
    expect(alpha.active).toBe("platforma");
    expect(alpha.containing.map((c) => c.id)).toEqual(["platforma"]);
    expect(beta.active).toBeNull();
    expect(beta.linkable).toBe(true);
  });

  test("clear снимает активность", async () => {
    const dir = await makeWikiDir("alpha");
    const second = await makeWikiDir("beta");
    await createWorkspace("Платформа", [dir, second], configDir);
    await setActiveWorkspace(dir, "platforma", configDir);
    const clear = await setActiveWorkspace(dir, null, configDir);
    expect(clear.ok).toBe(true);
    const overview = await workspaceOverview([dir], configDir);
    expect(overview.folders[0].active).toBeNull();
  });

  test("удаление воркспейса: участники остаются, активные ссылки чистятся", async () => {
    const dir = await makeWikiDir("gamma");
    const second = await makeWikiDir("delta");
    await createWorkspace("Второй", [dir, second], configDir);
    await setActiveWorkspace(dir, "vtoroy", configDir);
    const del = await deleteWorkspace("vtoroy", configDir);
    expect(del.ok).toBe(true);
    const registry = (await readWorkspaceRegistry(configDir))!;
    expect(registry.workspaces).toHaveLength(0);
    expect(registry.active).toHaveLength(0);
    expect(registry.wikis.map((w) => w.id)).toContain("gamma");
  });
});

describe("wikiRootFor", () => {
  test("без маркера .last-update.json папка не линкуется", async () => {
    const empty = join(root, "empty");
    await mkdir(empty, { recursive: true });
    expect(await wikiRootFor(empty)).toBeNull();
  });
});
