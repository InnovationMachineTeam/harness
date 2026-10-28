# Plan: <task>

Scope: <validated pipeline id; store this file at .agents/.tmp/unlazy/<scope>/PLAN.md>
Depth: tree <N>
Mode: orchestrated

## Contract

Decide before fan-out:

- Interfaces: <signatures, schemas, formats, integration points>
- Ownership: <one complete set of repository-relative paths per leaf; no absolute paths, traversal, or concurrent overlap>
- Dependencies: <leaf ids that must be VERIFIED first>
- Host launch mode: <Claude background Agents | ZCode background agents | Harness workflow engine | sequential fallback>
- Wave policy: <which independent READY leaves launch together and the maximum host concurrency>
- Toolchain: <runtime versions, shell, working-directory rules, test commands>
- Conventions: <naming, errors, compatibility, formatting>
- Manual review: <owner and evidence standard for consequential manual gates>

## Current contract inventory

Contract revision: 1. Before fan-out, reread the original request and current amendments. Record every independently omittable required outcome and every constraint that changes acceptance; do not copy credentials, private text, or unrelated context.

| ID | Required outcome or constraint | Owner | Observing gate or manual review | Disposition | Revision |
|---|---|---|---|---|---|
| C1 | <concise paraphrase> | <leaf/node> | <qualified gate/reviewer> | ACTIVE | 1 |

Используй стабильные идентификаторы. По правке пользователя увеличивай ревизию и сверь каждую затронутую строку до нового запуска или зачёта завершения. `ACTIVE` закрыт только при актуальном владельце и наблюдении. `ABANDONED`, `DEFERRED` и `OWNER_DECISION` - честное не-завершение; `REMOVED_BY_USER` применяется только по явному полномочию пользователя.

## State vocabulary

Состояние листа - ровно одно из:

- WAITING: хотя бы один идентификатор в Needs не VERIFIED
- READY: зависимости VERIFIED и владение можно запросить
- IN-FLIGHT: запущен, ещё не верифицирован родителем
- VERIFIED: реверификация родителя пройдена, ручные гейты проверены
- ABANDONED: у требуемого гейта есть видимая передача

Состояние ветки - ровно одно из OPEN, VERIFIED, ABANDONED. Состояния корня и ветки выводятся из их реестров; в дерево топологии они не копируются.

## Tree

Дерево используется только для топологии родитель-ребёнок и путей реестров. Пути листьев - `leaf-`, пути веток - `node-`. Операционные поля листа живут только в таблице диспетчеризации ниже; `Owns`, `Needs`, `Tier`, `Planned wave` и `State` здесь не повторяются, отдельное расписание не создаётся.

- 1 <task> .............. GATES.md
  - 1.1 <branch> ........ gates/node-1.1.md
    - 1.1.1 <leaf> ...... gates/leaf-1.1.1.md
    - 1.1.2 <leaf> ...... gates/leaf-1.1.2.md
  - 1.2 <branch> ........ gates/node-1.2.md
    - 1.2.1 <leaf> ...... gates/leaf-1.2.1.md
    - 1.2.2 <leaf> ...... gates/leaf-1.2.2.md

## Leaf dispatch table

Единственная авторитетная таблица PLAN для операционной работы листа. Она авторитетна для `Needs`, `Tier`, `Planned wave` и `State`; `Owns` остаётся здесь как производное зеркало планирования. Одна строка на каждый лист дерева; эти поля не дублируются в дереве или расписании.

| Leaf | Owns | Needs | Tier | Planned wave | State |
|---|---|---|---|---|---|
| 1.1.1 | src/<a>/**, tests/<a>/** | - | mechanical | 1 | READY |
| 1.1.2 | src/<b>/**, tests/<b>/** | - | judgment | 1 | READY |
| 1.2.1 | src/<c>/**, tests/<c>/** | - | mechanical | 1 | READY |
| 1.2.2 | src/<d>/**, tests/<d>/** | 1.2.1 | judgment | 2 | WAITING |

`Owns` - производное зеркало планирования полного набора globs из реестра листа. Заголовок `OWNS:` реестра - исполнительная инстанция, которую читает `--claim`. Приведи оба к множествам и требуй равенства перед пометкой строки READY и повторно перед каждым claim. При расхождении - отказ закрыто, исправь план или реестр, запиши и проверь снова; владение не угадывается. Успешный claim не доказывает, что зеркало согласовалось с реестром.

`Tier` - метаданные планировщика для исполняющих листьев. `judgment` - когда артефакт листа требует дизайна или ревью; `mechanical` - только когда шаблон и гейты фиксированы. Отображай tier через документированные управления хоста, только когда они доступны (в harness - tier-модели конфига рантайма); иначе сохраняй tier как требование брифинга и ревью, не заявляя выбор модели. Долг драйвера и веток - планирование, диспетчеризация, верификация родителя, интеграция, финальный аудит - остаётся обязанностью суждения вне этого поля листа. Tier никогда не ослабляет гейты листа, реверификацию родителя или стандарт интеграции.

`Planned wave` - самая ранняя намеченная группа запуска при текущем контракте. Положительное целое; каждая зависимость - в более ранней намеченной волне; политика волн ограничивает параллелизм. Это план, не барьер: роллинг-диспетчеризация может запустить позднюю намеченную волну, как только зависимости строки верифицированы, без ожидания несвязанной работы. Фактические старты принадлежат `dispatch.json` и `status.log`; второе расписание в этот файл не добавляется.

`Needs`, `Owns`, `Tier` или `Planned wave` меняются только записанной правкой плана до запуска строки; удовлетворённая зависимость не стирается. `State` обновляется по ходу работы. После реверификации родителя и ручного ревью пометь лист VERIFIED, освободи lease именно этого листа и запиши освобождение. Не повышай зависимый лист, пока не записано освобождение именно его lease. Для брошенного листа запиши передачу и убедись, что воркер завершился, прежде чем освобождать только его; родитель-верифицированным он не называется. Весь скоуп освобождается, только когда все листья завершены и финальная верификация скоупа выполнена. Если финальная верификация сообщает передачу, запиши её до освобождения и не описывай скоуп как завершённый.

## Status log

События дописываются в `.agents/.tmp/unlazy/<scope>/status.log`; история событий в этот файл не копируется:

```text
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 dispatched"
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 verified"
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 lease released"
```

Записывай правки контракта, изменения плана, диспетчеризацию, верификацию родителя, отказы, интеграцию веток и освобождение lease. Записанные правки плана и живые обновления State применяются только в таблице диспетчеризации; журнал - append-only. Перед завершением корня перечитай исходный запрос и просмотри каждую актуальную строку реестра контракта против её владельца и наблюдающего гейта или ручного ревью.
