"use client";

import { useEffect, useState } from "react";
import { Modal, Tabs } from "@/uikit";

/**
 * Модальное окно последствий жизненного цикла сущности (навык, MCP-сервер,
 * плагин, инструмент): четыре вкладки - установка, включение, выключение,
 * удаление. В каждой - что происходит, какие части системы затрагиваются и
 * какие хуки объявлены. Общие константы исполнения: команды хуков проходят
 * guard-проверку репозитория (отказ - exit 2), cwd - обязательная рабочая
 * папка (write mode), если у сущности нет своего каталога; таймаут 60 с.
 */

export interface LifecycleOpInfo {
  /** Что происходит при операции. */
  steps: string[];
  /** Затрагиваемые части системы. */
  affected: string[];
  /** Объявленные хуки (команды); пустой список - выполняются только встроенные операции. */
  hooks: string[];
}

export interface LifecycleInfo {
  domain: string;
  name: string;
  install: LifecycleOpInfo;
  enable: LifecycleOpInfo;
  disable: LifecycleOpInfo;
  remove: LifecycleOpInfo;
}

type LifecycleOp = "install" | "enable" | "disable" | "remove";

const OPS: readonly { key: LifecycleOp; label: string }[] = [
  { key: "install", label: "Установка" },
  { key: "enable", label: "Включение" },
  { key: "disable", label: "Выключение" },
  { key: "remove", label: "Удаление" },
];

