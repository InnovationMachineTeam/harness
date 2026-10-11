---
id: "202610091946-4C0D"
title: "Счётчик токенов на ход (вход / выход / cache)"
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
doc_updated_at: "2026-10-09T19:47:00.179Z"
doc_updated_by: "HARNESS"
description: "Отображение расхода токенов на каждый ход из provider-usage: вход, выход и cache раздельно; cache-токены учтены отдельно от totalTokens (данные лежат в details); привязка к ходу через общий слой метаданных. Трассировка: Ф5→H1←T7 (S3, гипотеза — старт после гейта валидации; косвенный фон: 2000 usage-записей, cacheRead до 238 902 в записи). Проверка (DoD): на тест-ходе числа сходятся с usage-записями; cache показан отдельно от totalTokens (AC Ф5 1, 3). Зависимости: валидация гипотез; общий слой метаданных (мягкая — привязка к ходу)."
sections:
  Summary: |-
    Счётчик токенов на ход (вход / выход / cache)

    Отображение расхода токенов на каждый ход из provider-usage: вход, выход и cache раздельно; cache-токены учтены отдельно от totalTokens (данные лежат в details); привязка к ходу через общий слой метаданных. Трассировка: Ф5→H1←T7 (S3, гипотеза — старт после гейта валидации; косвенный фон: 2000 usage-записей, cacheRead до 238 902 в записи). Проверка (DoD): на тест-ходе числа сходятся с usage-записями; cache показан отдельно от totalTokens (AC Ф5 1, 3). Зависимости: валидация гипотез; общий слой метаданных (мягкая — привязка к ходу).
  Scope: |-
    - In scope: Отображение расхода токенов на каждый ход из provider-usage: вход, выход и cache раздельно; cache-токены учтены отдельно от totalTokens (данные лежат в details); привязка к ходу через общий слой метаданных. Трассировка: Ф5→H1←T7 (S3, гипотеза — старт после гейта валидации; косвенный фон: 2000 usage-записей, cacheRead до 238 902 в записи). Проверка (DoD): на тест-ходе числа сходятся с usage-записями; cache показан отдельно от totalTokens (AC Ф5 1, 3). Зависимости: валидация гипотез; общий слой метаданных (мягкая — привязка к ходу).
    - Out of scope: unrelated refactors not required for "Счётчик токенов на ход (вход / выход / cache)".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Счётчик токенов на ход (вход / выход / cache)". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Счётчик токенов на ход (вход / выход / cache)". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Счётчик токенов на ход (вход / выход / cache)

Отображение расхода токенов на каждый ход из provider-usage: вход, выход и cache раздельно; cache-токены учтены отдельно от totalTokens (данные лежат в details); привязка к ходу через общий слой метаданных. Трассировка: Ф5→H1←T7 (S3, гипотеза — старт после гейта валидации; косвенный фон: 2000 usage-записей, cacheRead до 238 902 в записи). Проверка (DoD): на тест-ходе числа сходятся с usage-записями; cache показан отдельно от totalTokens (AC Ф5 1, 3). Зависимости: валидация гипотез; общий слой метаданных (мягкая — привязка к ходу).

## Scope

- In scope: Отображение расхода токенов на каждый ход из provider-usage: вход, выход и cache раздельно; cache-токены учтены отдельно от totalTokens (данные лежат в details); привязка к ходу через общий слой метаданных. Трассировка: Ф5→H1←T7 (S3, гипотеза — старт после гейта валидации; косвенный фон: 2000 usage-записей, cacheRead до 238 902 в записи). Проверка (DoD): на тест-ходе числа сходятся с usage-записями; cache показан отдельно от totalTokens (AC Ф5 1, 3). Зависимости: валидация гипотез; общий слой метаданных (мягкая — привязка к ходу).
- Out of scope: unrelated refactors not required for "Счётчик токенов на ход (вход / выход / cache)".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Счётчик токенов на ход (вход / выход / cache)". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Счётчик токенов на ход (вход / выход / cache)". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
