import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalSkills, desiredSkillLinks, ensureSkillLink, removeSkillLink, skillLinksStatus, syncSkillLinks } from "../skillLinks";
import type { ConsoleStateLike } from "../skills";

let root = "";

const state: ConsoleStateLike = { skills: { useGlobal: true, defaults: {}, runtimeOverrides: {} } };

async function writeManifest(dir: string, id: string, runtimes: string[]): Promise<void> {
  await mkdir(path.join(root, dir, id), { recursive: true });
  await writeFile(
    path.join(root, dir, id, "manifest.yaml"),
    [
      "apiVersion: harness/v1",
      "kind: InternalSkill",
      `id: ${id}`,
      `title: ${id}`,
      `description: Навык ${id}`,
      "source:",
      '  version: "1.0.0"',
      "  hash: sha256:test",
      "  update: manual-review",
      `runtimes: [${runtimes.join(", ")}]`,
      "tags: [test]",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(root, dir, id, "SKILL.md"), `# ${id}\nИнструкция навыка.`);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-skill-links-"));
  // публичный навык канонического хранилища
  await mkdir(path.join(root, ".agents", "skills", "pub-skill"), { recursive: true });
  await writeFile(path.join(root, ".agents", "skills", "pub-skill", "SKILL.md"), "# pub-skill");
  // master-навык, привязанный к двум рантаймам
  await writeManifest(".agents/skills/master/skills", "demo-skill", ["claude", "zcode"]);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("canonicalSkills и desiredSkillLinks", () => {
  test("канон: публичный, master; совпадение имён решается в пользу master", async () => {
    const skills = await canonicalSkills(root);
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    expect(byName.get("pub-skill")?.itemId).toBe("harness:pub-skill");
    expect(byName.get("pub-skill")?.boundToAll).toBe(true);
    expect(byName.get("demo-skill")?.itemId).toBe("master:demo-skill");
    expect(byName.get("demo-skill")?.runtimes).toEqual(["claude", "zcode"]);
  });

  test("желаемые симлинки: публичный - всем рантаймам, master - только привязанным", async () => {
    const desired = await desiredSkillLinks(root, state);
    expect(desired.get("cursor")!.has("pub-skill")).toBe(true);
    expect(desired.get("cursor")!.has("demo-skill")).toBe(false);
    expect(desired.get("claude")!.has("demo-skill")).toBe(true);
    expect(desired.get("kimi")).toBeUndefined();
  });
});

describe("syncSkillLinks", () => {
  test("создаёт симлинки по желаемому набору", async () => {
    const reports = await syncSkillLinks(root, state);
    const claude = reports.find((report) => report.runtime === "claude")!;
    expect(claude.errors).toEqual([]);
    const link = await lstat(path.join(root, ".claude", "skills", "pub-skill"));
    expect(link.isSymbolicLink()).toBe(true);
    // master только у привязанных
    await expect(lstat(path.join(root, ".claude", "skills", "demo-skill"))).resolves.toBeTruthy();
    await expect(lstat(path.join(root, ".cursor", "skills", "demo-skill"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("реальный каталог канонического навыка уходит в бэкап и заменяется симлинком", async () => {
    const dir = path.join(root, ".claude", "skills", "pub-skill");
    await rm(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), "# расходившийся вариант");
    const reports = await syncSkillLinks(root, state);
    const claude = reports.find((report) => report.runtime === "claude")!;
    expect(claude.normalized).toContain("pub-skill");
    const link = await lstat(dir);
    expect(link.isSymbolicLink()).toBe(true);
    // бэкап сохранил прежнее содержимое
    const backupRoot = path.join(root, ".agents", ".tmp", "skill-links-backup");
    const backups = await readdir(backupRoot);
    const saved = await readFile(path.join(backupRoot, backups[0]!, "SKILL.md"), "utf8");
    expect(saved).toContain("расходившийся вариант");
  });

  test("выключение тогглом убирает симлинк; реальный каталог выключенного - в бэкап", async () => {
    const off: ConsoleStateLike = { skills: { useGlobal: false, defaults: {}, runtimeOverrides: {} } };
    const reports = await syncSkillLinks(root, off);
    const claude = reports.find((report) => report.runtime === "claude")!;
    expect(claude.removed).toContain("pub-skill");
    await expect(lstat(path.join(root, ".claude", "skills", "pub-skill"))).rejects.toMatchObject({ code: "ENOENT" });
    // реальный каталог вместо симлинка при выключенном навыке - бэкап и удаление
    const realDir = path.join(root, ".cursor", "skills", "pub-skill");
    await mkdir(realDir, { recursive: true });
    await writeFile(path.join(realDir, "SKILL.md"), "# вариант");
    const reports2 = await syncSkillLinks(root, off);
    const cursor = reports2.find((report) => report.runtime === "cursor")!;
    expect(cursor.normalized).toContain("pub-skill");
    await expect(lstat(realDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("чужие записи остаются, битые симлинки удаляются, внешние симлинки не трогаются", async () => {
    const dir = path.join(root, ".claude", "skills");
    // чужой каталог без канонического аналога
    await mkdir(path.join(dir, "foreign-skill"), { recursive: true });
    // битый симлинк
    await symlink(path.join(root, ".agents", "skills", "no-such-skill"), path.join(dir, "broken-link"));
    // симлинк вне канонического хранилища (цель существует)
    await mkdir(path.join(root, "somewhere"), { recursive: true });
    await symlink(path.join(root, "somewhere"), path.join(dir, "external-link"));    const reports = await syncSkillLinks(root, state);
    const claude = reports.find((report) => report.runtime === "claude")!;
    expect(claude.kept).toContain("foreign-skill");
    expect(claude.kept).toContain("external-link");
    expect(claude.removed).toContain("broken-link (битый симлинк)");
    await expect(lstat(path.join(dir, "foreign-skill"))).resolves.toBeTruthy();
    await expect(lstat(path.join(dir, "external-link"))).resolves.toBeTruthy();
    await expect(lstat(path.join(dir, "broken-link"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("исключения синка", () => {
  test("graphify не трогается: реальный каталог остаётся, в желаемый набор не входит", async () => {
    // graphify - рабочий каталог с рантайм-вариантами; правило - не трогать
    await mkdir(path.join(root, ".agents", "skills", "graphify"), { recursive: true });
    await writeFile(path.join(root, ".agents", "skills", "graphify", "SKILL.md"), "# graphify общий вариант");
    const realDir = path.join(root, ".claude", "skills", "graphify");
    await mkdir(realDir, { recursive: true });
    await writeFile(path.join(realDir, "SKILL.md"), "# graphify вариант claude");
    const reports = await syncSkillLinks(root, state);
    const claude = reports.find((report) => report.runtime === "claude")!;
    expect(claude.kept).toContain("graphify");
    expect(claude.normalized).not.toContain("graphify");
    expect(await readFile(path.join(realDir, "SKILL.md"), "utf8")).toContain("вариант claude");
    // примитивы жизненного цикла тоже отказываются
    const toggle = await ensureSkillLink(root, "claude", "graphify", path.join(root, ".agents", "skills", "graphify"));
    expect(toggle.errors.join(" ")).toContain("исключений");
    const removal = await removeSkillLink(root, "claude", "graphify");
    expect(removal.errors.join(" ")).toContain("исключений");
    await expect(lstat(realDir)).resolves.toBeTruthy();
    // в желаемом наборе и статусе graphify отсутствует
    const desired = await desiredSkillLinks(root, state);
    expect(desired.get("claude")!.has("graphify")).toBe(false);
  });
});

describe("removeSkillLink", () => {
  test("снимает симлинк в канон и отказывается снимать чужой", async () => {
    await syncSkillLinks(root, state);
    const outcome = await removeSkillLink(root, "zcode", "pub-skill");
    expect(outcome.errors).toEqual([]);
    await expect(lstat(path.join(root, ".zcode", "skills", "pub-skill"))).rejects.toMatchObject({ code: "ENOENT" });

    const external = path.join(root, ".claude", "skills", "external-link");
    const outcome2 = await removeSkillLink(root, "claude", "external-link");
    expect(outcome2.errors.join(" ")).toContain("вне .agents/skills");
    await expect(lstat(external)).resolves.toBeTruthy();
    // realpath цель существующего симлинка указывает в канон (корень теста сам может быть симлинком)
    const resolvedRoot = await realpath(root);
    const points = await realpath(path.join(root, ".claude", "skills", "pub-skill"));
    expect(points.startsWith(path.join(resolvedRoot, ".agents", "skills"))).toBe(true);
  });
});

describe("skillLinksStatus", () => {
  test("показывает реальные каталоги, битые и нехватку", async () => {
    const dir = path.join(root, ".opencode", "skills");
    await mkdir(path.join(dir, "real-one"), { recursive: true });
    await symlink(path.join(root, ".agents", "skills", "gone"), path.join(dir, "broken-one"));
    await rm(path.join(dir, "pub-skill"), { force: true });
    const statuses = await skillLinksStatus(root, state);
    const opencode = statuses.find((status) => status.runtime === "opencode")!;
    expect(opencode.entries.find((entry) => entry.name === "real-one")?.kind).toBe("real");
    expect(opencode.entries.find((entry) => entry.name === "broken-one")?.kind).toBe("broken");
    expect(opencode.missing).toContain("pub-skill");
    const externalEntry = statuses.find((status) => status.runtime === "claude")!.entries.find((entry) => entry.name === "external-link");
    expect(externalEntry?.points).toBe("вне .agents/skills");
  });
});
