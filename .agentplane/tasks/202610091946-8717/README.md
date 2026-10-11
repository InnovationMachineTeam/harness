---
id: "202610091946-8717"
title: "Диалог «уже выполняется»: ждать / отправить всё равно / отменить"
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
doc_updated_at: "2026-10-09T19:46:57.951Z"
doc_updated_by: "HARNESS"
description: "При совпадении сигнатуры с активной задачей — до создания новой задачи явный выбор: ждать / отправить всё равно / отменить; «отмена» не создаёт задачу; «отправить всё равно» помечает дубль маркером «осознанный» в логе. Трассировка: Ф4→N4 (S2, S3). Проверка (DoD): все три ветки воспроизводимы; осознанный дубль виден в логе по маркеру; непомеченные дубли дорогих запусков отсутствуют в новых логах (AC Ф4 2, 3, 5). Зависимости: нормализованные сигнатуры."
sections:
  Summary: |-
    Диалог «уже выполняется»: ждать / отправить всё равно / отменить

    При совпадении сигнатуры с активной задачей — до создания новой задачи явный выбор: ждать / отправить всё равно / отменить; «отмена» не создаёт задачу; «отправить всё равно» помечает дубль маркером «осознанный» в логе. Трассировка: Ф4→N4 (S2, S3). Проверка (DoD): все три ветки воспроизводимы; осознанный дубль виден в логе по маркеру; непомеченные дубли дорогих запусков отсутствуют в новых логах (AC Ф4 2, 3, 5). Зависимости: нормализованные сигнатуры.
  Scope: |-
    - In scope: При совпадении сигнатуры с активной задачей — до создания новой задачи явный выбор: ждать / отправить всё равно / отменить; «отмена» не создаёт задачу; «отправить всё равно» помечает дубль маркером «осознанный» в логе. Трассировка: Ф4→N4 (S2, S3). Проверка (DoD): все три ветки воспроизводимы; осознанный дубль виден в логе по маркеру; непомеченные дубли дорогих запусков отсутствуют в новых логах (AC Ф4 2, 3, 5). Зависимости: нормализованные сигнатуры.
    - Out of scope: unrelated refactors not required for "Диалог «уже выполняется»: ждать / отправить всё равно / отменить".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Диалог «уже выполняется»: ждать / отправить всё равно / отменить". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Диалог «уже выполняется»: ждать / отправить всё равно / отменить". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Диалог «уже выполняется»: ждать / отправить всё равно / отменить

При совпадении сигнатуры с активной задачей — до создания новой задачи явный выбор: ждать / отправить всё равно / отменить; «отмена» не создаёт задачу; «отправить всё равно» помечает дубль маркером «осознанный» в логе. Трассировка: Ф4→N4 (S2, S3). Проверка (DoD): все три ветки воспроизводимы; осознанный дубль виден в логе по маркеру; непомеченные дубли дорогих запусков отсутствуют в новых логах (AC Ф4 2, 3, 5). Зависимости: нормализованные сигнатуры.

## Scope

- In scope: При совпадении сигнатуры с активной задачей — до создания новой задачи явный выбор: ждать / отправить всё равно / отменить; «отмена» не создаёт задачу; «отправить всё равно» помечает дубль маркером «осознанный» в логе. Трассировка: Ф4→N4 (S2, S3). Проверка (DoD): все три ветки воспроизводимы; осознанный дубль виден в логе по маркеру; непомеченные дубли дорогих запусков отсутствуют в новых логах (AC Ф4 2, 3, 5). Зависимости: нормализованные сигнатуры.
- Out of scope: unrelated refactors not required for "Диалог «уже выполняется»: ждать / отправить всё равно / отменить".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Диалог «уже выполняется»: ждать / отправить всё равно / отменить". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Диалог «уже выполняется»: ждать / отправить всё равно / отменить". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
