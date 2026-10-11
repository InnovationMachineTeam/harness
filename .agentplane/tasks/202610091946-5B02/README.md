---
id: "202610091946-5B02"
title: "Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)"
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
doc_updated_at: "2026-10-09T19:46:59.432Z"
doc_updated_by: "HARNESS"
description: "Пересчёт скриптами по снапшоту логов (315 задач, 67 guardrail-решений, 2000 usage-записей, 23 смоук-промпта) двумя независимыми способами: доля model-вопросов (базовая 25 из 304 промпт-задач), failed 63/315, history-запросы (10), дубли дорогих запусков (3), guardrail-решения 36 block / 24 allow / 7 warn, потребление opus-5-5 (10 925 вызовов, 9,34 млн токенов); публикация верифицированных baseline для метрик приёмки. Трассировка: обслуживающая задача для проверяемости AC Ф1/Ф2/Ф5/Ф6; закрывает Q8/R5 — до закрытия частоты не используются как доказательство за пределами выборки. Проверка (DoD): два метода сходятся (расхождение менее 5% или объяснено); baseline зафиксированы и ссылаются из AC-метрик. Зависимости: нет."
sections:
  Summary: |-
    Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)

    Пересчёт скриптами по снапшоту логов (315 задач, 67 guardrail-решений, 2000 usage-записей, 23 смоук-промпта) двумя независимыми способами: доля model-вопросов (базовая 25 из 304 промпт-задач), failed 63/315, history-запросы (10), дубли дорогих запусков (3), guardrail-решения 36 block / 24 allow / 7 warn, потребление opus-5-5 (10 925 вызовов, 9,34 млн токенов); публикация верифицированных baseline для метрик приёмки. Трассировка: обслуживающая задача для проверяемости AC Ф1/Ф2/Ф5/Ф6; закрывает Q8/R5 — до закрытия частоты не используются как доказательство за пределами выборки. Проверка (DoD): два метода сходятся (расхождение менее 5% или объяснено); baseline зафиксированы и ссылаются из AC-метрик. Зависимости: нет.
  Scope: |-
    - In scope: Пересчёт скриптами по снапшоту логов (315 задач, 67 guardrail-решений, 2000 usage-записей, 23 смоук-промпта) двумя независимыми способами: доля model-вопросов (базовая 25 из 304 промпт-задач), failed 63/315, history-запросы (10), дубли дорогих запусков (3), guardrail-решения 36 block / 24 allow / 7 warn, потребление opus-5-5 (10 925 вызовов, 9,34 млн токенов); публикация верифицированных baseline для метрик приёмки. Трассировка: обслуживающая задача для проверяемости AC Ф1/Ф2/Ф5/Ф6; закрывает Q8/R5 — до закрытия частоты не используются как доказательство за пределами выборки. Проверка (DoD): два метода сходятся (расхождение менее 5% или объяснено); baseline зафиксированы и ссылаются из AC-метрик. Зависимости: нет.
    - Out of scope: unrelated refactors not required for "Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)

Пересчёт скриптами по снапшоту логов (315 задач, 67 guardrail-решений, 2000 usage-записей, 23 смоук-промпта) двумя независимыми способами: доля model-вопросов (базовая 25 из 304 промпт-задач), failed 63/315, history-запросы (10), дубли дорогих запусков (3), guardrail-решения 36 block / 24 allow / 7 warn, потребление opus-5-5 (10 925 вызовов, 9,34 млн токенов); публикация верифицированных baseline для метрик приёмки. Трассировка: обслуживающая задача для проверяемости AC Ф1/Ф2/Ф5/Ф6; закрывает Q8/R5 — до закрытия частоты не используются как доказательство за пределами выборки. Проверка (DoD): два метода сходятся (расхождение менее 5% или объяснено); baseline зафиксированы и ссылаются из AC-метрик. Зависимости: нет.

## Scope

- In scope: Пересчёт скриптами по снапшоту логов (315 задач, 67 guardrail-решений, 2000 usage-записей, 23 смоук-промпта) двумя независимыми способами: доля model-вопросов (базовая 25 из 304 промпт-задач), failed 63/315, history-запросы (10), дубли дорогих запусков (3), guardrail-решения 36 block / 24 allow / 7 warn, потребление opus-5-5 (10 925 вызовов, 9,34 млн токенов); публикация верифицированных baseline для метрик приёмки. Трассировка: обслуживающая задача для проверяемости AC Ф1/Ф2/Ф5/Ф6; закрывает Q8/R5 — до закрытия частоты не используются как доказательство за пределами выборки. Проверка (DoD): два метода сходятся (расхождение менее 5% или объяснено); baseline зафиксированы и ссылаются из AC-метрик. Зависимости: нет.
- Out of scope: unrelated refactors not required for "Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Независимый пересчёт baseline-метрик снапшота логов (долг V3/Q8)". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
