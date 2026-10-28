# AG-UI endpoint: Harness как агент-бэкенд

Консоль отдаёт endpoint протокола [AG-UI 1.0](https://docs.ag-ui.com/) (HTTP SSE binding): внешние приложения подключают агентов Harness по принципу bring-your-own-agent. Основной потребитель - [CopilotKit OpenBot](https://github.com/CopilotKit/openbot) и построенные на нём OpenDuet/OpenMuse: их бот получает мозгом любой рантайм Harness (claude, codex, zcode и остальные) или провайдера реестра, а Harness остаётся полностью локальным.

## Включение и авторизация

1. Консоль → "Настройки → Основные" → панель "AG-UI endpoint": включить тумблер. Токен Bearer создаётся автоматически (32 символа, регенерация - кнопкой; хранится в `state.agui` вне git).
2. Панель показывает адрес (`http://<хост>:3000/api/agui`) и готовый заголовок `Authorization: Bearer <токен>` для копирования во внешнее приложение.

Выключенный endpoint отвечает `403`; неверный токен - `401`. Ошибки до старта стрима (валидация тела, неактивный провайдер, неизвестный рантайм) возвращаются HTTP-кодом с JSON-телом; ошибки во время прогона - событием `RUN_ERROR` в стриме.

## Контракт

Запрос: `POST /api/agui`, `Content-Type: application/json`, заголовок `Accept: text/event-stream`:

```json
{
  "threadId": "строка-идентификатор треда",
  "runId": "строка-идентификатор прогона",
  "messages": [ { "id": "m1", "role": "user", "content": "текст" } ],
  "context": { "executor": "claude", "tier": "standard", "effort": "max" }
}
```

Ответ: `200 text/event-stream`; каждый кадр - `data: <json>\n\n` с ровно одним объектом события. Гарантированные границы: `RUN_STARTED` первым, `RUN_FINISHED` или `RUN_ERROR` последним. Текст стримится триадой `TEXT_MESSAGE_START/CONTENT/END`; вызовы серверных инструментов - `TOOL_CALL_START/ARGS/END` (аргументы целиком, стриминга аргументов нет) и `TOOL_CALL_RESULT`.

Поля `context` (все необязательны):

| Поле | Значение | По умолчанию |
|---|---|---|
| `executor` | id рантайма, `provider` или `provider:<id>` | исполнитель промтов из настроек (★), иначе провайдер по умолчанию |
| `tier` | `fast` / `standard` / `strong` / `subagents` | `standard` |
| `effort` | `low` / `medium` / `high` / `max` | thinkingLevel модели tier |

Рабочая папка прогона - всегда корень репозитория Harness (v1). Диалог треда дописывается в историю direct-чатов (`direct-agui-<threadId>`) и виден в списке чатов вкладки "Агент".

Ограничения v1: только серверные инструменты (клиентские frontend-инструменты AG-UI не поддерживаются - цикл не приостанавливается на внешние вызовы), нет resume (обрыв соединения не возобновляется - клиент повторяет прогон с новым `runId`), data-spec части json-render не транслируются.

## Подключение к OpenBot

В OpenBot бот регистрируется как удалённый AG-UI-агент (tenant-пакет `agents.yaml` или админка `/bots`): тип - custom AG-UI endpoint, URL - адрес из панели, заголовок авторизации - `Authorization: Bearer <токен>` (write-only с точки зрения OpenBot - токен не возвращается обратно). Дальше OpenBot гоняет собственную политику и аудит поверх вызовов; вызовы инструментов исполняются на стороне Harness под guard-политикой Harness (включая run_command через guard и исключения политики).

Проверка curl'ом:

```bash
curl -N -X POST http://127.0.0.1:3000/api/agui \
  -H "Authorization: Bearer <токен>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"threadId":"smoke","messages":[{"id":"m1","role":"user","content":"статус один строкой"}]}'
```

## Реализация

| Файл | Роль |
|---|---|
| `apps/console/src/core/agui/adapter.ts` | Преобразование UIChunk-стрима direct-чата в события AG-UI; конвертация сообщений; отображение threadId в id direct-чата |
| `apps/console/src/app/api/agui/route.ts` | Endpoint: авторизация, выбор исполнителя, графы провайдера/рантайма, SSE-обертка, запись истории |
| `apps/console/src/app/api/agui/config/route.ts` | Управление включением и токеном |
| `apps/console/src/uikit/components/settings/AguiEndpointPanel.tsx` | Панель настроек |

Провайдерская ветка повторяет direct-чат (граф "model"-"tools", `core/agent/chatGraph.ts`), но без json-render-трансформации; рантаймная ветка запускает headless-CLI (`launchPromptRun`) и стримит отфильтрованный лог. Каждый провайдерский прогон регистрируется в "Мониторинг → Задачи".
