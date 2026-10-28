#!/usr/bin/env bun
/**
 * seed-memory - наполнение связок памяти репозитория знаниями.
 *
 * Хранилища (Знание → Связки; сервисы запускает консоль):
 *   neo4j    - knowledge graph для MCP mcp-neo4j-memory: узлы :Memory
 *              {name, type, observations[]} и типизированные связи
 *              (формат neo4j_memory.py 0.4.5). Через cypher-shell.
 *   qdrant   - векторный индекс документации в коллекции harness-memory
 *              (формат mcp-server-qdrant: payload {document, metadata},
 *              вектор fast-all-minilm-l6-v2, fastembed all-MiniLM-L6-v2).
 *              Через uv run (нужен uv).
 *   lightrag - документы репозитория в графовый RAG (:9621, граф в Neo4j);
 *              извлечение сущностей идёт фоновым pipeline сервера.
 *
 * Использование:
 *   bun run tooling/scripts/src/seed-memory.ts [neo4j|qdrant|lightrag]
 *   без аргумента - все три; недоступное хранилище пропускается с сообщением.
 *
 * Повторный запуск обновляет записи (MERGE/upsert) и не трогает память,
 * созданную агентами: neo4j - узлы сеятеля помечены seed:"repo-seed",
 * qdrant - точки сеятеля несут metadata.seed="repo-docs".
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const DOCS_DIR = join(ROOT, "docs");
/**
 * Документы вне docs/: путь в репозитории и имя источника в LightRAG.
 * Имена уникальны: LightRAG дедуплицирует документы по имени файла
 * (file_path), корневой AGENTS.md не сеется - он и так в контексте агента.
 */
const EXTRA_DOCS = [{ repo: "apps/console/README.md", source: "apps-console-README.md" }];
/** Файлы docs/, исключённые из сеяния: docs/AGENTS.md - заглушка со ссылкой
 * на корневой AGENTS.md (он в контексте каждого агента); её имя в LightRAG
 * удерживает зомби-запись doc_status, блокирующая вставку (409). */
const SKIP_DOCS = new Set(["AGENTS.md"]);

const NEO4J_URI_ARGS = ["-a", "bolt://localhost:7687", "-u", "neo4j", "-p", "harness-memory"];
const LIGHTRAG_URL = "http://127.0.0.1:9621";
const QDRANT_URL = "http://127.0.0.1:6333";

