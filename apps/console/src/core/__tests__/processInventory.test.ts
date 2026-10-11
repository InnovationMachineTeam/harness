import { describe, expect, test } from "bun:test";
import type { PsInfoFull } from "@/lib/signals/processes";
import {
  classifyProcess,
  markSafety,
  parseEtimeSeconds,
  type InventoryProcess,
} from "@/core/processInventory";

function ps(overrides: Partial<PsInfoFull> & Pick<PsInfoFull, "pid" | "command">): PsInfoFull {
  return { ppid: 300, uptime: "01:23", cpu: 1.5, mem: 0.4, kind: "cli", ...overrides };
}

function classify(info: PsInfoFull, managed: Map<number, string> = new Map()) {
  return classifyProcess(info, managed);
}

describe("classifyProcess: рантаймы", () => {
  test("приложение и CLI рантайма относятся к runtime", () => {
    const app = classify(ps({ pid: 100, command: "/Applications/ZCode.app/Contents/MacOS/ZCode", kind: "app" }));
    expect(app?.source).toBe("runtime");
    expect(app?.originId).toBe("zcode");
    const cli = classify(ps({ pid: 101, command: "claude --resume sess1" }));
    expect(cli?.source).toBe("runtime");
    expect(cli?.originId).toBe("claude");
  });

  test("рантайм приоритетнее прочих правил", () => {
    // claude в команде с "mcp" - это рантайм, а не MCP-сервер
    const info = classify(ps({ pid: 102, command: "claude mcp list" }));
    expect(info?.source).toBe("runtime");
  });
});

describe("classifyProcess: MCP-серверы", () => {
  test("stdio-серверы инструментов", () => {
    const serena = classify(ps({ pid: 200, command: "/Users/u/.local/bin/serena start-mcp-server --context=ide --project-from-cwd" }));
    expect(serena?.source).toBe("mcp");
    expect(serena?.originId).toBe("serena");
    const qmd = classify(ps({ pid: 201, command: "qmd mcp" }));
    expect(qmd?.source).toBe("mcp");
    const headroom = classify(ps({ pid: 202, command: "headroom mcp serve --proxy-url http://127.0.0.1:8787" }));
    expect(headroom?.source).toBe("mcp");
    const od = classify(ps({ pid: 203, command: "od mcp --daemon-url http://127.0.0.1:7456" }));
    expect(od?.source).toBe("mcp");
    expect(od?.originId).toBe("open-design");
  });

  test("codegraph MCP-скрипт из tooling", () => {
    const info = classify(ps({ pid: 204, command: "bun run /repo/tooling/mcp/codegraph.ts --help" }));
    expect(info?.source).toBe("mcp");
    expect(info?.originId).toBe("codegraph");
  });

  test("сервер без mcp-маркера - не MCP: headroom proxy это инструмент", () => {
    const info = classify(ps({ pid: 205, command: "headroom proxy --port 8787" }));
    expect(info?.source).toBe("tool");
    expect(info?.originId).toBe("headroom");
  });
});

describe("classifyProcess: managed-дашборды и инструменты", () => {
  test("запись dashboards.json сильнее MCP-сигнатуры", () => {
    const managed = new Map([[501, "serena"]]);
    const info = classify(ps({ pid: 501, command: "serena start-mcp-server --transport streamable-http --port 9121" }), managed);
    expect(info?.source).toBe("tool");
    expect(info?.originId).toBe("serena");
    expect(info?.originLabel).toContain("дашборд");
    expect(info?.managedDashboard).toBe(true);
    expect(info?.port).toBe(24282);
  });

  test("CLI инструментов реестра", () => {
    const cases: [string, string][] = [
      ["rtk git status", "rtk"],
      ["nx daemon", "nx"],
      ["agentplane context dashboard --host 127.0.0.1 --port 24287", "agentplane"],
      ["openwiki --language ru --init", "openwiki"],
      ["graphify update .", "graphify"],
      ["codegraph sync -q", "codegraph"],
    ];
    for (const [command, originId] of cases) {
      const info = classify(ps({ pid: 300, command }));
      expect(info?.source).toBe("tool");
      expect(info?.originId).toBe(originId);
    }
  });

  test("расширение файла и флаг не считаются бинарником", () => {
    expect(classify(ps({ pid: 301, command: "pandoc notes.qmd -o out" }))?.originId).not.toBe("qmd");
    expect(classify(ps({ pid: 302, command: "tool --qmd-fast run" }))).toBeNull();
  });
});

