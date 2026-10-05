import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { docsCheck, docsWrite, RUNTIMES } from "../registry";
import { makeRoot, putIn } from "./helpers";

const GUARD_CLAUDE = "AGENT_RUNTIME=claude AGENT_RUNTIME_CONFIG=\"${CLAUDE_PROJECT_DIR}/.agents/runtime/claude/config.json\" node \"${CLAUDE_PROJECT_DIR}/.agents/runtime/guard.mjs\"";
const GUARD_CODEX = "AGENT_RUNTIME=codex AGENT_RUNTIME_CONFIG=.agents/runtime/codex/config.json node .agents/runtime/guard.mjs";
const GUARD_ZCODE = "AGENT_RUNTIME=zcode node \"${ZCODE_PROJECT_DIR}/.agents/runtime/guard.mjs\"";
const GUARD_CURSOR = "AGENT_RUNTIME=cursor node \"$CURSOR_PROJECT_DIR/.agents/runtime/guard.mjs\"";
const GUARD_KIMI = "sh -c 'if [ -f .agents/runtime/guard.mjs ]; then node .agents/runtime/guard.mjs; else exit 0; fi'";

function kimiText(...blocks: string[][]): string {
  const header = [
    "# Kimi Code не читает проектные файлы хуков: скопируйте блок [[hooks]] ниже в",
    "# ~/.kimi-code/config.toml (или добавьте к существующим записям).",
    "",
  ].join("\n");
  return header + blocks.map((block) => ["[[hooks]]", ...block].join("\n")).join("\n") + "\n";
}

const KIMI_GUARD_BLOCK = [`event = "PreToolUse"`, `matcher = "Bash|Write|Edit|Read|Grep|Glob"`, `command = "${GUARD_KIMI}"`, `timeout = 30`];

async function rootWithConfigs(): Promise<string> {
  const root = await makeRoot();
  await putIn(
    root,
    ".claude/settings.json",
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { matcher: "Bash|Write|Edit|Read|Grep|Glob", hooks: [{ type: "command", command: GUARD_CLAUDE, timeout: 30 }] },
            { matcher: "Bash|Grep", hooks: [{ type: "command", command: "graphify hook-guard search", timeout: 10 }] },
          ],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "codegraph prompt-hook" }] }],
        },
      },
      null,
      2,
    ) + "\n",
  );
  await putIn(
    root,
    ".codex/hooks.json",
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { matcher: "Bash|Write|Edit|Read|Grep|Glob", hooks: [{ type: "command", command: GUARD_CODEX, timeout: 30 }] },
            { matcher: "Bash", hooks: [{ type: "command", command: "graphify hook-check" }] },
          ],
        },
      },
      null,
      2,
    ) + "\n",
  );
  await putIn(
    root,
    ".zcode/config.json",
    JSON.stringify(
      { hooks: { enabled: true, events: { PreToolUse: [{ matcher: "Bash|Write|Edit|Read|Grep|Glob", hooks: [{ type: "command", command: GUARD_ZCODE, timeout: 30 }] }] } } },
      null,
      2,
    ) + "\n",
  );
  await putIn(
    root,
    ".cursor/hooks.json",
    JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: GUARD_CURSOR, timeout: 30, failClosed: false }] } }, null, 2) + "\n",
  );
  await putIn(root, ".kimi/config.toml", kimiText(KIMI_GUARD_BLOCK));
  return root;
}

