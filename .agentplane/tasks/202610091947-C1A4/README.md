---
id: "202610091947-C1A4"
title: "Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний"
status: "TODO"
priority: "normal"
owner: "HARNESS"
revision: 1
origin:
  system: "manual"
depends_on: []
tags:
  - "harness"
  - "backlog"
verify: []
plan_approval:
  state: "pending"
  updated_at: null
  updated_by: null
  note: null
verification:
  state: "pending"
  updated_at: null
  updated_by: null
  note: null
  attempts: 0
comments: []
doc_version: 3
doc_updated_at: "2026-10-09T19:47:01.660Z"
doc_updated_by: "HARNESS"
description: "Сообщение при block/warn вместо молчаливого отказа: сработавший ruleId, человекочитаемая причина, ссылка на описание правила или политики; block, warn и manual различимы иконкой и текстом, не только цветом; manual-решения помечены. Трассировка: Ф6→H2←T6 (S3, гипотеза — старт после гейта; базовый фон: 67 решений аудита — 36 block / 24 allow / 7 warn, 12 живых решений run-command, shell.rm-rf-root 12 раз). Проверка (DoD): на выборке events.jsonl каждое блокирующее сообщение содержит ruleId и причину; различимость состояний без опоры на цвет подтверждена (AC Ф6 1–3); метрика снижения повторных попыток той же команды — после релиза при верифицированном baseline (AC4). Зависимости: валидация гипотез; данные уже в events.jsonl — презентационный слой."
sections:
  Summary: |-
    Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний

    Сообщение при block/warn вместо молчаливого отказа: сработавший ruleId, человекочитаемая причина, ссылка на описание правила или политики; block, warn и manual различимы иконкой и текстом, не только цветом; manual-решения помечены. Трассировка: Ф6→H2←T6 (S3, гипотеза — старт после гейта; базовый фон: 67 решений аудита — 36 block / 24 allow / 7 warn, 12 живых решений run-command, shell.rm-rf-root 12 раз). Проверка (DoD): на выборке events.jsonl каждое блокирующее сообщение содержит ruleId и причину; различимость состояний без опоры на цвет подтверждена (AC Ф6 1–3); метрика снижения повторных попыток той же команды — после релиза при верифицированном baseline (AC4). Зависимости: валидация гипотез; данные уже в events.jsonl — презентационный слой.
  Scope: |-
    - In scope: Сообщение при block/warn вместо молчаливого отказа: сработавший ruleId, человекочитаемая причина, ссылка на описание правила или политики; block, warn и manual различимы иконкой и текстом, не только цветом; manual-решения помечены. Трассировка: Ф6→H2←T6 (S3, гипотеза — старт после гейта; базовый фон: 67 решений аудита — 36 block / 24 allow / 7 warn, 12 живых решений run-command, shell.rm-rf-root 12 раз). Проверка (DoD): на выборке events.jsonl каждое блокирующее сообщение содержит ruleId и причину; различимость состояний без опоры на цвет подтверждена (AC Ф6 1–3); метрика снижения повторных попыток той же команды — после релиза при верифицированном baseline (AC4). Зависимости: валидация гипотез; данные уже в events.jsonl — презентационный слой.
    - Out of scope: unrelated refactors not required for "Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний". Expected: the visible result matches ## Summary and stays inside approved scope.
    2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
    3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.
  Verification: |-
    <!-- BEGIN VERIFICATION RESULTS -->
    <!-- END VERIFICATION RESULTS -->
  Rollback Plan: |-
    - Revert task-related commit(s).
    - Re-run required checks to confirm rollback safety.
  Findings: ""
id_source: "explicit"
---
## Summary

Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний

Сообщение при block/warn вместо молчаливого отказа: сработавший ruleId, человекочитаемая причина, ссылка на описание правила или политики; block, warn и manual различимы иконкой и текстом, не только цветом; manual-решения помечены. Трассировка: Ф6→H2←T6 (S3, гипотеза — старт после гейта; базовый фон: 67 решений аудита — 36 block / 24 allow / 7 warn, 12 живых решений run-command, shell.rm-rf-root 12 раз). Проверка (DoD): на выборке events.jsonl каждое блокирующее сообщение содержит ruleId и причину; различимость состояний без опоры на цвет подтверждена (AC Ф6 1–3); метрика снижения повторных попыток той же команды — после релиза при верифицированном baseline (AC4). Зависимости: валидация гипотез; данные уже в events.jsonl — презентационный слой.

## Scope

- In scope: Сообщение при block/warn вместо молчаливого отказа: сработавший ruleId, человекочитаемая причина, ссылка на описание правила или политики; block, warn и manual различимы иконкой и текстом, не только цветом; manual-решения помечены. Трассировка: Ф6→H2←T6 (S3, гипотеза — старт после гейта; базовый фон: 67 решений аудита — 36 block / 24 allow / 7 warn, 12 живых решений run-command, shell.rm-rf-root 12 раз). Проверка (DoD): на выборке events.jsonl каждое блокирующее сообщение содержит ruleId и причину; различимость состояний без опоры на цвет подтверждена (AC Ф6 1–3); метрика снижения повторных попыток той же команды — после релиза при верифицированном baseline (AC4). Зависимости: валидация гипотез; данные уже в events.jsonl — презентационный слой.
- Out of scope: unrelated refactors not required for "Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Объяснение блокировки guardrail: причина, ссылка на политику, различимость состояний". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
