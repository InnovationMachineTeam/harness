---
id: "202610091946-06F5"
title: "Нормализованные сигнатуры задач без ложных срабатываний"
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
doc_updated_at: "2026-10-09T19:46:57.214Z"
doc_updated_by: "HARNESS"
description: "Вычисление нормализованной сигнатуры задачи (заголовок + параметры) и сверка с активной очередью до отправки; порог совпадения исключает блокировку похожих, но различных формулировок — смоук-дубли вида «Ответь ровно одним словом: работает» различимы от системных задач. Трассировка: Ф4→N4←T3 (S2, S3 — двойное покрытие; базовый фон: тройной запуск дорогой сборки и failed-дубли). Проверка (DoD): идентичные формулировки дают совпадение сигнатур; тест-набор похожих-но-различных задач не даёт ложных блокировок (AC Ф4 1, 4). Зависимости: нет; разблокирует диалог подтверждения и интерлок ретрая; при дескопе Ф4 переатрибутируется как обслуживающая задача Ф2 (Q15)."
sections:
  Summary: |-
    Нормализованные сигнатуры задач без ложных срабатываний

    Вычисление нормализованной сигнатуры задачи (заголовок + параметры) и сверка с активной очередью до отправки; порог совпадения исключает блокировку похожих, но различных формулировок — смоук-дубли вида «Ответь ровно одним словом: работает» различимы от системных задач. Трассировка: Ф4→N4←T3 (S2, S3 — двойное покрытие; базовый фон: тройной запуск дорогой сборки и failed-дубли). Проверка (DoD): идентичные формулировки дают совпадение сигнатур; тест-набор похожих-но-различных задач не даёт ложных блокировок (AC Ф4 1, 4). Зависимости: нет; разблокирует диалог подтверждения и интерлок ретрая; при дескопе Ф4 переатрибутируется как обслуживающая задача Ф2 (Q15).
  Scope: |-
    - In scope: Вычисление нормализованной сигнатуры задачи (заголовок + параметры) и сверка с активной очередью до отправки; порог совпадения исключает блокировку похожих, но различных формулировок — смоук-дубли вида «Ответь ровно одним словом: работает» различимы от системных задач. Трассировка: Ф4→N4←T3 (S2, S3 — двойное покрытие; базовый фон: тройной запуск дорогой сборки и failed-дубли). Проверка (DoD): идентичные формулировки дают совпадение сигнатур; тест-набор похожих-но-различных задач не даёт ложных блокировок (AC Ф4 1, 4). Зависимости: нет; разблокирует диалог подтверждения и интерлок ретрая; при дескопе Ф4 переатрибутируется как обслуживающая задача Ф2 (Q15).
    - Out of scope: unrelated refactors not required for "Нормализованные сигнатуры задач без ложных срабатываний".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Нормализованные сигнатуры задач без ложных срабатываний". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Нормализованные сигнатуры задач без ложных срабатываний". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Нормализованные сигнатуры задач без ложных срабатываний

Вычисление нормализованной сигнатуры задачи (заголовок + параметры) и сверка с активной очередью до отправки; порог совпадения исключает блокировку похожих, но различных формулировок — смоук-дубли вида «Ответь ровно одним словом: работает» различимы от системных задач. Трассировка: Ф4→N4←T3 (S2, S3 — двойное покрытие; базовый фон: тройной запуск дорогой сборки и failed-дубли). Проверка (DoD): идентичные формулировки дают совпадение сигнатур; тест-набор похожих-но-различных задач не даёт ложных блокировок (AC Ф4 1, 4). Зависимости: нет; разблокирует диалог подтверждения и интерлок ретрая; при дескопе Ф4 переатрибутируется как обслуживающая задача Ф2 (Q15).

## Scope

- In scope: Вычисление нормализованной сигнатуры задачи (заголовок + параметры) и сверка с активной очередью до отправки; порог совпадения исключает блокировку похожих, но различных формулировок — смоук-дубли вида «Ответь ровно одним словом: работает» различимы от системных задач. Трассировка: Ф4→N4←T3 (S2, S3 — двойное покрытие; базовый фон: тройной запуск дорогой сборки и failed-дубли). Проверка (DoD): идентичные формулировки дают совпадение сигнатур; тест-набор похожих-но-различных задач не даёт ложных блокировок (AC Ф4 1, 4). Зависимости: нет; разблокирует диалог подтверждения и интерлок ретрая; при дескопе Ф4 переатрибутируется как обслуживающая задача Ф2 (Q15).
- Out of scope: unrelated refactors not required for "Нормализованные сигнатуры задач без ложных срабатываний".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Нормализованные сигнатуры задач без ложных срабатываний". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Нормализованные сигнатуры задач без ложных срабатываний". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
