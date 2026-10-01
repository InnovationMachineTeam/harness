import { describe, expect, test } from "bun:test";
import { ACTIVE_WINDOW_MS, classifyActivity, DEFAULT_RECENT_WINDOW_MS, latestSignal } from "@/core/activity";
import type { ActivitySignal } from "@/core/types";

const NOW = new Date("2026-09-30T12:00:00Z");

function signal(minutesAgo: number, scope: ActivitySignal["scope"] = "machine"): ActivitySignal {
  return { at: new Date(NOW.getTime() - minutesAgo * 60_000), scope, source: "test" };
}

describe("classifyActivity", () => {
  test("свежий сигнал → active-now", () => {
    expect(classifyActivity([signal(1)], NOW).status).toBe("active-now");
  });

  test("ровно на границе активного окна → active-now", () => {
    const edge = { at: new Date(NOW.getTime() - ACTIVE_WINDOW_MS), scope: "machine" as const, source: "x" };
    expect(classifyActivity([edge], NOW).status).toBe("active-now");
  });

  test("2 часа назад при окне 7 дней → recently-active", () => {
    expect(classifyActivity([signal(120)], NOW).status).toBe("recently-active");
  });

  test("граница окна недавности управляется параметром", () => {
    const twoHoursAgo = signal(120);
    expect(classifyActivity([twoHoursAgo], NOW, 3_600_000).status).toBe("inactive");
    expect(classifyActivity([twoHoursAgo], NOW, 24 * 3_600_000).status).toBe("recently-active");
  });

  test("старше окна по умолчанию → inactive", () => {
    const old = { at: new Date(NOW.getTime() - DEFAULT_RECENT_WINDOW_MS - 60_000), scope: "machine" as const, source: "x" };
    expect(classifyActivity([old], NOW).status).toBe("inactive");
  });

  test("пустые сигналы → inactive", () => {
    const r = classifyActivity([], NOW);
    expect(r.status).toBe("inactive");
    expect(r.latest).toBeNull();
  });

  test("latestSignal выбирает свежейший сигнал", () => {
    const s = latestSignal([signal(500), signal(3), signal(60)]);
    expect(s?.at.getTime()).toBe(NOW.getTime() - 3 * 60_000);
  });

  test("масштаб свежейшего сигнала сохраняется", () => {
    const r = classifyActivity([signal(60, "machine"), signal(120, "repo")], NOW);
    expect(r.latest?.scope).toBe("machine");
  });
});
