import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNavTree,
  checkReadPath,
  pruneVisualizerPublic,
  processAlive,
  readAllowedFile,
  readPolicy,
  resolveVisualizerFile,
  syncVisualizerPublic,
  visualizerContentType,
  visualizerDir,
  visualizerSlug,
  visualizerStatus,
  wikiDir,
  type ReadPolicy,
} from "@/core/memory";
import type { FileEntry } from "@/core/types";

/* ------------------------------- дерево навигации ------------------------------ */

function entry(root: string, relPath: string): FileEntry {
  return { path: join(root, relPath), relPath, name: relPath.split("/").pop()!, mtime: new Date(0) };
}

describe("buildNavTree", () => {
  test("плоский список → дерево (папки first, алфавит)", () => {
    const files = [
      entry("/r", "zeta.md"),
      entry("/r", "docs/b.md"),
      entry("/r", "README.md"),
      entry("/r", "docs/a.md"),
      entry("/r", "docs/sub/deep.md"),
    ];
    const tree = buildNavTree("/r", files);
    const names = tree.map((n) => n.name);
    // папка docs первой (kind dir), потом файлы по алфавиту
    expect(names).toEqual(["docs", "README.md", "zeta.md"]);
    const docs = tree[0]!;
    expect(docs.kind).toBe("dir");
    // внутри docs тоже папки first: sub, затем файлы по алфавиту
    expect(docs.children?.map((n) => n.name)).toEqual(["sub", "a.md", "b.md"]);
    expect(docs.children?.[0]?.children?.[0]?.name).toBe("deep.md");
  });

  test("файл в корне дерева получает абсолютный путь", () => {
    const tree = buildNavTree("/r", [entry("/r", "x.md")]);
    expect(tree[0]!.path).toBe("/r/x.md");
  });
});

/* ------------------------------ политика чтения ------------------------------ */

let dir = "";
let policy: ReadPolicy;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "console-memory-"));
  // рабочая папка: docs/*.md, секрет, md вне docs, вики
  await mkdir(join(dir, "ws", "docs", "sub"), { recursive: true });
  await mkdir(join(dir, "ws", "openwiki", ".claims"), { recursive: true });
  await mkdir(join(dir, "memory-root"), { recursive: true });
  await writeFile(join(dir, "ws", "README.md"), "# readme", "utf8");
  await writeFile(join(dir, "ws", "docs", "guide.md"), "# guide", "utf8");
  await writeFile(join(dir, "ws", "docs", "sub", "deep.md"), "deep", "utf8");
  await writeFile(join(dir, "ws", "notes.txt"), "text", "utf8");
  await writeFile(join(dir, "ws", ".env"), "SECRET=1", "utf8");
  await writeFile(join(dir, "ws", "openwiki", "index.md"), "# wiki", "utf8");
  await writeFile(join(dir, "ws", "openwiki", ".console-build.log"), "log", "utf8");
  await writeFile(join(dir, "ws", "openwiki", ".claims", "x.md"), "claims", "utf8");
  await writeFile(join(dir, "memory-root", "MEMORY.md"), "memory", "utf8");
  await writeFile(join(dir, "global.md"), "global", "utf8");
  await writeFile(join(dir, "secret.md"), "SECRET", "utf8");

  policy = readPolicy("/nonexistent-home", [join(dir, "ws")]);
  policy.openRoots = [join(dir, "ws", "openwiki"), join(dir, "memory-root")];
  policy.extraFiles = [join(dir, "global.md")];
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("checkReadPath", () => {
  test("md внутри рабочей папки разрешён", async () => {
    expect(await checkReadPath(join(dir, "ws", "README.md"), policy)).toEqual({ ok: true });
    expect(await checkReadPath(join(dir, "ws", "docs", "sub", "deep.md"), policy)).toEqual({ ok: true });
  });

  test("не-md и скрытые файлы рабочей папки запрещены", async () => {
    const txt = await checkReadPath(join(dir, "ws", "notes.txt"), policy);
    expect(txt.ok).toBe(false);
    const env = await checkReadPath(join(dir, "ws", ".env"), policy);
    expect(env.ok).toBe(false);
  });

  test("любой недот-файл вики разрешён, dot-файлы запрещены", async () => {
    expect(await checkReadPath(join(dir, "ws", "openwiki", "index.md"), policy)).toEqual({ ok: true });
    const log = await checkReadPath(join(dir, "ws", "openwiki", ".console-build.log"), policy);
    expect(log.ok).toBe(false);
    const claims = await checkReadPath(join(dir, "ws", "openwiki", ".claims", "x.md"), policy);
    expect(claims.ok).toBe(false);
  });

  test("md из memory-корня и одиночный глобальный файл разрешены", async () => {
    expect(await checkReadPath(join(dir, "memory-root", "MEMORY.md"), policy)).toEqual({ ok: true });
    expect(await checkReadPath(join(dir, "global.md"), policy)).toEqual({ ok: true });
  });

  test("пути вне корней, относительные и с .. отклоняются", async () => {
    expect(await checkReadPath(join(dir, "memory-root"), policy).then((r) => r.ok)).toBe(false);
    expect((await checkReadPath("relative/x.md", policy)).ok).toBe(false);
    // ".." в строке пути: resolve() нормализует, лексическая проверка отклоняет
    const traversal = `${join(dir, "ws", "docs")}/../.env`;
    expect((await checkReadPath(traversal, policy)).ok).toBe(false);
    const arbitrary = await checkReadPath(join(dir, "..", "etc", "passwd"), policy);
    expect(arbitrary.ok).toBe(false);
  });

  test("symlink, ведущий к запрещённому файлу, запрещён", async () => {
    await symlink(join(dir, "secret.md"), join(dir, "ws", "docs", "leak.md"));
    const result = await checkReadPath(join(dir, "ws", "docs", "leak.md"), policy);
    expect(result.ok).toBe(false);
  });

  test("readAllowedFile возвращает контент разрешённого файла", async () => {
    const result = await readAllowedFile(join(dir, "ws", "docs", "guide.md"), policy);
    expect(result).toEqual({ ok: true, content: "# guide", sizeBytes: 7 });
    const denied = await readAllowedFile(join(dir, "ws", ".env"), policy);
    expect(denied.ok).toBe(false);
  });
});

