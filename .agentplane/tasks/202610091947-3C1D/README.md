---
id: "202610091947-3C1D"
title: "Агрегат стоимости диалога с явной основой расчёта"
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
doc_updated_at: "2026-10-09T19:47:00.918Z"
doc_updated_by: "HARNESS"
description: "Агрегат токенов по диалогу и оценка стоимости по docs/pricing.md; метод согласован с docs/stats.md (двойной учёт: зафиксированная стоимость + оценка); при расхождении схем агрегации (totals против records) основа расчёта явно указана в UI. Трассировка: Ф5→H1 (S3, гипотеза — старт после гейта). Проверка (DoD): агрегат сходится с ручным подсчётом на тест-диалоге; основа расчёта видна в UI (AC Ф5 2, 4, 5). Зависимости: счётчик токенов на ход; пересчёт baseline (схемы агрегации)."
sections:
  Summary: |-
    Агрегат стоимости диалога с явной основой расчёта

    Агрегат токенов по диалогу и оценка стоимости по docs/pricing.md; метод согласован с docs/stats.md (двойной учёт: зафиксированная стоимость + оценка); при расхождении схем агрегации (totals против records) основа расчёта явно указана в UI. Трассировка: Ф5→H1 (S3, гипотеза — старт после гейта). Проверка (DoD): агрегат сходится с ручным подсчётом на тест-диалоге; основа расчёта видна в UI (AC Ф5 2, 4, 5). Зависимости: счётчик токенов на ход; пересчёт baseline (схемы агрегации).
  Scope: |-
    - In scope: Агрегат токенов по диалогу и оценка стоимости по docs/pricing.md; метод согласован с docs/stats.md (двойной учёт: зафиксированная стоимость + оценка); при расхождении схем агрегации (totals против records) основа расчёта явно указана в UI. Трассировка: Ф5→H1 (S3, гипотеза — старт после гейта). Проверка (DoD): агрегат сходится с ручным подсчётом на тест-диалоге; основа расчёта видна в UI (AC Ф5 2, 4, 5). Зависимости: счётчик токенов на ход; пересчёт baseline (схемы агрегации).
    - Out of scope: unrelated refactors not required for "Агрегат стоимости диалога с явной основой расчёта".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Агрегат стоимости диалога с явной основой расчёта". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Агрегат стоимости диалога с явной основой расчёта". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Агрегат стоимости диалога с явной основой расчёта

Агрегат токенов по диалогу и оценка стоимости по docs/pricing.md; метод согласован с docs/stats.md (двойной учёт: зафиксированная стоимость + оценка); при расхождении схем агрегации (totals против records) основа расчёта явно указана в UI. Трассировка: Ф5→H1 (S3, гипотеза — старт после гейта). Проверка (DoD): агрегат сходится с ручным подсчётом на тест-диалоге; основа расчёта видна в UI (AC Ф5 2, 4, 5). Зависимости: счётчик токенов на ход; пересчёт baseline (схемы агрегации).

## Scope

- In scope: Агрегат токенов по диалогу и оценка стоимости по docs/pricing.md; метод согласован с docs/stats.md (двойной учёт: зафиксированная стоимость + оценка); при расхождении схем агрегации (totals против records) основа расчёта явно указана в UI. Трассировка: Ф5→H1 (S3, гипотеза — старт после гейта). Проверка (DoD): агрегат сходится с ручным подсчётом на тест-диалоге; основа расчёта видна в UI (AC Ф5 2, 4, 5). Зависимости: счётчик токенов на ход; пересчёт baseline (схемы агрегации).
- Out of scope: unrelated refactors not required for "Агрегат стоимости диалога с явной основой расчёта".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Агрегат стоимости диалога с явной основой расчёта". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Агрегат стоимости диалога с явной основой расчёта". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
