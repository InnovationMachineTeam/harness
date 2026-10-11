---
id: "202610091946-17CE"
title: "Бейдж исполнителя хода в чате и на карточке задачи"
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
doc_updated_at: "2026-10-09T19:46:53.541Z"
doc_updated_by: "HARNESS"
description: "Бейдж runtime + модель в каждом ходе чата и на карточке задачи без действия пользователя; клик раскрывает runtime, модель, sessionId; недоступные метаданные — явное состояние unknown; смена исполнителя внутри диалога помечена в следующем ходе; доступность: aria-метки, клавиатурная навигация, контраст. Трассировка: Ф1→N1←T1 (S3 — основной, 25 model-вопросов из 304 промпт-задач выборки; S1 — проверка идентичности без расхода хода). Проверка (DoD): AC Ф1 1–5 проходят на смоук-диалоге; сценарий S1 «какая у тебя модель» закрывается UI без промпта; метрика AC6 (доля model-вопросов ниже базовой 25/304) замеряется после пересчёта baseline. Зависимости: общий слой метаданных."
sections:
  Summary: |-
    Бейдж исполнителя хода в чате и на карточке задачи

    Бейдж runtime + модель в каждом ходе чата и на карточке задачи без действия пользователя; клик раскрывает runtime, модель, sessionId; недоступные метаданные — явное состояние unknown; смена исполнителя внутри диалога помечена в следующем ходе; доступность: aria-метки, клавиатурная навигация, контраст. Трассировка: Ф1→N1←T1 (S3 — основной, 25 model-вопросов из 304 промпт-задач выборки; S1 — проверка идентичности без расхода хода). Проверка (DoD): AC Ф1 1–5 проходят на смоук-диалоге; сценарий S1 «какая у тебя модель» закрывается UI без промпта; метрика AC6 (доля model-вопросов ниже базовой 25/304) замеряется после пересчёта baseline. Зависимости: общий слой метаданных.
  Scope: |-
    - In scope: Бейдж runtime + модель в каждом ходе чата и на карточке задачи без действия пользователя; клик раскрывает runtime, модель, sessionId; недоступные метаданные — явное состояние unknown; смена исполнителя внутри диалога помечена в следующем ходе; доступность: aria-метки, клавиатурная навигация, контраст. Трассировка: Ф1→N1←T1 (S3 — основной, 25 model-вопросов из 304 промпт-задач выборки; S1 — проверка идентичности без расхода хода). Проверка (DoD): AC Ф1 1–5 проходят на смоук-диалоге; сценарий S1 «какая у тебя модель» закрывается UI без промпта; метрика AC6 (доля model-вопросов ниже базовой 25/304) замеряется после пересчёта baseline. Зависимости: общий слой метаданных.
    - Out of scope: unrelated refactors not required for "Бейдж исполнителя хода в чате и на карточке задачи".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Бейдж исполнителя хода в чате и на карточке задачи". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Бейдж исполнителя хода в чате и на карточке задачи". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Бейдж исполнителя хода в чате и на карточке задачи

Бейдж runtime + модель в каждом ходе чата и на карточке задачи без действия пользователя; клик раскрывает runtime, модель, sessionId; недоступные метаданные — явное состояние unknown; смена исполнителя внутри диалога помечена в следующем ходе; доступность: aria-метки, клавиатурная навигация, контраст. Трассировка: Ф1→N1←T1 (S3 — основной, 25 model-вопросов из 304 промпт-задач выборки; S1 — проверка идентичности без расхода хода). Проверка (DoD): AC Ф1 1–5 проходят на смоук-диалоге; сценарий S1 «какая у тебя модель» закрывается UI без промпта; метрика AC6 (доля model-вопросов ниже базовой 25/304) замеряется после пересчёта baseline. Зависимости: общий слой метаданных.

## Scope

- In scope: Бейдж runtime + модель в каждом ходе чата и на карточке задачи без действия пользователя; клик раскрывает runtime, модель, sessionId; недоступные метаданные — явное состояние unknown; смена исполнителя внутри диалога помечена в следующем ходе; доступность: aria-метки, клавиатурная навигация, контраст. Трассировка: Ф1→N1←T1 (S3 — основной, 25 model-вопросов из 304 промпт-задач выборки; S1 — проверка идентичности без расхода хода). Проверка (DoD): AC Ф1 1–5 проходят на смоук-диалоге; сценарий S1 «какая у тебя модель» закрывается UI без промпта; метрика AC6 (доля model-вопросов ниже базовой 25/304) замеряется после пересчёта baseline. Зависимости: общий слой метаданных.
- Out of scope: unrelated refactors not required for "Бейдж исполнителя хода в чате и на карточке задачи".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Бейдж исполнителя хода в чате и на карточке задачи". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Бейдж исполнителя хода в чате и на карточке задачи". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