describe("registry docs (N-3), пять рантаймов", () => {
  test("docsWrite расставляет записи реестра всем рантаймам, чужие записи сохраняются", async () => {
    const root = await rootWithConfigs();
    docsWrite(root);
    expect(docsCheck(root)).toEqual([]);

    const claude = JSON.parse(await readFile(join(root, ".claude/settings.json"), "utf8"));
    expect(claude.hooks.PreToolUse[0].hooks[0].command).toBe(GUARD_CLAUDE);
    expect(claude.hooks.PreToolUse).toHaveLength(4);
    expect(claude.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
    expect(claude.hooks.SessionEnd[0].hooks[0].command).toContain("serena session-end");

    const codex = JSON.parse(await readFile(join(root, ".codex/hooks.json"), "utf8"));
    expect(codex.hooks.PreToolUse).toHaveLength(1);
    expect(JSON.stringify(codex)).not.toContain("graphify");

    const zcode = JSON.parse(await readFile(join(root, ".zcode/config.json"), "utf8"));
    expect(zcode.hooks.enabled).toBe(true);
    expect(zcode.hooks.events.PreToolUse[0].hooks[0].command).toBe(GUARD_ZCODE);
    expect(zcode.hooks.events.PreToolUse).toHaveLength(4);
    expect(zcode.hooks.events.UserPromptSubmit[0].hooks[0].command).toContain("codegraph prompt-hook");
    expect(zcode.hooks.events.SessionStart[0].hooks[0].command).toContain("serena session-start");
    expect(zcode.hooks.events.SessionStart[0].matcher).toBeUndefined();

    const cursor = JSON.parse(await readFile(join(root, ".cursor/hooks.json"), "utf8"));
    expect(cursor.hooks.preToolUse[0].command).toBe(GUARD_CURSOR);
    expect(cursor.hooks.preToolUse).toHaveLength(2);
    expect(cursor.hooks.preToolUse[1].command).toContain("pretooluse");
    expect(cursor.hooks.preToolUse[1].failClosed).toBe(false);

    const kimi = await readFile(join(root, ".kimi/config.toml"), "utf8");
    expect(kimi.match(/^\[\[hooks\]\]$/gm) ?? []).toHaveLength(4);
    expect(kimi).toContain(GUARD_KIMI);
    expect(kimi).toContain("exec bun tooling/harness/src/cli.ts serena remind");
    expect(kimi.startsWith("# Kimi Code")).toBe(true);
  });

  test("прямой вызов инструмента даёт ошибку validate (N-5) - claude, zcode, cursor, kimi", async () => {
    const root = await rootWithConfigs();
    docsWrite(root);

    const claudePath = join(root, ".claude/settings.json");
    const claude = JSON.parse(await readFile(claudePath, "utf8"));
    claude.hooks.UserPromptSubmit[0].hooks[0].command = "codegraph prompt-hook";
    await writeFile(claudePath, JSON.stringify(claude, null, 2) + "\n");

    const zcodePath = join(root, ".zcode/config.json");
    const zcode = JSON.parse(await readFile(zcodePath, "utf8"));
    zcode.hooks.events.PreToolUse[3].hooks[0].command = "serena-hooks remind";
    await writeFile(zcodePath, JSON.stringify(zcode, null, 2) + "\n");

    const cursorPath = join(root, ".cursor/hooks.json");
    const cursor = JSON.parse(await readFile(cursorPath, "utf8"));
    cursor.hooks.preToolUse[1].command = "graphify hook-guard search";
    await writeFile(cursorPath, JSON.stringify(cursor, null, 2) + "\n");

    const kimiPath = join(root, ".kimi/config.toml");
    const kimi = await readFile(kimiPath, "utf8");
    await writeFile(kimiPath, kimi.replace(/command = "sh -c '[^']*guard-search[^']*'/, `command = "graphify hook-guard search"`));

    const problems = docsCheck(root);
    expect(problems.some((line) => line.startsWith("claude: прямой вызов"))).toBe(true);
    expect(problems.some((line) => line.startsWith("zcode: прямой вызов"))).toBe(true);
    expect(problems.some((line) => line.startsWith("cursor: прямой вызов"))).toBe(true);
    expect(problems.some((line) => line.startsWith("kimi: прямой вызов"))).toBe(true);
  });

  test("удаление записи реестра даёт ошибку", async () => {
    const root = await rootWithConfigs();
    docsWrite(root);
    const path = join(root, ".zcode/config.json");
    const zcode = JSON.parse(await readFile(path, "utf8"));
    zcode.hooks.events.SessionStart = [];
    await writeFile(path, JSON.stringify(zcode, null, 2) + "\n");
    expect(docsCheck(root)).toContain("zcode: нет записи SessionStart serena session-start");
  });

  test("реестр покрывает ожидаемые рантаймы", () => {
    expect(RUNTIMES.map((runtime) => runtime.id).sort()).toEqual(["claude", "codex", "cursor", "kimi", "zcode"]);
    expect(RUNTIMES.find((runtime) => runtime.id === "codex")!.entries).toEqual([]);
  });

  test("guard-запись codex сохраняется", async () => {
    const root = await rootWithConfigs();
    docsWrite(root);
    const codex = JSON.parse(await readFile(join(root, ".codex/hooks.json"), "utf8"));
    expect(codex.hooks.PreToolUse[0].hooks[0].command).toBe(GUARD_CODEX);
  });
});
