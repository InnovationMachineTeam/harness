# Gates: интеграция <имя ветки>

Scope: собрать детей <явные идентификаторы детей> в один верифицированный результат

- [ ] N1: каждый названный прямой ребёнок реверифицирован по его точному реестру
  CHECK: node <skill-dir>/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 1 .agents/.tmp/unlazy/<scope>/gates/leaf-<a>.md .agents/.tmp/unlazy/<scope>/gates/node-<b>.md
  EXPECT: ALL MET
  EVIDENCE: pending

- [ ] N2: интерфейсы детей совпадают с контрактом в PLAN.md
  CHECK: node scripts/verify-interfaces.mjs
  EXPECT: interface verification passed
  EVIDENCE: pending

- [ ] N3: поведение между детьми работает сквозным образом
  CHECK: node scripts/verify-integration.mjs
  EXPECT: integration verification passed
  EVIDENCE: pending

- [ ] N4: поведение затронутых соседей не деградировало
  CHECK: node scripts/verify-regressions.mjs
  EXPECT: regression verification passed
  EVIDENCE: pending

- [ ] N5: lease владения каждого прямого листа-ребёнка освобождён после верификации родителя
  EVIDENCE: pending

- [ ] N6: существенные ручные исходы детей проверены на уровне ветки
  EVIDENCE: pending

<!--
Замени каждый плейсхолдер до запуска чекера.

N1 называет каждый прямой детский реестр явно - лист это или другая ветка - и
использует --reverify, а не --status: статус валидирует сохранённую привязку
определения без исполнения и без инспекции текущих артефактов. Держи
--jobs 1, если детские проверки не независимы и параллельное исполнение не
намеренно.

Если ребёнок сообщает отказ, N1 завершается с 1 и HANDOFF REQUIRED. Пометь
ветку ABANDONED и покажи передачу; никогда не переписывай этот результат как
завершение.

Пути веток - node-<id>.md. Пути листьев - leaf-<id>.md. Завершение ветки
требует интеграционных доказательств; набора локально завершённых листьев
недостаточно.

Для N5 исполни по одному разу на каждого прямого листа-ребёнка после
верификации и запиши выводы как ручные доказательства. Дети веток не владеют
leases листьев:

node <skill-dir>/scripts/gate-check.mjs --scope <scope> --leaf leaf-<id> --release

Убери N5, только когда ни один ребёнок не запрашивал владение. См.
references/orchestration.md и references/parallel.md.
-->
