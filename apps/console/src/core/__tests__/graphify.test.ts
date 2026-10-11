import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GRAPHIFY_OUT,
  GRAPHIFY_STORE,
  graphifyAllInOneDir,
  graphifyCliInstalled,
  graphifyOutDir,
  graphifySlug,
  graphifyStatus,
  graphifyStoreRoot,
  graphifyWorkspaceDir,
  graphifyWorkspaceNames,
  graphifyWikiStatus,
  graphifyWikiTree,
  pruneGraphifyPublic,
  startGraphifyBuild,
  startGraphifyMergeBuild,
  startGraphifyWikiBuild,
  syncGraphifyPublic,
} from "@/core/graphify";
import { fsSignals } from "@/lib/signals/fs";

let root = "";
let publicRoot = "";
let storeDir = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "graphify-"));
  publicRoot = join(root, "public");
  storeDir = join(root, GRAPHIFY_STORE, "demo");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("воркспейсы graphify", () => {
  test("GRAPHIFY_STORE = graphify; каталог воркспейса - <repoRoot>/graphify/<имя>", () => {
    expect(GRAPHIFY_OUT).toBe("graphify-out");
    expect(graphifyStoreRoot("/w/repo")).toBe(join("/w/repo", "graphify"));
    expect(graphifyWorkspaceDir("/w/repo", "demo")).toBe(join("/w/repo", "graphify", "demo"));
    expect(graphifyOutDir(join("/w/repo", "graphify", "demo"))).toBe(join("/w/repo", "graphify", "demo", "graphify-out"));
  });

  test("имя воркспейса - basename папки", () => {
    const names = graphifyWorkspaceNames(["/a/proj", "/b/docs"]);
    expect(names.get("/a/proj")).toBe("proj");
    expect(names.get("/b/docs")).toBe("docs");
  });

  test("коллизия имён: суффикс sha256 полного пути, детерминированно", () => {
    const dirs = ["/a/console", "/b/console"];
    const first = graphifyWorkspaceNames(dirs);
    const second = graphifyWorkspaceNames([...dirs].reverse());
    for (const dir of dirs) {
      expect(first.get(dir)).toMatch(/^console-[0-9a-f]{4}$/);
      expect(first.get(dir)).toBe(second.get(dir));
    }
    expect(first.get("/a/console")).not.toBe(first.get("/b/console"));
  });
});

describe("graphify статус", () => {
  test("без graphify-out: exists=false, сборки нет", async () => {
    const status = await graphifyStatus(fsSignals, storeDir);
    expect(status.exists).toBe(false);
    expect(status.nodes).toBeNull();
    expect(status.build.running).toBe(false);
    const wiki = await graphifyWikiStatus(fsSignals, storeDir);
    expect(wiki.exists).toBe(false);
    expect(wiki.articles).toBeNull();
  });

  test("graph.json разбирается: узлы/рёбра/lastBuild; wiki считает статьи", async () => {
    await mkdir(graphifyOutDir(storeDir), { recursive: true });
    // graphify пишет node-link JSON networkx: рёбра в поле links
    await writeFile(
      join(graphifyOutDir(storeDir), "graph.json"),
      JSON.stringify({ directed: false, nodes: [{ id: "a" }, { id: "b" }], links: [{ source: "a", target: "b" }] }),
      "utf8",
    );
    const status = await graphifyStatus(fsSignals, storeDir);
    expect(status.exists).toBe(true);
    expect(status.nodes).toBe(2);
    expect(status.edges).toBe(1);
    expect(status.lastBuild).toBeTruthy();

    const wikiDir = join(graphifyOutDir(storeDir), "wiki");
    await mkdir(wikiDir, { recursive: true });
    await writeFile(join(wikiDir, "index.md"), "# wiki", "utf8");
    await writeFile(join(wikiDir, "node.md"), "# node", "utf8");
    await writeFile(join(wikiDir, "notes.txt"), "x", "utf8");
    const wiki = await graphifyWikiStatus(fsSignals, storeDir);
    expect(wiki.exists).toBe(true);
    expect(wiki.articles).toBe(2);
    expect(wiki.lastBuild).toBeTruthy();

    const tree = await graphifyWikiTree(fsSignals, storeDir);
    const names = tree.map((n) => n.name).sort();
    expect(names).toEqual(["index.md", "node.md", "notes.txt"]);
  });
});

