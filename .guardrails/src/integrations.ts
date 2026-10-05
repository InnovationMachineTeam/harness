import type { IntegrationRecord } from "./types";
import { EVENT_BUNDLES, RUNTIME_ADAPTERS } from "./runtimeAdapters";

export const GUARD_COMMAND = "bun .guardrails/src/cli.ts evaluate";

/**
 * Runtime-записи выводятся из реестра адаптеров (runtimeAdapters.ts):
 * новый рантайм попадает в аудит и UI добавлением записи реестра.
 */
function runtimeRecords(): IntegrationRecord[] {
  return RUNTIME_ADAPTERS.flatMap((adapter) =>
    adapter.hooks.map((hook) => ({
      id: `runtime:${adapter.id}:${hook.event}`,
      title: `${adapter.title} - ${hook.event}`,
      purpose: hook.purpose,
      protects: hook.protects,
      kind: "runtime-hook" as const,
      source: hook.file,
      marker: hook.marker,
      bundles: [EVENT_BUNDLES[hook.event] ?? "baseline"],
      expectedFailureMode: hook.failMode,
      notes: hook.notes,
    })),
  );
}

export const INTEGRATIONS: IntegrationRecord[] = [
  ...runtimeRecords(),
  {
    id: "code:console:run-command", title: "Консоль — команды встроенного агента",
    purpose: "Проверяет shell-команды, которые встроенный агент запускает через run_command.",
    protects: "Рабочую папку и системные ресурсы от опасных команд из диалога.",
    kind: "code", source: "apps/console/src/core/agentTools.ts", marker: ".guardrails/src/cli.ts", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Сбой проверки запрещает команду.",
  },
  {
    id: "code:console:lifecycle-hook", title: "Консоль — хуки жизненного цикла",
    purpose: "Проверяет команды установки, удаления, включения и выключения навыков, MCP, плагинов и инструментов.",
    protects: "Проект и компьютер от опасной команды в стороннем манифесте.",
    kind: "code", source: "apps/console/src/core/lifecycleHooks.ts", marker: ".guardrails/src/cli.ts", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Install/remove/enable/disable hooks.",
  },
  {
    id: "code:console:model-wrapper", title: "Консоль — guard на вызовах моделей",
    purpose: "Обёртка chatModelForProvider: блокирует инъекции инструкций в промпте и редактирует персональные данные и секреты в промпте и ответе модели.",
    protects: "Персональные данные, секреты и коммерческие маркеры от утечки в LLM-провайдеров; контекст диалога от инъекций.",
    kind: "code", source: "apps/console/src/core/langchain/chatModel.ts", marker: "withLlmGuard", bundles: ["llm-io"], expectedFailureMode: "closed", notes: "Единая точка сборки LangChain-моделей; обёртка сохраняет интерфейс модели, включая bindTools.",
  },
  {
    id: "git:husky:pre-commit", title: "Git — проверка перед commit",
    purpose: "Проверяет целостность каталога и подключений до создания commit.",
    protects: "Репозиторий от commit с рассинхронизированными правилами или документацией.",
    kind: "git-hook", source: ".husky/pre-commit", marker: ".guardrails/src/cli.ts check --quick", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Быстрая локальная проверка.",
  },
  {
    id: "git:husky:content-scan", title: "Git - скан содержимого перед commit",
    purpose: "Сканирует добавленные строки staged diff на секреты и персональные данные.",
    protects: "Репозиторий от commit с ключами, токенами и персональными данными.",
    kind: "git-hook", source: ".husky/pre-commit", marker: "scan-diff", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Секреты блокируют commit, персональные данные дают предупреждение.",
  },
  {
    id: "git:husky:pre-push", title: "Git — проверка перед push",
    purpose: "Выполняет полный policy check и тесты перед отправкой изменений пользователем.",
    protects: "Удалённый репозиторий от непроверенной политики.",
    kind: "git-hook", source: ".husky/pre-push", marker: ".guardrails/src/cli.ts check", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Агенту push запрещён; хук предназначен для пользователя.",
  },
  {
    id: "verification:fast", title: "Общая быстрая верификация",
    purpose: "Включает Guardrails в обязательную проверку после изменений.",
    protects: "От незамеченной поломки правил при обычной разработке.",
    kind: "verification", source: "tooling/scripts/src/verify.ts", marker: ".guardrails/src/cli.ts", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Команда verify-fast.",
  },
  {
    id: "ci:guardrails", title: "CI — независимая проверка Guardrails",
    purpose: "Повторяет проверку каталога и тестов в GitHub Actions.",
    protects: "Основную ветку от изменений, которые обошли локальные хуки.",
    kind: "ci", source: ".github/workflows/guardrails.yml", marker: "bun .guardrails/src/cli.ts check", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Запускается для pull request и main.",
  },
  {
    id: "ci:guardrails:content-scan", title: "CI - скан содержимого diff",
    purpose: "Сканирует добавленные строки diff pull request на секреты и персональные данные.",
    protects: "Основную ветку от утечки значений, пропущенных локальными хуками.",
    kind: "ci", source: ".github/workflows/guardrails.yml", marker: "scan-diff", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Запускается для pull request.",
  },
  {
    id: "verification:security-content-scan", title: "Верификация - скан рабочего diff",
    purpose: "Включает скан содержимого в verify-security.",
    protects: "От записи секретов в коммит до публикации.",
    kind: "verification", source: "tooling/scripts/src/verify.ts", marker: "scan-diff", bundles: ["baseline"], expectedFailureMode: "closed", notes: "Команда verify-security.",
  },
];
