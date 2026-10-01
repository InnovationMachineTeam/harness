import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dashboardsFilePath,
  dashboardPort,
  probePort,
  startDashboard,
  stopDashboard,
} from "@/core/dashboards";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dashboards-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("dashboardPort", () => {
  test("парсит порт из http(s)-URL реестра", () => {
    expect(dashboardPort("http://127.0.0.1:24282/dashboard/index.html")).toBe(24282);
    expect(dashboardPort("http://127.0.0.1:8787/dashboard")).toBe(8787);
    expect(dashboardPort("https://example.com")).toBeNull(); // нет порта - не число
    expect(dashboardPort("ftp://x:21")).toBeNull(); // не http(s)
    expect(dashboardPort("не url")).toBeNull();
  });
});

describe("probePort", () => {
  test("закрытый порт - false, слушающий - true", async () => {
    expect(await probePort(1, 300)).toBe(false); // порт 1 почти наверняка закрыт
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(await probePort(port)).toBe(true);
    server.close();
  });
});

describe("start/stop dashboard", () => {
  test("инструмент без дашборда - ошибка; без записи stop - отказ", async () => {
    const noDash = await startDashboard(dir, "qmd");
    expect(noDash.ok).toBe(false);
    const stopped = await stopDashboard(dir, "serena");
    expect(stopped.ok).toBe(false);
  });

  // ветка "порт уже занят" не тестируется юнитом: порт 8787/24282 - реальный
  // сервис окружения, поведение зависит от машины (проверено вручную)
});