/** Источник знаний: документация репозитория (без дублей по содержимому). */
async function collectDocs(): Promise<Array<{ path: string; text: string }>> {
  const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".md") && !SKIP_DOCS.has(f)).sort();
  const docs = await Promise.all(
    files.map(async (f) => ({ path: `docs/${f}`, text: await readFile(join(DOCS_DIR, f), "utf8") })),
  );
  for (const extra of EXTRA_DOCS) {
    try {
      docs.push({ path: extra.source, text: await readFile(join(ROOT, extra.repo), "utf8") });
    } catch {
      /* документа нет - пропустить */
    }
  }
  const seen = new Set<string>();
  return docs.filter((d) => {
    const key = Bun.hash(d.text).toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function probePort(port: number, timeoutMs = 500): Promise<boolean> {
  try {
    const conn = Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    const socket = await Promise.race([
      conn,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    socket.end();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// neo4j: knowledge graph для mcp-neo4j-memory
// ---------------------------------------------------------------------------

interface SeedEntity {
  name: string;
  type: "tool" | "runtime" | "command" | "concept" | "service" | "doc";
  observations: string[];
}

interface SeedRelation {
  from: string;
  type: string;
  to: string;
}

const ENTITIES: SeedEntity[] = [
  { name: "Guardrails", type: "concept", observations: ["Единый движок политики репозитория: .guardrails/src/cli.ts, exit 0 - разрешено, exit 2 - блок с подсказкой Instead", "Запускается как PreToolUse-хук всеми рантаймами; ручная проверка - echo payload | bun .guardrails/src/cli.ts evaluate", "Правила: rm -r только в .agents/.tmp, /tmp, .nx, node_modules; push без --force-with-lease запрещён; секреты не читаются"] },
  { name: "Профили задач", type: "concept", observations: ["AGENT_PROFILE: fast (2 попытки починки, параллелизм 2), default (базовые лимиты), deep (5 попыток, параллелизм 6)", "Лимиты задают repairAttempts 3, maxParallelAgents 4, wipLimit 4, researchPasses 2"] },
  { name: "Обязательная рабочая папка", type: "concept", observations: ["Папка консоли, в которую хуки включают навыки симлинками и синкают команды рантаймов", "Рабочие папки настраиваются в консоли (Настройки → Workspaces)"] },
  { name: "MCP-синк", type: "concept", observations: ["Консоль синкает глобальный реестр .agents/mcp.json в форматы рантаймов по правилу managed-имён", "Документация - docs/mcp.md"] },
  { name: "Связки памяти", type: "concept", observations: ["Наборы памяти в разделе Знание → Связки: neo4j + LightRAG (графовый RAG), neo4j + Qdrant (гибридная память)", "Установка одной задачей через POST /api/tools/action; сервисы запускаются консолью и держатся ей"] },
  { name: "Serena", type: "tool", observations: ["Семантическая навигация по коду через LSP: find_symbol, get_symbols_overview, replace_symbol_body", "Предпочитать чтению файла целиком для *.ts/*.tsx больше 300 строк"] },
  { name: "qmd", type: "tool", observations: ["Локальный гибридный поиск по markdown (BM25 + векторы): tool.sh qmd query \"запрос\""] },
  { name: "CodeGraph", type: "tool", observations: ["Knowledge graph кода в SQLite: codegraph_explore возвращает исходник + call paths одним вызовом", "Хранилище .codegraph/ в корне"] },
  { name: "Graphify", type: "tool", observations: ["Граф знаний кода и доков: graphify query \"вопрос\" по graphify-out/graph.json", "Вопросы архитектуры и потоков - подграф вместо grep"] },
  { name: "RTK", type: "tool", observations: ["Прокси-фильтр вывода shell: rtk git status, rtk bun test; полный вывод - rtk recall"] },
  { name: "Headroom", type: "tool", observations: ["Сжатие контекста перед LLM: прозрачный прокси, автозапуск из консоли"] },
  { name: "NX", type: "tool", observations: ["Оркестратор задач с кешем .nx/: тесты и валидация идут через nx (node_modules/.bin/nx)"] },
  { name: "Neo4j", type: "tool", observations: ["Графовая СУБД связок памяти: Browser 127.0.0.1:7474, Bolt bolt://localhost:7687, пароль локального инстанса harness-memory", "Хранилище knowledge graph: MCP mcp-neo4j-memory (узлы :Memory) и граф LightRAG"] },
  { name: "LightRAG", type: "tool", observations: ["Графовый RAG-сервер (lightrag-hku): REST API и WebUI 127.0.0.1:9621, граф хранится в Neo4j", "Запрос: POST /query {query, mode: hybrid}; документы - POST /documents/text", "LLM-биндинг - Ollama, извлечение deepseek-v4-flash:cloud, эмбеддинги bge-m3"] },
  { name: "Qdrant", type: "tool", observations: ["Векторная СУБД: REST 127.0.0.1:6333, WebUI :6333/dashboard, коллекция harness-memory", "Вектор fastembed all-MiniLM-L6-v2 (384, Cosine); MCP mcp-server-qdrant: qdrant-store/qdrant-find"] },
  { name: "mcp-neo4j-memory", type: "tool", observations: ["MCP-сервер памяти агентов: create_entities, create_relations, add_observations, search_nodes, read_graph", "Схема в Neo4j: MERGE (e:Memory {name}) с полями type, observations[] и дополнительным лейблом типа"] },
  { name: "mcp-server-qdrant", type: "tool", observations: ["MCP-сервер векторной памяти: qdrant-store (запись факта), qdrant-find (семантический поиск)", "Payload точки: {document, metadata}; коллекция по умолчанию harness-memory"] },
  { name: "Claude Code", type: "runtime", observations: ["Адаптер .claude/settings.json, хуки нативные; модели fast claude-sonnet-5-5, standard claude-opus-5-5"] },
  { name: "Codex CLI", type: "runtime", observations: ["Адаптер .codex/hooks.json; хуки грузятся после доверия слою .codex командой /hooks"] },
  { name: "ZCode", type: "runtime", observations: ["Адаптер .zcode/config.json (hooks.events.PreToolUse), конфиг .agents/runtime/zcode/config.json"] },
  { name: "Cursor", type: "runtime", observations: ["Адаптер .cursor/hooks.json, хук fail-open: guard - слой поверх одобрений IDE"] },
  { name: "Kimi Code", type: "runtime", observations: ["Проектных хуков нет; зеркало ~/.kimi-code/config.toml запрашивается у пользователя при первом запуске"] },
  { name: "OpenCode", type: "runtime", observations: ["Адаптер opencode.json + плагин .opencode/plugins/agentos-guard.ts; bring-your-own-provider"] },
  { name: "Antigravity", type: "runtime", observations: ["Адаптер .agents/hooks.json (PreToolUse); контракт decision-JSON переводит обёртка .guardrails/src/antigravity-hook.ts", "Навыки читает нативно из .agents/skills; CLI agy: headless -p, resume --conversation, --output-format json"] },
  { name: "verify-fast", type: "command", observations: ["bun run tooling/scripts/src/verify.ts verify-fast - после каждого изменения; guardrails + harness:test + validate:hooks"] },
  { name: "verify-integration", type: "command", observations: ["Перед слиянием: nx run-many test,validate для console, harness, guardrails"] },
  { name: "verify-security", type: "command", observations: ["Перед релизом и работой с секретами: guardrails check + tests + scan-diff"] },
  { name: "verify-e2e", type: "command", observations: ["Приёмочное тестирование поставки: nx run-many test,validate + guardrails check"] },
  { name: "docs/tools.md", type: "doc", observations: ["Инструменты экономии контекста: реестр, жизненный цикл, диспетчер tool.sh, дашборды, хуки индексов"] },
  { name: "docs/architecture.md", type: "doc", observations: ["Архитектура репозитория: границы системы, пакеты, потоки, данные, отказы"] },
  { name: "docs/operations.md", type: "doc", observations: ["Эксплуатация: процессы, промпты, настройки задач, рабочие папки, знание, guard-совместимость"] },
  { name: "AGENTS.md", type: "doc", observations: ["Канонические инструкции репозитория: рантаймы, guard, модели, лимиты, верификация, права, документация"] },
];

const RELATIONS: SeedRelation[] = [
  { from: "LightRAG", type: "stores_graph_in", to: "Neo4j" },
  { from: "mcp-neo4j-memory", type: "stores_in", to: "Neo4j" },
  { from: "mcp-server-qdrant", type: "stores_in", to: "Qdrant" },
  { from: "Neo4j", type: "serves", to: "Связка neo4j + LightRAG" },
  { from: "Neo4j", type: "serves", to: "Связка neo4j + Qdrant" },
  { from: "LightRAG", type: "serves", to: "Связка neo4j + LightRAG" },
  { from: "Qdrant", type: "serves", to: "Связка neo4j + Qdrant" },
  { from: "Guardrails", type: "protects", to: "Claude Code" },
  { from: "Guardrails", type: "protects", to: "Codex CLI" },
  { from: "Guardrails", type: "protects", to: "ZCode" },
  { from: "Guardrails", type: "protects", to: "Cursor" },
  { from: "Guardrails", type: "protects", to: "Kimi Code" },
  { from: "Guardrails", type: "protects", to: "OpenCode" },
  { from: "docs/tools.md", type: "documents", to: "Serena" },
  { from: "docs/tools.md", type: "documents", to: "qmd" },
  { from: "docs/tools.md", type: "documents", to: "CodeGraph" },
  { from: "docs/tools.md", type: "documents", to: "Graphify" },
  { from: "docs/tools.md", type: "documents", to: "RTK" },
  { from: "docs/tools.md", type: "documents", to: "Headroom" },
  { from: "docs/tools.md", type: "documents", to: "Neo4j" },
  { from: "docs/tools.md", type: "documents", to: "LightRAG" },
  { from: "docs/tools.md", type: "documents", to: "Qdrant" },
  { from: "docs/architecture.md", type: "documents", to: "Guardrails" },
  { from: "docs/operations.md", type: "documents", to: "Связки памяти" },
  { from: "AGENTS.md", type: "documents", to: "Профили задач" },
  { from: "AGENTS.md", type: "documents", to: "MCP-синк" },
  { from: "verify-integration", type: "extends", to: "verify-fast" },
  { from: "verify-e2e", type: "extends", to: "verify-integration" },
];

const SEED_MARKER = "repo-seed";

/** Экранирование строки для cypher-литерала. */
function cypherString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

async function seedNeo4j(): Promise<void> {
  if (!(await probePort(7687))) {
    console.log("[seed-memory] neo4j: Bolt :7687 не отвечает - сервис не запущен, пропуск (консоль: Знание → Связки)");
    return;
  }
  const statements: string[] = [
    `MATCH (m:Memory {seed: ${cypherString(SEED_MARKER)}}) DETACH DELETE m;`,
  ];
  for (const entity of ENTITIES) {
    statements.push(
      `MERGE (e:Memory {name: ${cypherString(entity.name)}}) ` +
        `SET e.type = ${cypherString(entity.type)}, ` +
        `e.observations = [${entity.observations.map(cypherString).join(", ")}], ` +
        `e.seed = ${cypherString(SEED_MARKER)} ` +
        `SET e:\`${entity.type}\`;`,
    );
  }
  for (const rel of RELATIONS) {
    statements.push(
      `MATCH (a:Memory {name: ${cypherString(rel.from)}}), (b:Memory {name: ${cypherString(rel.to)}}) ` +
        `MERGE (a)-[r:\`${rel.type}\`]->(b);`,
    );
  }
  const tmp = join(ROOT, ".agents", ".tmp", "seed-memory-neo4j.cypher");
  await Bun.write(tmp, statements.join("\n") + "\n");
  const proc = Bun.spawnSync(["cypher-shell", ...NEO4J_URI_ARGS, "--format", "plain", "-f", tmp], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(`[seed-memory] neo4j: ошибка cypher-shell (exit ${proc.exitCode})\n${proc.stderr.toString()}`);
    process.exit(1);
  }
  console.log(`[seed-memory] neo4j: ${ENTITIES.length} узлов, ${RELATIONS.length} связей записано (пометка ${SEED_MARKER})`);
}

// ---------------------------------------------------------------------------
// qdrant: векторный индекс документации (формат mcp-server-qdrant)
// ---------------------------------------------------------------------------

async function seedQdrant(): Promise<void> {
  if (!(await probePort(6333))) {
    console.log("[seed-memory] qdrant: :6333 не отвечает - сервис не запущен, пропуск");
    return;
  }
  const script = join(import.meta.dir, "seed-memory-qdrant.py");
  const docs = await collectDocs();
  const payload = join(ROOT, ".agents", ".tmp", "seed-memory-qdrant.json");
  await Bun.write(payload, JSON.stringify(docs.map((d) => ({ path: d.path, text: d.text }))));
  const proc = Bun.spawnSync(
    ["uv", "run", "--with", "fastembed", "--with", "qdrant-client", "python", script, QDRANT_URL, payload],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const stdout = proc.stdout.toString().trim();
  if (proc.exitCode !== 0) {
    console.error(`[seed-memory] qdrant: ошибка (exit ${proc.exitCode})\n${stdout}\n${proc.stderr.toString()}`);
    process.exit(1);
  }
  console.log(`[seed-memory] qdrant: ${stdout}`);
}

// ---------------------------------------------------------------------------
// lightrag: документы репозитория в графовый RAG
// ---------------------------------------------------------------------------

async function seedLightrag(): Promise<void> {
  if (!(await probePort(9621))) {
    console.log("[seed-memory] lightrag: :9621 не отвечает - сервис не запущен, пропуск");
    return;
  }
  const docs = await collectDocs();
  // синхронизация по имени файла: документ с тем же именем и той же длиной
  // контента пропускается, изменившийся удаляется и ставится заново
  const existing = new Map<string, Array<{ id: string; contentLength: number; status: string }>>();
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${LIGHTRAG_URL}/documents/paginated`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, page_size: 50 }),
    });
    if (!res.ok) break;
    const json = (await res.json()) as {
      documents?: Array<{ id: string; file_path: string; content_length: number; status: string }>;
      total?: number;
    };
    for (const d of json.documents ?? []) {
      const key = (d.file_path ?? "").split("/").pop() ?? "";
      const list = existing.get(key) ?? [];
      list.push({ id: d.id, contentLength: d.content_length, status: d.status });
      existing.set(key, list);
    }
    const total = json.total ?? 0;
    if (page * 50 >= total || (json.documents?.length ?? 0) === 0) break;
  }

  let inserted = 0;
  let skipped = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const doc of docs) {
    const text = `# Источник: ${doc.path}\n\n${doc.text}`;
    const byteLength = Buffer.byteLength(text, "utf8");
    const basename = doc.path.split("/").pop() ?? doc.path;
    const records = existing.get(basename) ?? [];
    // критерий "уже засеян": запись с той же длиной контента в байтах и не failed
    if (records.some((d) => d.status !== "failed" && d.contentLength === byteLength)) {
      skipped += 1;
      continue;
    }
    const stale = records.filter((d) => d.contentLength !== byteLength);
    if (stale.length > 0) {
      // имена источников сеятеля уникальны (EXTRA_DOCS) - под basename
      // документа лежат только его собственные версии
      await fetch(`${LIGHTRAG_URL}/documents`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: stale.map((d) => d.id) }),
      });
      console.log(`[seed-memory] lightrag: обновляется (контент изменился): ${doc.path}`);
      // удаление асинхронное (чистка KV, векторов и графа Neo4j) - ждём
      // фактического исчезновения записей из списка (до ~90 с)
      const staleIds = new Set(stale.map((d) => d.id));
      for (let waited = 0; waited < 90; waited += 3) {
        const probe = await fetch(`${LIGHTRAG_URL}/documents/paginated`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page: 1, page_size: 50 }),
        });
        if (probe.ok) {
          const list = (await probe.json()) as { documents?: Array<{ id: string }> };
          const left = (list.documents ?? []).filter((d) => staleIds.has(d.id)).length;
          if (left === 0) break;
        }
        await sleep(3000);
      }
    }
    // на случай гонок с фоновой чисткой и сетевых обрывов под нагрузкой -
    // повторяем вставку при 409 и сетевых ошибках
    let done = false;
    for (let attempt = 0; attempt < 6 && !done; attempt += 1) {
      if (attempt > 0) await sleep(10000);
      try {
        const res = await fetch(`${LIGHTRAG_URL}/documents/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, file_source: doc.path }),
        });
        if (res.ok) {
          done = true;
        } else if (res.status === 409) {
          continue;
        } else {
          console.error(`[seed-memory] lightrag: /documents/text ${res.status}: ${(await res.text()).slice(0, 300)}`);
          process.exit(1);
        }
      } catch {
        continue; // сетевой обрыв (ECONNRESET под нагрузкой) - повтор
      }
    }
    if (!done) {
      console.error(`[seed-memory] lightrag: не удалось поставить после удаления (409): ${doc.path}`);
      process.exit(1);
    }
    inserted += 1;
    console.log(`[seed-memory] lightrag: поставлено: ${doc.path}`);
  }
  console.log(`[seed-memory] lightrag: ${inserted} поставлено, ${skipped} без изменений; извлечение идёт фоном (прогресс - GET /documents/pipeline_status)`);
}

// ---------------------------------------------------------------------------

const target = process.argv[2];
const runners: Record<string, () => Promise<void>> = { neo4j: seedNeo4j, qdrant: seedQdrant, lightrag: seedLightrag };
if (target) {
  if (!runners[target]) {
    console.error("использование: bun run tooling/scripts/src/seed-memory.ts [neo4j|qdrant|lightrag]");
    process.exit(1);
  }
  await runners[target]();
} else {
  for (const run of Object.values(runners)) await run();
}
