---
id: "202610091946-B416"
title: "Панель истории переключений исполнителя в диалоге"
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
doc_updated_at: "2026-10-09T19:46:55.758Z"
doc_updated_by: "HARNESS"
description: "Панель в диалоге: каждый ход аннотирован исполнителем (runtime, модель), точки смены исполнителя визуально отмечены, клик раскрывает детали хода; отсутствующие записи — плейсхолдер «нет данных», не пустота; длинные диалоги сворачиваются. Трассировка: Ф3→N2←T1 (S3; 10 history-запросов в базовой выборке). Проверка (DoD): на диалоге с двумя и более сменами ответ на «кто отвечал ранее» получается без дополнительного промпта (AC Ф3 1–4); history-запросы не появляются как промпты в новых логах (AC5, замер после baseline). Зависимости: общий слой метаданных; за счёт переиспользования слоя effort 1 вместо 2 у фичи."
sections:
  Summary: |-
    Панель истории переключений исполнителя в диалоге

    Панель в диалоге: каждый ход аннотирован исполнителем (runtime, модель), точки смены исполнителя визуально отмечены, клик раскрывает детали хода; отсутствующие записи — плейсхолдер «нет данных», не пустота; длинные диалоги сворачиваются. Трассировка: Ф3→N2←T1 (S3; 10 history-запросов в базовой выборке). Проверка (DoD): на диалоге с двумя и более сменами ответ на «кто отвечал ранее» получается без дополнительного промпта (AC Ф3 1–4); history-запросы не появляются как промпты в новых логах (AC5, замер после baseline). Зависимости: общий слой метаданных; за счёт переиспользования слоя effort 1 вместо 2 у фичи.
  Scope: |-
    - In scope: Панель в диалоге: каждый ход аннотирован исполнителем (runtime, модель), точки смены исполнителя визуально отмечены, клик раскрывает детали хода; отсутствующие записи — плейсхолдер «нет данных», не пустота; длинные диалоги сворачиваются. Трассировка: Ф3→N2←T1 (S3; 10 history-запросов в базовой выборке). Проверка (DoD): на диалоге с двумя и более сменами ответ на «кто отвечал ранее» получается без дополнительного промпта (AC Ф3 1–4); history-запросы не появляются как промпты в новых логах (AC5, замер после baseline). Зависимости: общий слой метаданных; за счёт переиспользования слоя effort 1 вместо 2 у фичи.
    - Out of scope: unrelated refactors not required for "Панель истории переключений исполнителя в диалоге".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Панель истории переключений исполнителя в диалоге". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Панель истории переключений исполнителя в диалоге". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Панель истории переключений исполнителя в диалоге

Панель в диалоге: каждый ход аннотирован исполнителем (runtime, модель), точки смены исполнителя визуально отмечены, клик раскрывает детали хода; отсутствующие записи — плейсхолдер «нет данных», не пустота; длинные диалоги сворачиваются. Трассировка: Ф3→N2←T1 (S3; 10 history-запросов в базовой выборке). Проверка (DoD): на диалоге с двумя и более сменами ответ на «кто отвечал ранее» получается без дополнительного промпта (AC Ф3 1–4); history-запросы не появляются как промпты в новых логах (AC5, замер после baseline). Зависимости: общий слой метаданных; за счёт переиспользования слоя effort 1 вместо 2 у фичи.

## Scope

- In scope: Панель в диалоге: каждый ход аннотирован исполнителем (runtime, модель), точки смены исполнителя визуально отмечены, клик раскрывает детали хода; отсутствующие записи — плейсхолдер «нет данных», не пустота; длинные диалоги сворачиваются. Трассировка: Ф3→N2←T1 (S3; 10 history-запросов в базовой выборке). Проверка (DoD): на диалоге с двумя и более сменами ответ на «кто отвечал ранее» получается без дополнительного промпта (AC Ф3 1–4); history-запросы не появляются как промпты в новых логах (AC5, замер после baseline). Зависимости: общий слой метаданных; за счёт переиспользования слоя effort 1 вместо 2 у фичи.
- Out of scope: unrelated refactors not required for "Панель истории переключений исполнителя в диалоге".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Панель истории переключений исполнителя в диалоге". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Панель истории переключений исполнителя в диалоге". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
