---
id: "202610091946-D494"
title: "Resume для interrupted-сборок знаний"
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
doc_updated_at: "2026-10-09T19:46:56.489Z"
doc_updated_by: "HARNESS"
description: "Распознавание состояния interrupted у прерванных сборок знаний и предложение resume в UI; поведение возобновления задокументировано в docs/operations.md. Трассировка: Ф2→N3←T2 (S2). Проверка (DoD): воспроизводимый сценарий прерывания сборки распознаётся как interrupted и предлагает resume (AC Ф2 4); документация соответствует фактическому поведению. Зависимости: карточка состояния failed-задачи (общая поверхность состояний)."
sections:
  Summary: |-
    Resume для interrupted-сборок знаний

    Распознавание состояния interrupted у прерванных сборок знаний и предложение resume в UI; поведение возобновления задокументировано в docs/operations.md. Трассировка: Ф2→N3←T2 (S2). Проверка (DoD): воспроизводимый сценарий прерывания сборки распознаётся как interrupted и предлагает resume (AC Ф2 4); документация соответствует фактическому поведению. Зависимости: карточка состояния failed-задачи (общая поверхность состояний).
  Scope: |-
    - In scope: Распознавание состояния interrupted у прерванных сборок знаний и предложение resume в UI; поведение возобновления задокументировано в docs/operations.md. Трассировка: Ф2→N3←T2 (S2). Проверка (DoD): воспроизводимый сценарий прерывания сборки распознаётся как interrupted и предлагает resume (AC Ф2 4); документация соответствует фактическому поведению. Зависимости: карточка состояния failed-задачи (общая поверхность состояний).
    - Out of scope: unrelated refactors not required for "Resume для interrupted-сборок знаний".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Resume для interrupted-сборок знаний". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Resume для interrupted-сборок знаний". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Resume для interrupted-сборок знаний

Распознавание состояния interrupted у прерванных сборок знаний и предложение resume в UI; поведение возобновления задокументировано в docs/operations.md. Трассировка: Ф2→N3←T2 (S2). Проверка (DoD): воспроизводимый сценарий прерывания сборки распознаётся как interrupted и предлагает resume (AC Ф2 4); документация соответствует фактическому поведению. Зависимости: карточка состояния failed-задачи (общая поверхность состояний).

## Scope

- In scope: Распознавание состояния interrupted у прерванных сборок знаний и предложение resume в UI; поведение возобновления задокументировано в docs/operations.md. Трассировка: Ф2→N3←T2 (S2). Проверка (DoD): воспроизводимый сценарий прерывания сборки распознаётся как interrupted и предлагает resume (AC Ф2 4); документация соответствует фактическому поведению. Зависимости: карточка состояния failed-задачи (общая поверхность состояний).
- Out of scope: unrelated refactors not required for "Resume для interrupted-сборок знаний".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Resume для interrupted-сборок знаний". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Resume для interrupted-сборок знаний". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
