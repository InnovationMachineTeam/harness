#!/usr/bin/env node
// guard.mjs - единая реализация политики репозитория.
//
// Один движок для всех рантаймов (claude, codex, zcode, cursor, kimi, opencode);
// отличаются только способы доставки: нативный PreToolUse-хук, зеркалирование в
// ~/.kimi-code/config.toml или плагин OpenCode. Список правил синхронен с
// deny/warn-списком в .agents/runtime/{kimi,zcode}/README.md.
//
// Контракт:
//   stdin : {"tool_name":"Bash","tool_input":{"command":"…"}} (или file_path для Write/Edit/Read)
//   exit 0 - разрешено (warn-правила печатаются в stderr)
//   exit 2 - блок (stderr: id правила, причина, "Instead: …")
//   env   : AGENT_RUNTIME (id вендора), AGENT_RUNTIME_CONFIG (путь к .agents/runtime/<vendor>/config.json)
//
// Режим `settings` печатает основные настройки рантайма в терминал
// (TEMP - временное решение для теста, см. AGENTS.md §2).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_CONFIG_PATH = join(RUNTIME_DIR, "config.json");

// --- нормализация имён инструментов вендоров -------------------------------
// Cursor: Shell/Delete; ZCode: ApplyPatch→Write/Edit, Task→Agent; OpenCode: строчные.
const TOOL_ALIASES = {
  shell: "Bash",
  bash: "Bash",
  delete: "Bash", // удаление файлов Cursor - разбираем как rm
  applypatch: "Edit",
  task: "Agent",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
  list: "Glob",
  search: "Grep",
};

