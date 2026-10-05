import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parsePromptCommands,
  renderHarnessSkillsSection,
  resolvePromptCommands,
  runtimeExpandedPrompt,
} from "../skills";
import type { ConsoleStateLike } from "../../skills";

let root = "";

const state: ConsoleStateLike = {
  skills: { useGlobal: true, defaults: { "harness:frontend-design": true }, runtimeOverrides: {} },
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "harness-prompt-commands-"));
  // публичный harness-навык без manifest: попадает в collectHarnessSkills
  await mkdir(path.join(root, ".agents", "skills", "frontend-design"), { recursive: true });
  await writeFile(
    path.join(root, ".agents", "skills", "frontend-design", "SKILL.md"),
    "---\nname: frontend-design\ndescription: Визуальный дизайн интерфейсов\n---\n# Frontend design\nСледуй принципам дизайна.",
  );
  await mkdir(path.join(root, ".agents", "skills", "master", "skills", "system-design"), { recursive: true });
  await writeFile(
    path.join(root, ".agents", "skills", "master", "skills", "system-design", "manifest.yaml"),
    [
      "apiVersion: harness/v1",
      "kind: InternalSkill",
      "id: system-design",
      "title: System Design",
      "description: Архитектурный дизайн системы",
      "source:",
      "  version: \"1.0.0\"",
      "  hash: sha256:test",
      "  update: manual-review",
      "runtimes: [claude, zcode]",
      "tags: [architecture]",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(root, ".agents", "skills", "master", "skills", "system-design", "SKILL.md"), "# System design\nИнструкция навыка.");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("parsePromptCommands", () => {
  test("токены master: и agent: разбираются в цепочку", () => {
    const parsed = parsePromptCommands("/master:system-design /agent:plancer сделай план");
    expect(parsed?.skillIds).toEqual(["system-design"]);
    expect(parsed?.agentIds).toEqual(["plancer"]);
    expect(parsed?.harnessIds).toEqual([]);
    expect(parsed?.prompt).toBe("сделай план");
  });

  test("авто-режим /master <промт>", () => {
    const parsed = parsePromptCommands("/master спроектируй кеш");
    expect(parsed?.autoSkill).toBe(true);
    expect(parsed?.prompt).toBe("спроектируй кеш");
  });

  test("токен /<имя> распознаётся только в списке harnessNames", () => {
    const parsed = parsePromptCommands("/frontend-design обнови лендинг", ["frontend-design"]);
    expect(parsed?.harnessIds).toEqual(["frontend-design"]);
    expect(parsed?.prompt).toBe("обнови лендинг");
    // имя не в списке - токен не командный, команд нет
    expect(parsePromptCommands("/frontend-design обнови лендинг", [])).toBeNull();
  });

  test("без командных токенов - null", () => {
    expect(parsePromptCommands("обычный текст")).toBeNull();
    expect(parsePromptCommands("/неизвестная-команда текст")).toBeNull();
  });

  test("регистр имени не важен", () => {
    const parsed = parsePromptCommands("/Frontend-Design задача", ["frontend-design"]);
    expect(parsed?.harnessIds).toEqual(["frontend-design"]);
  });
});

describe("resolvePromptCommands: harness-навыки", () => {
  test("у провайдера токен /<имя> раскрывается в блок навыка", async () => {
    const resolved = await resolvePromptCommands(root, { executor: "provider", input: "/frontend-design обнови лендинг", state });
    expect(resolved?.errors).toEqual([]);
    expect(resolved?.harnessSkills).toHaveLength(1);
    expect(resolved?.harnessSkills[0]!.id).toBe("harness:frontend-design");
    expect(resolved?.harnessSkills[0]!.content).toContain("Следуй принципам дизайна");
    expect(resolved?.prompt).toBe("обнови лендинг");
    const section = renderHarnessSkillsSection(resolved!.harnessSkills);
    expect(section).toContain("[Harness skill]");
    expect(section).toContain("UNTRUSTED");
  });

  test("провайдер с явным id (provider:<id>) тоже раскрывает", async () => {
    const resolved = await resolvePromptCommands(root, { executor: "provider:ollama", input: "/frontend-design задача", state });
    expect(resolved?.harnessSkills).toHaveLength(1);
  });

  test("у рантайма токен /<имя> остаётся нативным вызовом - раскрытия нет", async () => {
    const resolved = await resolvePromptCommands(root, { executor: "zcode", input: "/frontend-design задача", state });
    expect(resolved).toBeNull();
  });

  test("выключенный тогглом навык не распознаётся как команда", async () => {
    const off: ConsoleStateLike = { skills: { useGlobal: false, defaults: {}, runtimeOverrides: {} } };
    const resolved = await resolvePromptCommands(root, { executor: "provider", input: "/frontend-design задача", state: off });
    // навык выключен - в harnessNames его нет, токен не командный, промт уходит как есть
    expect(resolved).toBeNull();
  });

  test("master-навык сохраняет прежнее поведение раскрытия", async () => {
    const resolved = await resolvePromptCommands(root, { executor: "claude", input: "/master:system-design задача", state });
    expect(resolved?.errors).toEqual([]);
    expect(resolved?.skills).toHaveLength(1);
    expect(resolved?.skills[0]!.id).toBe("system-design");
    const prompt = runtimeExpandedPrompt(resolved!);
    expect(prompt).toContain("[Harness master skill]");
    expect(prompt).toContain("[User prompt]");
    expect(prompt).toContain("задача");
  });
});
