import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GRAPHIFY_OUT,
  graphifyOutDir,
  graphifySlug,
  graphifyStatus,
  pruneGraphifyPublic,
  syncGraphifyPublic,
} from "@/core/graphify";
import { fsSignals } from "@/lib/signals/fs";

let dir = "";
let publicRoot = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "graphify-"));
  publicRoot = join(dir, "public");
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("graphify status", () => {
  test("без graphify-out: exists=false, сборки нет", async () => {
    const status = await graphifyStatus(fsSignals, dir);
    expect(status.exists).toBe(false);
    expect(status.nodes).toBeNull();
    expect(status.build.running).toBe(false);
  });

  test("graph.json разбирается: узлы/рёбра/lastBuild", async () => {
    await mkdir(graphifyOutDir(dir), { recursive: true });
    await writeFile(
      join(graphifyOutDir(dir), "graph.json"),
      JSON.stringify({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] }),
      "utf8",
    );
    const status = await graphifyStatus(fsSignals, dir);
    expect(status.exists).toBe(true);
    expect(status.nodes).toBe(2);
    expect(status.edges).toBe(1);
    expect(status.lastBuild).toBeTruthy();
  });

  test("GRAPHIFY_OUT = graphify-out внутри папки", () => {
    expect(GRAPHIFY_OUT).toBe("graphify-out");
    expect(graphifyOutDir("/w/p")).toBe(join("/w/p", "graphify-out"));
  });
});

describe("публикация графа", () => {
  test("sync копирует graph.html в <slug>/index.html; prune чистит неактивные", async () => {
    await writeFile(join(graphifyOutDir(dir), "graph.html"), "<html>graph</html>", "utf8");
    const slug = await syncGraphifyPublic(dir, publicRoot);
    expect(slug).toBe(graphifySlug(dir));
    expect(slug).toMatch(/^[0-9a-f]{12}$/);
    const html = await readFile(join(publicRoot, slug!, "index.html"), "utf8");
    expect(html).toContain("graph");

    // чужой слаг - убирается, активный - остаётся
    await mkdir(join(publicRoot, "000000000000"), { recursive: true });
    await pruneGraphifyPublic(publicRoot, [slug!]);
    const entries = await readFile(join(publicRoot, slug!, "index.html"), "utf8").then(() => true);
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