describe("публикация графа", () => {
  test("sync копирует graph.html в <slug>/index.html; prune чистит неактивные", async () => {
    await writeFile(join(graphifyOutDir(storeDir), "graph.html"), "<html>graph</html>", "utf8");
    const published = await syncGraphifyPublic(storeDir, publicRoot);
    expect(published?.slug).toBe(graphifySlug(storeDir));
    expect(published?.slug).toMatch(/^[0-9a-f]{12}$/);
    expect(published?.generatedAt).toBeTruthy();
    const html = await readFile(join(publicRoot, published!.slug, "index.html"), "utf8");
    expect(html).toContain("graph");

    // чужой слаг - убирается, активный - остаётся
    await mkdir(join(publicRoot, "000000000000"), { recursive: true });
    await pruneGraphifyPublic(publicRoot, [published!.slug]);
    const entries = await readFile(join(publicRoot, published!.slug, "index.html"), "utf8").then(() => true);
    expect(entries).toBe(true);
    await expect(readFile(join(publicRoot, "000000000000", "x"), "utf8")).rejects.toThrow();
  });

  test("sync без graph.html возвращает null", async () => {
    const empty = await mkdtemp(join(tmpdir(), "graphify-empty-"));
    try {
      expect(await syncGraphifyPublic(empty, join(empty, "public"))).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("all-in-one (объединённый граф папок)", () => {
  test("каталог All-in-One - <repoRoot>/graphify-out/all-in-one; без сборки статус пустой", async () => {
    const repo = await mkdtemp(join(tmpdir(), "graphify-aio-"));
    try {
      const dir = graphifyAllInOneDir(repo);
      expect(dir).toBe(join(repo, "graphify-out", "all-in-one"));
      expect(graphifyOutDir(dir)).toBe(join(repo, "graphify-out", "all-in-one", "graphify-out"));
      const status = await graphifyStatus(fsSignals, dir);
      expect(status.exists).toBe(false);
      expect(status.build.running).toBe(false);
      const wiki = await graphifyWikiStatus(fsSignals, dir);
      expect(wiki.exists).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("мета merge-сборки читается graphifyStatus: mode, счётчики, running по pid", async () => {
    const repo = await mkdtemp(join(tmpdir(), "graphify-aio-meta-"));
    try {
      const dir = graphifyAllInOneDir(repo);
      await mkdir(graphifyOutDir(dir), { recursive: true });
      await writeFile(
        join(graphifyOutDir(dir), "graph.json"),
        JSON.stringify({
          directed: false,
          nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
          links: [{ source: "a", target: "b" }],
        }),
        "utf8",
      );
      await writeFile(
        join(graphifyOutDir(dir), ".console-build.json"),
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), mode: "update" }),
        "utf8",
      );
      const status = await graphifyStatus(fsSignals, dir);
      expect(status.exists).toBe(true);
      expect(status.nodes).toBe(3);
      expect(status.edges).toBe(1);
      expect(status.build.mode).toBe("update");
      // живой pid текущего процесса - сборка числится идущей
      expect(status.build.running).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("startGraphifyMergeBuild пишет мету и лог; публикация - syncGraphifyPublic от каталога all-in-one", async () => {
    const repo = await mkdtemp(join(tmpdir(), "graphify-aio-build-"));
    const publicRoot = join(repo, "public");
    try {
      const started = await startGraphifyMergeBuild({ sources: ["graphify/a/graphify-out/graph.json"], repoRoot: repo });
      expect(started.ok).toBe(true);
      expect(started.mode).toBe("init");
      const meta = JSON.parse(
        await readFile(join(graphifyOutDir(graphifyAllInOneDir(repo)), ".console-build.json"), "utf8"),
      ) as { pid: number; mode: string };
      expect(meta.mode).toBe("init");
      expect(meta.pid).toBeGreaterThan(0);
      // объединённый graph.json появился - повторный запуск в режиме update
      await writeFile(
        join(graphifyOutDir(graphifyAllInOneDir(repo)), "graph.json"),
        JSON.stringify({ directed: false, nodes: [], links: [] }),
        "utf8",
      );
      const again = await startGraphifyMergeBuild({ sources: ["graphify/a/graphify-out/graph.json"], repoRoot: repo });
      expect(again.mode).toBe("update");

      await writeFile(join(graphifyOutDir(graphifyAllInOneDir(repo)), "graph.html"), "<html>merged</html>", "utf8");
      const published = await syncGraphifyPublic(graphifyAllInOneDir(repo), publicRoot);
      expect(published?.slug).toBe(graphifySlug(graphifyAllInOneDir(repo)));
      expect(published?.slug).toMatch(/^[0-9a-f]{12}$/);
      await pruneGraphifyPublic(publicRoot, [published!.slug]);
      const html = await readFile(join(publicRoot, published!.slug, "index.html"), "utf8");
      expect(html).toContain("merged");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("сборка воркспейса (интеграционный, требует graphify CLI)", () => {
  let sourceDir = "";
  let wsDir = "";

  beforeAll(async () => {
    sourceDir = await mkdtemp(join(tmpdir(), "graphify-src-"));
    await writeFile(join(sourceDir, "math.py"), "def add(a, b):\n    return a + b\n", "utf8");
    wsDir = await mkdtemp(join(tmpdir(), "graphify-ws-"));
  });

  afterAll(async () => {
    for (const dir of [sourceDir, wsDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const until = async (check: () => Promise<boolean>, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return check();
  };

  test("extract + cluster-only пишут graph.json и graph.html; export wiki пишет статьи", async () => {
    if (!graphifyCliInstalled()) {
      console.log("graphify CLI не установлен - тест пропущен");
      return;
    }
    const started = await startGraphifyBuild({ sourceDir, storeDir: wsDir, repoRoot: wsDir, codeOnly: true });
    expect(started.ok).toBe(true);
    // цепочка сборки: extract пишет graph.json, следом cluster-only - graph.html
    const graphReady = await until(async () => {
      try {
        return (await stat(join(graphifyOutDir(wsDir), "graph.html"))).isFile();
      } catch {
        return false;
      }
    }, 60_000);
    expect(graphReady).toBe(true);
    const status = await graphifyStatus(fsSignals, wsDir);
    expect(status.exists).toBe(true);

    const wiki = await startGraphifyWikiBuild({ storeDir: wsDir, repoRoot: wsDir });
    expect(wiki.ok).toBe(true);
    const wikiReady = await until(async () => {
      try {
        return (await stat(join(graphifyOutDir(wsDir), "wiki", "index.md"))).isFile();
      } catch {
        return false;
      }
    }, 30_000);
    expect(wikiReady).toBe(true);
    const wikiStatus = await graphifyWikiStatus(fsSignals, wsDir);
    expect(wikiStatus.exists).toBe(true);
    expect((wikiStatus.articles ?? 0) >= 1).toBe(true);
  }, 100_000);

  test("merge-graphs + cluster-only собирают All-in-One из графа воркспейса", async () => {
    if (!graphifyCliInstalled()) {
      console.log("graphify CLI не установлен - тест пропущен");
      return;
    }
    const source = join(graphifyOutDir(wsDir), "graph.json");
    try {
      await stat(source);
    } catch {
      console.log("граф воркспейса не собран - тест пропущен");
      return;
    }
    const mergeRoot = await mkdtemp(join(tmpdir(), "graphify-merge-"));
    try {
      const started = await startGraphifyMergeBuild({ sources: [source], repoRoot: mergeRoot });
      expect(started.ok).toBe(true);
      const aioOut = graphifyOutDir(graphifyAllInOneDir(mergeRoot));
      const mergedReady = await until(async () => {
        try {
          return (await stat(join(aioOut, "graph.html"))).isFile();
        } catch {
          return false;
        }
      }, 60_000);
      expect(mergedReady).toBe(true);
      const status = await graphifyStatus(fsSignals, graphifyAllInOneDir(mergeRoot));
      expect(status.exists).toBe(true);
      expect((status.nodes ?? 0) >= 2).toBe(true);
    } finally {
      await rm(mergeRoot, { recursive: true, force: true });
    }
  }, 100_000);
});
