---
id: "202610091946-3661"
title: "Общий слой метаданных исполнителя хода"
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
doc_updated_at: "2026-10-09T19:46:52.811Z"
doc_updated_by: "HARNESS"
description: "Единый источник метаданных исполнителя для каждого хода чата и каждой задачи: извлечение runtime, модели и sessionId из tasks/*.json и chat.json, нормализация, привязка к ходу, явное состояние unknown при недоступности (не скрытие), фиксация факта смены исполнителя как события для истории. Трассировка: Ф1→N1←T1; слой обслуживает также Ф3→N2 и Ф5→H1; при дескопе Ф1 переатрибутируется первому оставшемуся потребителю. Проверка (DoD): контракт «ход → runtime, модель, sessionId или unknown» доступен UI-слою; на выборке ходов метаданные присутствуют или явно unknown — скрытых пустых состояний нет; смена исполнителя фиксируется. Зависимости: нет; разблокирует бейдж, панель истории и счётчик."
sections:
  Summary: |-
    Общий слой метаданных исполнителя хода

    Единый источник метаданных исполнителя для каждого хода чата и каждой задачи: извлечение runtime, модели и sessionId из tasks/*.json и chat.json, нормализация, привязка к ходу, явное состояние unknown при недоступности (не скрытие), фиксация факта смены исполнителя как события для истории. Трассировка: Ф1→N1←T1; слой обслуживает также Ф3→N2 и Ф5→H1; при дескопе Ф1 переатрибутируется первому оставшемуся потребителю. Проверка (DoD): контракт «ход → runtime, модель, sessionId или unknown» доступен UI-слою; на выборке ходов метаданные присутствуют или явно unknown — скрытых пустых состояний нет; смена исполнителя фиксируется. Зависимости: нет; разблокирует бейдж, панель истории и счётчик.
  Scope: |-
    - In scope: Единый источник метаданных исполнителя для каждого хода чата и каждой задачи: извлечение runtime, модели и sessionId из tasks/*.json и chat.json, нормализация, привязка к ходу, явное состояние unknown при недоступности (не скрытие), фиксация факта смены исполнителя как события для истории. Трассировка: Ф1→N1←T1; слой обслуживает также Ф3→N2 и Ф5→H1; при дескопе Ф1 переатрибутируется первому оставшемуся потребителю. Проверка (DoD): контракт «ход → runtime, модель, sessionId или unknown» доступен UI-слою; на выборке ходов метаданные присутствуют или явно unknown — скрытых пустых состояний нет; смена исполнителя фиксируется. Зависимости: нет; разблокирует бейдж, панель истории и счётчик.
    - Out of scope: unrelated refactors not required for "Общий слой метаданных исполнителя хода".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Общий слой метаданных исполнителя хода". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Общий слой метаданных исполнителя хода". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Общий слой метаданных исполнителя хода

Единый источник метаданных исполнителя для каждого хода чата и каждой задачи: извлечение runtime, модели и sessionId из tasks/*.json и chat.json, нормализация, привязка к ходу, явное состояние unknown при недоступности (не скрытие), фиксация факта смены исполнителя как события для истории. Трассировка: Ф1→N1←T1; слой обслуживает также Ф3→N2 и Ф5→H1; при дескопе Ф1 переатрибутируется первому оставшемуся потребителю. Проверка (DoD): контракт «ход → runtime, модель, sessionId или unknown» доступен UI-слою; на выборке ходов метаданные присутствуют или явно unknown — скрытых пустых состояний нет; смена исполнителя фиксируется. Зависимости: нет; разблокирует бейдж, панель истории и счётчик.

## Scope

- In scope: Единый источник метаданных исполнителя для каждого хода чата и каждой задачи: извлечение runtime, модели и sessionId из tasks/*.json и chat.json, нормализация, привязка к ходу, явное состояние unknown при недоступности (не скрытие), фиксация факта смены исполнителя как события для истории. Трассировка: Ф1→N1←T1; слой обслуживает также Ф3→N2 и Ф5→H1; при дескопе Ф1 переатрибутируется первому оставшемуся потребителю. Проверка (DoD): контракт «ход → runtime, модель, sessionId или unknown» доступен UI-слою; на выборке ходов метаданные присутствуют или явно unknown — скрытых пустых состояний нет; смена исполнителя фиксируется. Зависимости: нет; разблокирует бейдж, панель истории и счётчик.
- Out of scope: unrelated refactors not required for "Общий слой метаданных исполнителя хода".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Общий слой метаданных исполнителя хода". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Общий слой метаданных исполнителя хода". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
