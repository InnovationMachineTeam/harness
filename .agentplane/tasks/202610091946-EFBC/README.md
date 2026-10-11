---
id: "202610091946-EFBC"
title: "Карточка failed-задачи: класс ошибки и человекочитаемая причина"
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
doc_updated_at: "2026-10-09T19:46:54.260Z"
doc_updated_by: "HARNESS"
description: "Классификация root-cause для failed-задач (первичный набор классов, расширяемый после закрытия Q3) и отображение на карточке: класс ошибки + краткая человекочитаемая причина из хвоста лога; неклассифицируемая ошибка — сырой хвост лога с пометкой «класс не определён». Трассировка: Ф2→N3←T2 (S2; 63 failed из 315 задач = 20% — крупнейший класс отказов выборки). Проверка (DoD): на тест-выборке failed-задач карточка показывает класс и причину; для неклассифицируемой — хвост лога + пометка (AC Ф2 1, 6). Зависимости: нет; оценка effort провизионна до закрытия Q3."
sections:
  Summary: |-
    Карточка failed-задачи: класс ошибки и человекочитаемая причина

    Классификация root-cause для failed-задач (первичный набор классов, расширяемый после закрытия Q3) и отображение на карточке: класс ошибки + краткая человекочитаемая причина из хвоста лога; неклассифицируемая ошибка — сырой хвост лога с пометкой «класс не определён». Трассировка: Ф2→N3←T2 (S2; 63 failed из 315 задач = 20% — крупнейший класс отказов выборки). Проверка (DoD): на тест-выборке failed-задач карточка показывает класс и причину; для неклассифицируемой — хвост лога + пометка (AC Ф2 1, 6). Зависимости: нет; оценка effort провизионна до закрытия Q3.
  Scope: |-
    - In scope: Классификация root-cause для failed-задач (первичный набор классов, расширяемый после закрытия Q3) и отображение на карточке: класс ошибки + краткая человекочитаемая причина из хвоста лога; неклассифицируемая ошибка — сырой хвост лога с пометкой «класс не определён». Трассировка: Ф2→N3←T2 (S2; 63 failed из 315 задач = 20% — крупнейший класс отказов выборки). Проверка (DoD): на тест-выборке failed-задач карточка показывает класс и причину; для неклассифицируемой — хвост лога + пометка (AC Ф2 1, 6). Зависимости: нет; оценка effort провизионна до закрытия Q3.
    - Out of scope: unrelated refactors not required for "Карточка failed-задачи: класс ошибки и человекочитаемая причина".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Карточка failed-задачи: класс ошибки и человекочитаемая причина". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Карточка failed-задачи: класс ошибки и человекочитаемая причина". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Карточка failed-задачи: класс ошибки и человекочитаемая причина

Классификация root-cause для failed-задач (первичный набор классов, расширяемый после закрытия Q3) и отображение на карточке: класс ошибки + краткая человекочитаемая причина из хвоста лога; неклассифицируемая ошибка — сырой хвост лога с пометкой «класс не определён». Трассировка: Ф2→N3←T2 (S2; 63 failed из 315 задач = 20% — крупнейший класс отказов выборки). Проверка (DoD): на тест-выборке failed-задач карточка показывает класс и причину; для неклассифицируемой — хвост лога + пометка (AC Ф2 1, 6). Зависимости: нет; оценка effort провизионна до закрытия Q3.

## Scope

- In scope: Классификация root-cause для failed-задач (первичный набор классов, расширяемый после закрытия Q3) и отображение на карточке: класс ошибки + краткая человекочитаемая причина из хвоста лога; неклассифицируемая ошибка — сырой хвост лога с пометкой «класс не определён». Трассировка: Ф2→N3←T2 (S2; 63 failed из 315 задач = 20% — крупнейший класс отказов выборки). Проверка (DoD): на тест-выборке failed-задач карточка показывает класс и причину; для неклассифицируемой — хвост лога + пометка (AC Ф2 1, 6). Зависимости: нет; оценка effort провизионна до закрытия Q3.
- Out of scope: unrelated refactors not required for "Карточка failed-задачи: класс ошибки и человекочитаемая причина".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Карточка failed-задачи: класс ошибки и человекочитаемая причина". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Карточка failed-задачи: класс ошибки и человекочитаемая причина". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