export function LifecycleInfoModal({ open, onClose, info }: { open: boolean; onClose: () => void; info: LifecycleInfo }) {
  const [tab, setTab] = useState<LifecycleOp>("install");
  useEffect(() => {
    if (open) setTab("install");
  }, [open]);
  const content: LifecycleOpInfo = info[tab];
  return (
    <Modal open={open} onClose={onClose} title={`Жизненный цикл: ${info.domain} «${info.name}»`} width="max-w-3xl">
      <Tabs tabs={OPS} active={tab} onChange={setTab} size="sm" />
      <div className="mt-3 space-y-3 text-xs leading-relaxed">
        <section>
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Что происходит</h4>
          <ul className="list-disc space-y-1 pl-4">
            {content.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Затрагиваемые части системы</h4>
          <ul className="list-disc space-y-1 pl-4 font-mono text-[11px]">
            {content.affected.map((part) => (
              <li key={part}>{part}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Хуки</h4>
          {content.hooks.length ? (
            <ul className="list-disc space-y-1 pl-4 font-mono text-[11px]">
              {content.hooks.map((hook) => (
                <li key={hook}>{hook}</li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-faint">хуки не заданы - выполняются только встроенные операции консоли</p>
          )}
        </section>
        <p className="text-[10px] text-fg-faint">
          Команды хуков перед исполнением проходят guard-политику репозитория (отказ - exit 2, запись в лог);
          рабочий каталог - обязательная рабочая папка либо каталог сущности; таймаут команды - 60 с.
        </p>
      </div>
    </Modal>
  );
}

type PartialHooks = { install?: string[]; remove?: string[]; enable?: string[]; disable?: string[] } | null | undefined;

const hooksOf = (hooks: PartialHooks, op: LifecycleOp): string[] =>
  (hooks?.[op] ?? []).map((command) => `\`$ ${command}\``);

/* ------------------------------ навыки ------------------------------ */

export function skillLifecycleInfo(item: {
  label: string;
  name: string;
  manifestHooks?: PartialHooks;
  itemId?: string;
}): LifecycleInfo {
  const runtimeDirs = "симлинки каталогов агентов (.claude, .cursor, .codex, .opencode, .zcode)";
  if (item.label === "skills.sh" || item.label === "plugin") {
    return {
      domain: "Навык (skills.sh)",
      name: item.name,
      install: {
        steps: [
          "bunx skills add кладёт пакет в .agents/skills/<имя>, создаёт симлинки в найденных каталогах агентов и пишет skills-lock.json.",
          "После установки выполняется hook install (если объявлен).",
        ],
        affected: [".agents/skills/<имя>", "skills-lock.json", runtimeDirs],
        hooks: hooksOf(item.manifestHooks, "install"),
      },
      enable: {
        steps: [
          "Toggle задаёт значение по умолчанию (уровень настроек) или override рантайма - запись в state.skills.",
          "Для рантаймов с изменившимся effective создаётся симлинк .<runtime>/skills/<имя> в обязательной рабочей папке, затем hook enable.",
        ],
        affected: ["state.skills (defaults / runtimeOverrides)", ".<runtime>/skills/<имя> (обязательная рабочая папка)", ".agents/console/skill-hooks.log"],
        hooks: hooksOf(item.manifestHooks, "enable"),
      },
      disable: {
        steps: [
          "Значение в state.skills снимается; для рантаймов с изменившимся effective симлинк удаляется (только если указывает на каталог навыка), затем hook disable.",
          "Файлы самого навыка не изменяются.",
        ],
        affected: ["state.skills", ".<runtime>/skills/<имя> (симлинк)", ".agents/console/skill-hooks.log"],
        hooks: hooksOf(item.manifestHooks, "disable"),
      },
      remove: {
        steps: [
          "Перед удалением выполняется hook remove.",
          "bunx skills remove убирает каталог, lock-запись и симлинки агентов; при неудаче - ручная зачистка тех же мест.",
          "Действие необратимо: навык можно вернуть повторной установкой.",
        ],
        affected: [".agents/skills/<имя>", "skills-lock.json", runtimeDirs],
        hooks: hooksOf(item.manifestHooks, "remove"),
      },
    };
  }
  if (item.label === "workflow") {
    return {
      domain: "Workflow",
      name: item.name,
      install: { steps: ["Установка не требуется: определение читается из мастер-каталога workflow при запуске."], affected: [".agents/skills/master/workflows"], hooks: [] },
      enable: { steps: ["Тоггла нет: запуск и остановка управляются workflow (прогоны, команды start/cancel)."], affected: ["прогоны workflow (.agents/console/tasks/<run-id>)"], hooks: [] },
      disable: { steps: ["Тоггла нет: отключение - удаление или disabled-узлы в определении workflow."], affected: [".agents/skills/master/workflows"], hooks: [] },
      remove: { steps: ["Удаление - через редактор workflow (файл определения)."], affected: [".agents/skills/master/workflows"], hooks: [] },
    };
  }
  // internal (и design): мастер-каталог / внутренний каталог с манифестом
  return {
    domain: "Навык internal",
    name: item.name,
    install: {
      steps: ["Навык уже в каталоге - отдельная установка не требуется; каталог читается загрузчиком (manifest.yaml + SKILL.md)."],
      affected: ["мастер-каталог навыков (privateSkillRoot)"],
      hooks: hooksOf(item.manifestHooks, "install"),
    },
    enable: {
      steps: [
        "Toggle записывает значение в state.skills; для рантаймов с изменившимся effective создаётся симлинк .<runtime>/skills/<имя> в обязательной рабочей папке, затем hook enable.",
        "Включённый навык обрабатывается рантаймом нативно (симлинк) и раскрывается консолью (/master:<id>); привязка - manifest.runtimes.",
      ],
      affected: ["state.skills (defaults / runtimeOverrides)", ".<runtime>/skills/<имя> (обязательная рабочая папка)", ".agents/console/skill-hooks.log"],
      hooks: hooksOf(item.manifestHooks, "enable"),
    },
    disable: {
      steps: [
        "Значение снимается; симлинк удаляется (только если указывает на каталог навыка), затем hook disable.",
        "Выключенный навык обрабатывается только раскрытием консоли и скрывается из slash-меню для исполнителя.",
      ],
      affected: ["state.skills", ".<runtime>/skills/<имя> (симлинк)", ".agents/console/skill-hooks.log"],
      hooks: hooksOf(item.manifestHooks, "disable"),
    },
    remove: {
      steps: ["Удаление каталога из мастер-каталога - вручную или через сессию навыка; до удаления выполняется hook remove, если объявлен."],
      affected: ["мастер-каталог навыков", "ссылки в roles (skills frontmatter) - роль потеряет навык"],
      hooks: hooksOf(item.manifestHooks, "remove"),
    },
  };
}

/* ------------------------------ MCP ------------------------------ */

export function mcpLifecycleInfo(server: { name: string; hooks?: PartialHooks }): LifecycleInfo {
  const targets = ["state.mcp.servers (реестр)", "проектный .mcp.json", "пользовательские конфиги claude/codex/cursor/opencode (kimi, zcode - проектный .mcp.json)"];
  return {
    domain: "MCP-сервер",
    name: server.name,
    install: {
      steps: [
        "Сервер добавляется в глобальный реестр включённым и сразу синкается во все таргеты.",
        "После добавления выполняется hook install (если объявлен).",
      ],
      affected: targets,
      hooks: hooksOf(server.hooks, "install"),
    },
    enable: {
      steps: ["Глобальный toggle включает сервер в синке: запись появляется в проектном .mcp.json и пользовательских конфигах (с учётом runtimeOverride).", "Выполняется hook enable."],
      affected: targets,
      hooks: hooksOf(server.hooks, "enable"),
    },
    disable: {
      steps: ["Сервер удаляется из файлов синка, запись в реестре сохраняется - вернуть можно одним переключением.", "Выполняется hook disable."],
      affected: targets,
      hooks: hooksOf(server.hooks, "disable"),
    },
    remove: {
      steps: [
        "Перед удалением выполняется hook remove.",
        "Запись удаляется из реестра и всех файлов рантаймов (синк). Действие необратимо: сервер добавляется заново вручную или из пресета.",
      ],
      affected: targets,
      hooks: hooksOf(server.hooks, "remove"),
    },
  };
}

/* ------------------------------ плагины ------------------------------ */

export function pluginLifecycleInfo(plugin: { displayName: string; mcp: string[]; hooks?: PartialHooks }): LifecycleInfo {
  const mcpList = plugin.mcp.length ? plugin.mcp.join(", ") : "-";
  const affected = ["state.plugins.installed", `state.mcp.servers: ${mcpList}`, "файлы рантаймов (синк MCP)"];
  return {
    domain: "Плагин",
    name: plugin.displayName,
    install: {
      steps: ["Плагин записывается в state.plugins.installed и включается.", "Его MCP-серверы добавляются в общий реестр и синкаются во все таргеты.", "После установки выполняется hook install."],
      affected,
      hooks: hooksOf(plugin.hooks, "install"),
    },
    enable: { steps: ["MCP-серверы плагина добавляются в реестр (если их транспорт не менял пользователь) и синкаются.", "Выполняется hook enable."], affected, hooks: hooksOf(plugin.hooks, "enable") },
    disable: { steps: ["MCP-серверы плагина убираются из реестра (защита от удаления чужих правок: транспорт должен совпадать) и из файлов синка.", "Выполняется hook disable."], affected, hooks: hooksOf(plugin.hooks, "disable") },
    remove: {
      steps: ["Перед удалением выполняется hook remove.", "Плагин выключается и запись удаляется; его MCP-серверы убираются из реестра и файлов."],
      affected: ["state.plugins.installed", `state.mcp.servers: ${mcpList}`, "файлы рантаймов (синк MCP)"],
      hooks: hooksOf(plugin.hooks, "remove"),
    },
  };
}

/* ------------------------------ инструменты ------------------------------ */

export function toolLifecycleInfo(tool: {
  title: string;
  hooks?: PartialHooks;
  uninstallStopsDashboard?: boolean;
  hasDashboard?: boolean;
  hasMcpPreset?: boolean;
}): LifecycleInfo {
  const affected = ["state.tools.installed", "tools.env", ...(tool.hasMcpPreset ? ["state.mcp.servers (MCP-пресет инструмента)", "файлы рантаймов (синк MCP)"] : []), "интеграции per-runtime (маркеры/симлинки в каталогах рантаймов)"];
  return {
    domain: "Инструмент",
    name: tool.title,
    install: {
      steps: [
        "Job установки: системный пакет (brew/npm/uv, с учётом выбранного менеджера bun/npm), затем per-runtime интеграции выбранных рантаймов.",
        hasMcpPresetText(tool.hasMcpPreset),
        "После успешной установки выполняется hook install (если объявлен).",
      ],
      affected,
      hooks: hooksOf(tool.hooks, "install"),
    },
    enable: {
      steps: [
        "Toggle пересобирает интеграции выбранного рантайма или включает MCP-пресет в синке (короткий путь - без job).",
        "Выполняется hook enable.",
      ],
      affected,
      hooks: hooksOf(tool.hooks, "enable"),
    },
    disable: {
      steps: [
        "Интеграции рантайма снимаются или MCP-сервер выключается в синке (запись в реестре сохраняется).",
        "Выполняется hook disable.",
      ],
      affected,
      hooks: hooksOf(tool.hooks, "disable"),
    },
    remove: {
      steps: [
        "Перед зачисткой выполняется hook remove.",
        "Снимаются per-runtime интеграции и проектная зачистка (например, rtk project).",
        ...(tool.uninstallStopsDashboard ? ["Автономный инстанс дашборда останавливается, автозапуск сбрасывается."] : []),
        ...(tool.hasMcpPreset ? ["MCP-запись убирается из реестра (только если её добавляла консоль)."] : []),
        "Системный пакет не удаляется - полная очистка вручную командой uninstall менеджера.",
      ],
      affected,
      hooks: hooksOf(tool.hooks, "remove"),
    },
  };
}

function hasMcpPresetText(hasMcpPreset?: boolean): string {
  return hasMcpPreset
    ? "MCP-пресет инструмента добавляется в общий реестр и синкается во все таргеты."
    : "MCP-пресета у инструмента нет - только системный пакет и интеграции.";
}
