---
id: "202610091946-6645"
title: "Идемпотентный ретрай failed-задачи с исходными параметрами"
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
doc_updated_at: "2026-10-09T19:46:55.028Z"
doc_updated_by: "HARNESS"
description: "Кнопка «Повторить» на карточке failed-задачи: возобновление с исходными параметрами без повторного ввода; идемпотентность — повторное нажатие не создаёт дублирующих артефактов и сайд-эффектов; интерлок — при активной идентичной сборке ретрай не запускается, показывается «уже выполняется». Трассировка: Ф2→N3 (частично N4)←T2 (S2; в базовой выборке ретрай-берсты: 4 graphify-промпта за 1,5 мин, 13 повторов входного контроля). Проверка (DoD): двойное нажатие даёт один результат; активная идентичная задача блокирует ретрай; параметры не вводятся повторно (AC Ф2 2, 3, 5); ретрай-берсты (3 и более за 5 мин) исчезают из логов (AC7, замер после baseline). Зависимости: карточка failed-задачи; нормализованные сигнатуры (интерлок)."
sections:
  Summary: |-
    Идемпотентный ретрай failed-задачи с исходными параметрами

    Кнопка «Повторить» на карточке failed-задачи: возобновление с исходными параметрами без повторного ввода; идемпотентность — повторное нажатие не создаёт дублирующих артефактов и сайд-эффектов; интерлок — при активной идентичной сборке ретрай не запускается, показывается «уже выполняется». Трассировка: Ф2→N3 (частично N4)←T2 (S2; в базовой выборке ретрай-берсты: 4 graphify-промпта за 1,5 мин, 13 повторов входного контроля). Проверка (DoD): двойное нажатие даёт один результат; активная идентичная задача блокирует ретрай; параметры не вводятся повторно (AC Ф2 2, 3, 5); ретрай-берсты (3 и более за 5 мин) исчезают из логов (AC7, замер после baseline). Зависимости: карточка failed-задачи; нормализованные сигнатуры (интерлок).
  Scope: |-
    - In scope: Кнопка «Повторить» на карточке failed-задачи: возобновление с исходными параметрами без повторного ввода; идемпотентность — повторное нажатие не создаёт дублирующих артефактов и сайд-эффектов; интерлок — при активной идентичной сборке ретрай не запускается, показывается «уже выполняется». Трассировка: Ф2→N3 (частично N4)←T2 (S2; в базовой выборке ретрай-берсты: 4 graphify-промпта за 1,5 мин, 13 повторов входного контроля). Проверка (DoD): двойное нажатие даёт один результат; активная идентичная задача блокирует ретрай; параметры не вводятся повторно (AC Ф2 2, 3, 5); ретрай-берсты (3 и более за 5 мин) исчезают из логов (AC7, замер после baseline). Зависимости: карточка failed-задачи; нормализованные сигнатуры (интерлок).
    - Out of scope: unrelated refactors not required for "Идемпотентный ретрай failed-задачи с исходными параметрами".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Идемпотентный ретрай failed-задачи с исходными параметрами". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Идемпотентный ретрай failed-задачи с исходными параметрами". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Идемпотентный ретрай failed-задачи с исходными параметрами

Кнопка «Повторить» на карточке failed-задачи: возобновление с исходными параметрами без повторного ввода; идемпотентность — повторное нажатие не создаёт дублирующих артефактов и сайд-эффектов; интерлок — при активной идентичной сборке ретрай не запускается, показывается «уже выполняется». Трассировка: Ф2→N3 (частично N4)←T2 (S2; в базовой выборке ретрай-берсты: 4 graphify-промпта за 1,5 мин, 13 повторов входного контроля). Проверка (DoD): двойное нажатие даёт один результат; активная идентичная задача блокирует ретрай; параметры не вводятся повторно (AC Ф2 2, 3, 5); ретрай-берсты (3 и более за 5 мин) исчезают из логов (AC7, замер после baseline). Зависимости: карточка failed-задачи; нормализованные сигнатуры (интерлок).

## Scope

- In scope: Кнопка «Повторить» на карточке failed-задачи: возобновление с исходными параметрами без повторного ввода; идемпотентность — повторное нажатие не создаёт дублирующих артефактов и сайд-эффектов; интерлок — при активной идентичной сборке ретрай не запускается, показывается «уже выполняется». Трассировка: Ф2→N3 (частично N4)←T2 (S2; в базовой выборке ретрай-берсты: 4 graphify-промпта за 1,5 мин, 13 повторов входного контроля). Проверка (DoD): двойное нажатие даёт один результат; активная идентичная задача блокирует ретрай; параметры не вводятся повторно (AC Ф2 2, 3, 5); ретрай-берсты (3 и более за 5 мин) исчезают из логов (AC7, замер после baseline). Зависимости: карточка failed-задачи; нормализованные сигнатуры (интерлок).
- Out of scope: unrelated refactors not required for "Идемпотентный ретрай failed-задачи с исходными параметрами".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Идемпотентный ретрай failed-задачи с исходными параметрами". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Идемпотентный ретрай failed-задачи с исходными параметрами". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