function normalizeTool(name) {
  if (!name) return "";
  const lower = String(name).toLowerCase();
  const canonical = TOOL_ALIASES[lower];
  if (canonical) return canonical;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Cursor Delete передаёт путь удаляемого файла - превращаем в эквивалент rm.
function toolInputOf(tool, input, rawToolName) {
  if (String(rawToolName || "").toLowerCase() === "delete") {
    const p = input?.path || input?.file_path || input?.filePath || "";
    return { command: `rm -rf ${p}` };
  }
  return input || {};
}

// --- шаблоны путей -----------------------------------------------------------
const SECRET_PATH =
  /(^|\/)\.env($|\.)|\.pem$|\.key$|id_rsa|id_ed25519|(^|\/)\.ssh\/|(^|\/)secrets?\/|credentials\.json$/i;
const PROTECTED_WRITE = /(^|\/)\.git(\/|$)|(^|\/)node_modules(\/|$)|(^|\/)bun\.lock$|(^|\/)package-lock\.json$/;
const STRUCTURAL_GUARD_FILES =
  /(^|\/)(guard\.(mjs|ts|js)|policy\.(ts|js|json)|write-sets\.json)$|agent-hooks\/src\//;
const STRUCTURAL_AREAS = /(^|\/)\.agents\/(roles|skills|runtime|agents)(\/|$)/;
const RM_ALLOWLIST = /^(\.agents\/\.tmp\/|\/tmp\/|\/private\/tmp\/|\.nx\/|node_modules\/)/;
const WORKTREES = /(^|\/)\.agents\/\.worktrees\//;

// --- правила -----------------------------------------------------------------
// match(ctx) → { reason, instead } | null.  ctx = { tool, command, path, input }
const BLOCK = [
  {
    id: "shell.rm-rf-root",
    match: ({ command }) => {
      const t = rmTargets(command);
      if (!t) return null;
      if (t.targets.some((p) => p.startsWith("/") || p.startsWith("~") || p.includes("*"))) {
        return {
          reason: "Recursive delete of an absolute, home or wildcard path.",
          instead: "Name a repository-relative path, or ask the user to run it themselves.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.rm-rf-worktree",
    match: ({ command }) => {
      const t = rmTargets(command);
      if (!t) return null;
      if (t.targets.some((p) => WORKTREES.test(p))) {
        return {
          reason: "Deleting a worktree under .agents/.worktrees/ with rm leaves git's registration behind.",
          instead: "bun run worktree:remove <slug> - it unregisters the worktree and its branch.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.rm-rf-outside-allowlist",
    match: ({ command }) => {
      const t = rmTargets(command);
      if (!t) return null;
      const outside = t.targets.filter(
        (p) => !RM_ALLOWLIST.test(p.replace(/^\.\//, "")) && !WORKTREES.test(p) && !p.startsWith("/") && !p.startsWith("~") && !p.includes("*"),
      );
      if (outside.length && !t.targets.some((p) => p.startsWith("/") || p.startsWith("~") || p.includes("*"))) {
        return {
          reason: `Recursive delete outside the allowlist (.agents/.tmp, /tmp, .nx, node_modules): ${outside.join(", ")}`,
          instead: "Delete the specific files, or do the work under .agents/.tmp/ instead.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.git-force-push",
    match: ({ command }) => {
      if (!/\bgit\b[^|;&]*\bpush\b/.test(command)) return null;
      if (/--force-with-lease/.test(command)) return null;
      if (/(^|\s)--force\b/.test(command) || /(^|\s)-f\b/.test(command)) {
        return {
          reason: "Force push discards published history.",
          instead: "git push --force-with-lease, and ask the user first.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.history-rewrite",
    match: ({ command }) => {
      if (/\bgit\s+(filter-branch|filter-repo)\b/.test(command) || /\bgit\s+push\b[^|;&]*--mirror\b/.test(command)) {
        return {
          reason: "Repository-wide history rewrite.",
          instead: "Ask the user; a rewrite invalidates every clone.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.chmod-777",
    match: ({ command }) => {
      if (/\bchmod\b[^|;&]*\s-R?\s*[^|;&]*\b777\b/.test(command) && /(^|\s)-R(^|\s|$)/.test(command)) {
        return {
          reason: "chmod -R 777 makes the tree world-writable.",
          instead: "Set the narrowest mode the failing step actually needs.",
        };
      }
      return null;
    },
  },
  {
    id: "db.drop",
    match: ({ command }) => {
      if (/\b(drop\s+database|drop\s+schema|dropdb)\b/i.test(command)) {
        return {
          reason: "Destructive database operation.",
          instead: "Write a migration; the schema is generated from packages/core/data.",
        };
      }
      return null;
    },
  },
  {
    id: "db.delete-without-where",
    match: ({ command }) => {
      const m = command.match(/\bDELETE\s+FROM\b[^;]*/i);
      if (m && !/\bWHERE\b/i.test(m[0])) {
        return {
          reason: "DELETE without a WHERE clause.",
          instead: "Add the predicate, or run it as a reviewed migration.",
        };
      }
      return null;
    },
  },
  {
    id: "prisma.reset",
    match: ({ command }) => {
      if (/\bprisma\b[^|;&]*\breset\b/.test(command) || /\bprisma\s+(migrate\s+)?reset\b/.test(command)) {
        return {
          reason: "Prisma reset drops the development database.",
          instead: "bunx prisma migrate dev, which keeps the data.",
        };
      }
      return null;
    },
  },
  {
    id: "secrets.read",
    match: ({ tool, command }) => {
      if (tool !== "Bash") return null;
      if (/\b(cat|less|more|head|tail)\b[^|;&]*(\.env\b|\.pem\b|id_rsa|id_ed25519|\/\.ssh\/)/.test(command)) {
        return {
          reason: "Reading a secret file into the transcript.",
          instead: "Read .env.example instead, or ask the user for the value you need.",
        };
      }
      return null;
    },
  },
  {
    id: "secrets.read-tool",
    match: ({ tool, path, command }) => {
      if (tool !== "Read" && tool !== "Grep" && tool !== "Glob") return null;
      const target = path || command || "";
      if (SECRET_PATH.test(target)) {
        return {
          reason: `Read/Grep/Glob over a secret path (${target}) puts its contents in the transcript.`,
          instead: "Read .env.example, or ask the user for the single value you need.",
        };
      }
      return null;
    },
  },
  {
    id: "net.pipe-to-shell",
    match: ({ command }) => {
      if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?|node)\b/.test(command)) {
        return {
          reason: "Executing a downloaded script without review.",
          instead: "Download to a file, read it, then run it.",
        };
      }
      return null;
    },
  },
  {
    id: "write.secret-path",
    match: ({ tool, path }) => {
      if (tool !== "Write" && tool !== "Edit") return null;
      if (SECRET_PATH.test(path || "")) {
        return {
          reason: "Writing a secret file would commit a credential or overwrite a live one.",
          instead: "Change .env.example and tell the user which value to set.",
        };
      }
      return null;
    },
  },
  {
    id: "write.protected-path",
    match: ({ tool, path }) => {
      if (tool !== "Write" && tool !== "Edit") return null;
      if (PROTECTED_WRITE.test(path || "")) {
        return {
          reason: "Writing inside .git/, node_modules/ or a lockfile edits state a tool owns.",
          instead: "Change the source the tool reads, then re-run the tool.",
        };
      }
      return null;
    },
  },
  {
    id: "infra.production",
    match: ({ command }) => {
      if (/\b(terraform|pulumi|cdk)\b[^|;&]*\b(apply|destroy)\b/.test(command) || /\bkubectl\b[^|;&]*\bdelete\b/.test(command)) {
        return {
          reason: "Production or destructive infrastructure operation.",
          instead: "Run it through the deploy workflow, which holds a gate before apply.",
        };
      }
      return null;
    },
  },
  {
    id: "deploy.prod-apply",
    match: ({ command }) => {
      if (/\b(deploy|release)\b[^|;&]*\b(prod|production|live)\b/i.test(command)) {
        return {
          reason: "Applying to a protected environment outside a release step.",
          instead: "bun run delivery run <MID> <SID> - the deploy workflow holds the approval gate.",
        };
      }
      return null;
    },
  },
  {
    id: "deploy.destructive",
    match: ({ command }) => {
      if (/\b(docker|compose|kubectl|helm|terraform|pulumi)\b[^|;&]*\b(down|destroy|teardown)\b/.test(command)) {
        return {
          reason: "Tearing down a deployed environment or a managed resource.",
          instead: "Ask the user; a teardown is an always-gate in every autonomy mode.",
        };
      }
      return null;
    },
  },
  {
    id: "gate.answer-by-agent",
    match: ({ tool, command, path }) => {
      if (/\bgate:answer\b|\bgate\s+answer\b/.test(command || "") || /gate[^\/]*answer\.md$/.test(path || "")) {
        return {
          reason: "A gate is answered by a person; an agent answering it approves its own request.",
          instead: "Tell the user the gate id and what it approves, and wait: they answer it in the console Inbox.",
        };
      }
      return null;
    },
  },
  {
    id: "approval.by-agent",
    match: ({ tool, command, path }) => {
      if (/\bagents\s+approve\b/.test(command || "") || /agent-change\/approval\.md$/.test(path || "")) {
        return {
          reason: "An approval is given by a person; an agent writing it approves its own change.",
          instead: "Ask the user to run `bun run agents approve <run>` in a terminal.",
        };
      }
      return null;
    },
  },
  {
    id: "structural.guard-mutation",
    match: ({ tool, path }) => {
      if (tool !== "Write" && tool !== "Edit") return null;
      if (STRUCTURAL_GUARD_FILES.test(path || "")) {
        return {
          reason: "The guard source, the write-set register and the role charters decide what every agent may do; the author of such a change must not be its only approver.",
          instead: "Show the user the exact change and ask them to make or approve it themselves; do not work around this block.",
        };
      }
      return null;
    },
  },
];

const WARN = [
  {
    id: "deploy.billable",
    match: ({ command }) => {
      if (/\b(gcloud|aws|az)\b[^|;&]*\b(create|deploy|run)\b/.test(command)) {
        return {
          reason: "Creating a cloud resource costs money from the moment it exists.",
          instead: "Confirm the cost with the user before the second step of the call.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.git-hard-reset",
    match: ({ command }) => {
      if (/\bgit\s+reset\s+--hard\b/.test(command)) {
        return {
          reason: "Hard reset discards uncommitted work.",
          instead: "git stash, or commit on a scratch branch first.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.git-clean",
    match: ({ command }) => {
      if (/\bgit\s+clean\b[^|;&]*\s-[a-zA-Z]*f/.test(command)) {
        return {
          reason: "git clean -fd deletes untracked files irreversibly, including active worktrees.",
          instead: "git clean -nd first, and check git worktree list.",
        };
      }
      return null;
    },
  },
  {
    id: "shell.sudo",
    match: ({ command }) => {
      if (/(^|[\s;|&])sudo\s/.test(command)) {
        return {
          reason: "Elevated privileges requested.",
          instead: "Prefer a user-scoped install; ask before changing the machine.",
        };
      }
      return null;
    },
  },
  {
    id: "structural.agents-mutation",
    match: ({ tool, path }) => {
      if (tool !== "Write" && tool !== "Edit") return null;
      if (STRUCTURAL_AREAS.test(path || "")) {
        return {
          reason: "A change under .agents/roles, skills, runtime or agents is a structural change to the agent system.",
          instead: "Bring it to the user as a proposal: evidence, the change, the risks.",
        };
      }
      return null;
    },
  },
];

// Разбор rm: возвращает { targets } для рекурсивного удаления, иначе null.
function rmTargets(command) {
  if (!command || !/\brm\b/.test(command)) return null;
  const re = /(^|\s|;|&|\|)rm\s+((?:-{1,2}[a-zA-Z]+\s+)+)(.+)/;
  const m = command.match(re);
  if (!m) return null;
  const flags = m[2];
  if (!/r/i.test(flags)) return null; // интересует только рекурсивное удаление
  const targets = m[3]
    .split(/[\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("-"));
  return { flags, targets };
}

// --- движок -------------------------------------------------------------------
function check(toolName, input) {
  const tool = normalizeTool(toolName);
  const toolInput = toolInputOf(tool, input, toolName);
  const ctx = {
    tool,
    input: toolInput,
    command: String(toolInput.command || toolInput.cmd || ""),
    path: String(toolInput.file_path || toolInput.filePath || toolInput.path || toolInput.notebook_path || ""),
  };
  for (const rule of BLOCK) {
    const hit = rule.match(ctx);
    if (hit) return { kind: "block", rule: rule.id, ...hit };
  }
  for (const rule of WARN) {
    const hit = rule.match(ctx);
    if (hit) return { kind: "warn", rule: rule.id, ...hit };
  }
  return null;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// --- режим `settings` (TEMP - вывод основных настроек в терминал) -------------
function printSettings(vendorConfigPath) {
  const root = readJson(ROOT_CONFIG_PATH) || {};
  const vendorPath = resolve(
    vendorConfigPath ||
      process.env.AGENT_RUNTIME_CONFIG ||
      join(RUNTIME_DIR, process.env.AGENT_RUNTIME || root.defaultVendor || "claude", "config.json"),
  );
  const vendor = readJson(vendorPath) || {};
  const runtime = process.env.AGENT_RUNTIME || vendor.id || root.defaultVendor || "?";
  const limits = { ...(root.limits || {}) };
  const profileName = process.env.AGENT_PROFILE || "default";
  const profile = root.profiles?.[profileName];
  if (profile?.limits) Object.assign(limits, profile.limits);

  const line = "=" .repeat(72);
  console.log(line);
  console.log("AGENT RUNTIME SETTINGS   (TEMP - временный вывод для теста, AGENTS.md §2)");
  console.log(line);
  console.log(`runtime:            ${runtime}`);
  console.log(`adapter:            ${vendor.vendorAdapter ?? "-"}`);
  console.log(`hooksSupport:       ${vendor.guard?.hooksSupport ?? "-"}`);
  console.log(`guard:              ${root.guard ?? "-"}`);
  console.log(`vendor config:      ${vendorPath.includes(RUNTIME_DIR) ? vendorPath.replace(RUNTIME_DIR, ".agents/runtime") : vendorPath}`);
  console.log(`profile:            ${profileName}${profile ? ` (defaultModel: ${profile.defaultModel})` : ""}`);
  console.log("models:");
  for (const [tier, m] of Object.entries(vendor.models || {})) {
    const flag = m.verified ? "verified" : "NOT verified - подтвердить у пользователя";
    console.log(`  ${tier.padEnd(11)} ${String(m.model).padEnd(34)} ${m.thinkingLevel ?? ""} [${flag}]`);
  }
  console.log("limits:");
  for (const [k, v] of Object.entries(limits)) console.log(`  ${k.padEnd(22)} ${v}`);
  const perm = vendor.permissions || {};
  console.log(
    "permissions:",
    `fs.read=${perm.filesystem?.read}  fs.write=${perm.filesystem?.write}  git.commit=${perm.git?.commit}  git.push=${perm.git?.push}  git.forcePush=${perm.git?.forcePush}  shell=${perm.shell}`,
  );
  if (root.verification) {
    console.log("verification:");
    for (const [k, v] of Object.entries(root.verification)) console.log(`  ${k.padEnd(12)} ${v}`);
  }
  console.log(line);
}

// --- CLI ----------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  // --format=… принимается для совместимости с командами из README; семантика - exit-code.
  const rest = args.filter((a) => !a.startsWith("--format") && a !== "--quiet");
  const explainIdx = rest.indexOf("--explain");

  if (rest[0] === "settings") {
    const cfgIdx = rest.indexOf("--config");
    printSettings(cfgIdx !== -1 ? rest[cfgIdx + 1] : undefined);
    process.exit(0);
  }

  if (explainIdx !== -1) {
    const id = rest[explainIdx + 1];
    const rule = [...BLOCK, ...WARN].find((r) => r.id === id);
    if (!rule) {
      console.error(`guard: no rule ${id}`);
      process.exit(1);
    }
    const probe = rule.match({
      tool: "Bash",
      command: "rm -rf /",
      path: "/tmp/x",
      input: {},
    });
    console.log(`${id} [${BLOCK.includes(rule) ? "block" : "warn"}]`);
    console.log(probe ? `  ${probe.reason}` : "  (правило активно; срабатывание зависит от payload)");
    console.log(probe ? `  Instead: ${probe.instead}` : "");
    process.exit(0);
  }

  const stdin = readFileSync(0, "utf8");
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    console.error("guard: stdin is not JSON ({tool_name, tool_input}) - пропускаю проверку");
    process.exit(0); // fail-open: повреждённый payload не должен блокировать работу
  }

  const result = check(payload.tool_name, payload.tool_input);
  if (!result) process.exit(0);

  const prefix = result.kind === "block" ? "guard: BLOCKED" : "guard: WARN";
  console.error(`${prefix} by ${result.rule} - ${result.reason}`);
  console.error(`Instead: ${result.instead}`);
  process.exit(result.kind === "block" ? 2 : 0);
}

main();