describe("classifyProcess: провайдеры и посторонние", () => {
  test("локальные серверы инференса", () => {
    const ollama = classify(ps({ pid: 400, command: "ollama serve" }));
    expect(ollama?.source).toBe("provider");
    expect(ollama?.originId).toBe("ollama");
    const vllm = classify(ps({ pid: 401, command: "/usr/local/bin/vllm serve Qwen/Qwen3-8B" }));
    expect(vllm?.source).toBe("provider");
    const lmstudio = classify(ps({ pid: 402, command: "/Applications/LM Studio.app/Contents/MacOS/LM Studio", kind: "app" }));
    expect(lmstudio?.source).toBe("provider");
    expect(lmstudio?.originId).toBe("lmstudio");
  });

  test("посторонние процессы не попадают в список", () => {
    expect(classify(ps({ pid: 500, command: "/usr/libexec/sshd-session" }))).toBeNull();
    expect(classify(ps({ pid: 501, command: "next-server (v15.5.0)" }))).toBeNull();
    expect(classify(ps({ pid: 502, command: "/System/Library/CoreServices/Finder" }))).toBeNull();
  });
});

describe("parseEtimeSeconds", () => {
  test("форматы ps etime", () => {
    expect(parseEtimeSeconds("10:23")).toBe(623);
    expect(parseEtimeSeconds("03:04:05")).toBe(11045);
    expect(parseEtimeSeconds("2-03:04:05")).toBe(183845);
    expect(parseEtimeSeconds("мусор")).toBe(0);
  });
});

describe("markSafety", () => {
  function inv(partial: Partial<InventoryProcess> & Pick<InventoryProcess, "pid" | "source" | "managedDashboard">): InventoryProcess {
    return {
      ppid: 300,
      uptime: "01:23",
      uptimeSeconds: 83,
      cpu: 1,
      mem: 1,
      command: "cmd",
      kind: "cli",
      originId: "x",
      originLabel: "X",
      port: null,
      safety: "none",
      safetyReason: null,
      ...partial,
    } as InventoryProcess;
  }

  test("managed-дашборд: дубликат, если порт слушает другой процесс", () => {
    const list = [inv({ pid: 501, source: "tool", managedDashboard: true, port: 24282 })];
    markSafety(list, new Map([[24282, new Set([999])]]));
    expect(list[0].safety).toBe("duplicate");
    expect(list[0].safetyReason).toContain("999");
  });

  test("managed-дашборд: stale, если порт молчит; healthy без маркера", () => {
    const stale = [inv({ pid: 501, source: "tool", managedDashboard: true, port: 24282 })];
    markSafety(stale, new Map([[24282, new Set()]]));
    expect(stale[0].safety).toBe("stale");

    const healthy = [inv({ pid: 502, source: "tool", managedDashboard: true, port: 8787 })];
    markSafety(healthy, new Map([[8787, new Set([502])]]));
    expect(healthy[0].safety).toBe("none");
  });

  test("MCP-сервер: orphan только без живого родителя", () => {
    const orphan = [inv({ pid: 600, source: "mcp", managedDashboard: false, ppid: 1 })];
    markSafety(orphan, new Map());
    expect(orphan[0].safety).toBe("orphan");

    const owned = [inv({ pid: 601, source: "mcp", managedDashboard: false, ppid: 410 })];
    markSafety(owned, new Map());
    expect(owned[0].safety).toBe("none");
  });

  test("рантаймы и обычные инструменты не помечаются", () => {
    const list = [inv({ pid: 700, source: "runtime", managedDashboard: false, ppid: 1 }), inv({ pid: 701, source: "tool", managedDashboard: false })];
    markSafety(list, new Map());
    expect(list[0].safety).toBe("none");
    expect(list[1].safety).toBe("none");
  });
});