/* ---------------------------------- прочее ---------------------------------- */

describe("processAlive", () => {
  test("текущий процесс работает, несуществующий pid - нет", () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(-1)).toBe(false);
    expect(processAlive(999_999_999)).toBe(false);
  });
});

describe("wikiDir", () => {
  test("openwiki внутри рабочей папки", () => {
    expect(wikiDir("/a/b")).toBe(join("/a/b", "openwiki"));
  });
});

/* -------------------------------- визуализатор -------------------------------- */

describe("resolveVisualizerFile", () => {
  test("без сегментов - index.html, разрешённые имена проходят", () => {
    expect(resolveVisualizerFile(undefined)).toBe("index.html");
    expect(resolveVisualizerFile([])).toBe("index.html");
    expect(resolveVisualizerFile(["client.js"])).toBe("client.js");
    expect(resolveVisualizerFile(["graph.json"])).toBe("graph.json");
  });

  test("произвольные и пути и traversal отклоняются", () => {
    expect(resolveVisualizerFile(["nope.txt"])).toBeNull();
    expect(resolveVisualizerFile(["..", ".env"])).toBeNull();
    expect(resolveVisualizerFile(["sub", "graph.json"])).toBeNull();
  });
});

describe("visualizerContentType и slug", () => {
  test("content-type по расширению", () => {
    expect(visualizerContentType("index.html")).toBe("text/html; charset=utf-8");
    expect(visualizerContentType("client.js")).toBe("text/javascript; charset=utf-8");
    expect(visualizerContentType("graph.json")).toBe("application/json; charset=utf-8");
    expect(visualizerContentType("styles.css")).toBe("text/css; charset=utf-8");
  });

  test("slug стабилен и различает папки", () => {
    expect(visualizerSlug("/a/b")).toBe(visualizerSlug("/a/b"));
    expect(visualizerSlug("/a/b")).not.toBe(visualizerSlug("/a/c"));
    expect(visualizerSlug("/a/b")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("visualizerStatus", () => {
  test("нет экспорта → exists false; устаревший graph.json → stale", async () => {
    const { fsSignals } = await import("@/lib/signals/fs");
    const ws = join(dir, "viz-ws");
    await mkdir(join(ws, "openwiki", ".visualizer"), { recursive: true });
    await writeFile(join(ws, "openwiki", "index.md"), "# wiki", "utf8");

    const missing = await visualizerStatus(fsSignals, ws);
    expect(missing.exists).toBe(false);
    expect(missing.stale).toBe(false);

    // graph.json свежее страницы - граф актуален
    await writeFile(join(ws, "openwiki", ".visualizer", "graph.json"), "{}", "utf8");
    const fresh = await visualizerStatus(fsSignals, ws);
    expect(fresh.exists).toBe(true);
    expect(fresh.stale).toBe(false);

    // страница обновилась позже graph.json - граф устарел
    const { utimes } = await import("node:fs/promises");
    const old = new Date(Date.now() - 60_000);
    await utimes(join(ws, "openwiki", ".visualizer", "graph.json"), old, old);
    const stale = await visualizerStatus(fsSignals, ws);
    expect(stale.stale).toBe(true);
  });
});

describe("syncVisualizerPublic и prune", () => {
  test("публикует 5 файлов под слагом и убирает чужие слаги", async () => {
    const ws = join(dir, "viz-ws");
    const publicRoot = join(dir, "public-root");
    const { writeFile: wr } = await import("node:fs/promises");
    for (const name of ["index.html", "client.js", "client-lib.js", "styles.css"]) {
      await wr(join(ws, "openwiki", ".visualizer", name), "x", "utf8");
    }
    const slug = await syncVisualizerPublic(ws, publicRoot);
    expect(slug).toMatch(/^[0-9a-f]{12}$/);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(publicRoot, slug!));
    expect(files.sort()).toEqual(["client-lib.js", "client.js", "graph.json", "index.html", "styles.css"]);
    // чужой каталог не затрагиваем, повреждённый слаг удаляем
    await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
      await mkdir(join(publicRoot, "stranger"), { recursive: true });
      await writeFile(join(publicRoot, "stranger", "x"), "1", "utf8");
      await mkdir(join(publicRoot, "deadbeefdead"), { recursive: true });
      await writeFile(join(publicRoot, "deadbeefdead", "x"), "1", "utf8");
    });
    await pruneVisualizerPublic(publicRoot, [slug!]);
    const entries = await readdir(publicRoot);
    expect(entries.sort()).toEqual([slug!, "stranger"].sort());
  });

  test("без экспорта возвращает null", async () => {
    const { mkdir: mk } = await import("node:fs/promises");
    const ws2 = join(dir, "viz-ws2");
    await mk(ws2, { recursive: true });
    expect(await syncVisualizerPublic(ws2, join(dir, "public-root2"))).toBeNull();
  });
});
