import { describe, expect, test } from "bun:test";
import { parsePsLine } from "@/lib/signals/processes";
import { parseCodexRolloutStart } from "@/core/sessions/codex";
import { claudeProjectSlug } from "@/core/sessions/claude";
import { setSkillRuntimeOverride, setUseGlobalSkills, skillEffective } from "@/core/skills";
import { defaultState } from "@/core/state";
import { buildFixPrompt } from "@/core/prompts";

describe("parsePsLine", () => {
  test("обычная строка ps", () => {
    const info = parsePsLine("  1996      1     03:04:05   1.2   0.8  /Applications/ZCode.app/Contents/MacOS/ZCode");
    expect(info).toMatchObject({ pid: 1996, ppid: 1, uptime: "03:04:05", cpu: 1.2, mem: 0.8, kind: "app" });
  });

  test("etime с днями и CLI-процесс", () => {
    const info = parsePsLine("42 1 1-02:03:04 0.1 0.2 /usr/local/bin/claude --output-format stream-json");
    expect(info).toMatchObject({ pid: 42, uptime: "1-02:03:04", kind: "cli" });
  });

  test("недействительная строка - null", () => {
    expect(parsePsLine("PID PPID ETIME %CPU %MEM COMMAND")).toBeNull();
  });
});

describe("parseCodexRolloutStart", () => {
  test("имя файла кодирует время начала", () => {
    expect(parseCodexRolloutStart("rollout-2026-09-30T01-03-13-01a0ef31.jsonl")).toBe("2026-09-30T01:03:13.000Z");
  });

  test("без даты - undefined", () => {
    expect(parseCodexRolloutStart("rollout-whatever.jsonl")).toBeUndefined();
  });
});

describe("claudeProjectSlug", () => {
  test("путь → слаг с дефисами", () => {
    expect(claudeProjectSlug("/home/dev/harness")).toBe(
      "-home-dev-harness",
    );
  });
});

describe("оверлеи навыков", () => {
  test("effective = override → глобальный toggle; сброс override убирает запись", () => {
    const state = defaultState("/repo");
    setUseGlobalSkills(state, true);
    expect(skillEffective(state, "claude:x", "claude")).toBe(true); // useGlobal=true
    setUseGlobalSkills(state, false);
    expect(skillEffective(state, "claude:x", "claude")).toBe(false); // useGlobal=false
    setSkillRuntimeOverride(state, "claude:x", "claude", true);
    expect(skillEffective(state, "claude:x", "claude")).toBe(true); // override сильнее глобального
    setSkillRuntimeOverride(state, "claude:x", "claude", null);
    expect(skillEffective(state, "claude:x", "claude")).toBe(false); // снова глобальный
    expect(Object.keys(state.skills.runtimeOverrides)).toEqual([]);
  });
});

describe("buildFixPrompt", () => {
  test("промпт содержит проблему, детали и требование соблюдать политику", () => {
    const prompt = buildFixPrompt(
      { severity: "warn", title: "Нет зеркала хуков", detail: "файл не найден", hint: "скопируйте блок" },
      "kimi",
      "/repo",
    );
    expect(prompt).toContain("Нет зеркала хуков");
    expect(prompt).toContain("kimi");
    expect(prompt).toContain("/repo");
    expect(prompt).toContain("AGENTS.md");
  });
});
