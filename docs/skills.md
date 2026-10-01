# Навыки

Навык - процедурное знание для агента (`SKILL.md` с frontmatter name/description). Консоль различает три уровня и никогда не изменяет файлы навыков: все тогглы - оверлеи в `state.json` (подробнее: [architecture.md](architecture.md)).

## Уровни (вкладка "Навыки и скрипты" в пространстве рантайма)

| Под-вкладка | Источник | Что там |
|---|---|---|
| Runtime Skills | собственные каталоги рантайма (`~/.claude/skills`, кэш плагинов ZCode, `~/.cursor/skills-cursor`, `~/.codex/skills`, `extra_skill_dirs` Kimi) | глобальные навыки рантайма |
| Harness Skills | `<repo>/.agents/skills/<slug>/SKILL.md` | навыки уровня репозитория (в т.ч. установленные из skills.sh) |
| Scripts | агенты/скрипты рантаймов (`~/.config/opencode/agents/*.md`, проектные плагины `.opencode/plugins/*.ts`, `~/.codex/prompts`) | не-скиллы: агенты, плагины, промпты |
| MCP | серверы реестра для этого рантайма | per-runtime overrides MCP ([mcp.md](mcp.md)) |

## Семантика тогглов

```
effective(навык, рантайм R) =
    runtimeOverrides[навык][R]   // тоггл в пространстве рантайма
    ?? defaults[навык]           // per-skill значение по умолчанию (страница "Навыки")
    ?? useGlobal                 // глобальный toggle "Использовать глобальные навыки"
```

- Глобальный toggle - база: включён → все глобальные навыки во всех рантаймах включены; выключен - отключены.
- Per-skill значение по умолчанию (в списке "Установленные harness-навыки") - действует для всех рантаймов.
- Override рантайма - самый сильный; снимается кнопкой "сброс".
- Порядок применения всегда "сначала файл состояния, потом UI".

## skills.sh: поиск

`bunx skills find <query>` (HTTP API skills.sh требует Vercel OIDC-токен - поэтому CLI основной). Вывод (не-TTY, ANSI-чистый) парсится `core/skillsFind.ts`:

```
owner/repo@skill-name  737.7K installs
└ https://skills.sh/owner/repo/skill-name
```

`id` для установки - `owner/repo@skill`; URL показывается ссылкой. Кеш поиска 60 с; HTTP-фолбэк дополняет результат при < 3 находок.

## skills.sh: установка

`bunx skills add <pkg> -y` (DISABLE_TELEMETRY=1, cwd=корень репо) кладёт навык в **`.agents/skills/<name>`**, делает симлинки в найденные каталоги агентов и пишет `skills-lock.json`. Вывод стримится в UI по SSE (ANSI-чистка), ввод можно передать в stdin (роуты `install` / `install?jobId=` / `install/input`).

Перед установкой - модалка: описание + аудит безопасности и кнопки "Установить/Отмена". Цепочка описания (`core/skillsSh.ts`, кеш 5 мин):

1. снапшот реестра skills.sh (если есть `VERCEL_OIDC_TOKEN`);
2. og:description со страницы навыка `https://skills.sh/<source>/<skill>`;
3. страница репозитория GitHub;
4. DeepWiki;
5. если пусто - iframe со страницей навыка + ссылка "открыть в новой вкладке".

Аудит - `/api/v1/skills/audit/...` (Gen Agent Trust Hub, Socket, Snyk, Runlayer, ZeroLeaks; без токена может быть пуст).

## skills.sh: удаление

`bunx skills remove <name> -y` (чистит `.agents/skills/<name>`, lock-запись, симлинки агентов); если CLI не справился - ручная зачистка тех же мест (`core/skillRemove.ts`). В UI - кнопка "удалить" с подтверждением.

## Создание навыка

Форма (название, краткое описание, подробности, примеры) → промпт-билдер `core/skills/create` → запуск в новой headless-сессии рантайма задачи "Создание навыка" (настройки или ★, см. [operations.md](operations.md)). Промпт требует использовать skill-creator-навык агента (если есть) и класть файлы в `.agents/skills/<slug>/SKILL.md`; сессия появляется в общем списке сессий ([sessions.md](sessions.md)).
