---
id: "202610091946-2DBC"
title: "Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8"
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
doc_updated_at: "2026-10-09T19:46:58.693Z"
doc_updated_by: "HARNESS"
description: "Быстрые проверки гипотез до реализации: H1 — нужно ли показывать стоимость и токены на ход (Ф5); H2 — снижает ли объяснение блокировки повторные попытки обхода (Ф6); H3 — нужна ли карточка назначения и границ домена чата (Ф8). Результат — решение Q10 по каждой гипотезе: в scope или отложить. Трассировка: обслуживающая задача для Ф5/Ф6/Ф8→H1/H2/H3; закрывает риски R3/R7. Проверка (DoD): по каждой гипотезе зафиксировано решение с evidence (наблюдение или мини-интервью, желательно более одного респондента — связка с Q6); до решения задачи счётчика, агрегата стоимости, объяснения guardrail и карточки домена заблокированы (гейт). Зависимости: нет."
sections:
  Summary: |-
    Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8

    Быстрые проверки гипотез до реализации: H1 — нужно ли показывать стоимость и токены на ход (Ф5); H2 — снижает ли объяснение блокировки повторные попытки обхода (Ф6); H3 — нужна ли карточка назначения и границ домена чата (Ф8). Результат — решение Q10 по каждой гипотезе: в scope или отложить. Трассировка: обслуживающая задача для Ф5/Ф6/Ф8→H1/H2/H3; закрывает риски R3/R7. Проверка (DoD): по каждой гипотезе зафиксировано решение с evidence (наблюдение или мини-интервью, желательно более одного респондента — связка с Q6); до решения задачи счётчика, агрегата стоимости, объяснения guardrail и карточки домена заблокированы (гейт). Зависимости: нет.
  Scope: |-
    - In scope: Быстрые проверки гипотез до реализации: H1 — нужно ли показывать стоимость и токены на ход (Ф5); H2 — снижает ли объяснение блокировки повторные попытки обхода (Ф6); H3 — нужна ли карточка назначения и границ домена чата (Ф8). Результат — решение Q10 по каждой гипотезе: в scope или отложить. Трассировка: обслуживающая задача для Ф5/Ф6/Ф8→H1/H2/H3; закрывает риски R3/R7. Проверка (DoD): по каждой гипотезе зафиксировано решение с evidence (наблюдение или мини-интервью, желательно более одного респондента — связка с Q6); до решения задачи счётчика, агрегата стоимости, объяснения guardrail и карточки домена заблокированы (гейт). Зависимости: нет.
    - Out of scope: unrelated refactors not required for "Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8

Быстрые проверки гипотез до реализации: H1 — нужно ли показывать стоимость и токены на ход (Ф5); H2 — снижает ли объяснение блокировки повторные попытки обхода (Ф6); H3 — нужна ли карточка назначения и границ домена чата (Ф8). Результат — решение Q10 по каждой гипотезе: в scope или отложить. Трассировка: обслуживающая задача для Ф5/Ф6/Ф8→H1/H2/H3; закрывает риски R3/R7. Проверка (DoD): по каждой гипотезе зафиксировано решение с evidence (наблюдение или мини-интервью, желательно более одного респондента — связка с Q6); до решения задачи счётчика, агрегата стоимости, объяснения guardrail и карточки домена заблокированы (гейт). Зависимости: нет.

## Scope

- In scope: Быстрые проверки гипотез до реализации: H1 — нужно ли показывать стоимость и токены на ход (Ф5); H2 — снижает ли объяснение блокировки повторные попытки обхода (Ф6); H3 — нужна ли карточка назначения и границ домена чата (Ф8). Результат — решение Q10 по каждой гипотезе: в scope или отложить. Трассировка: обслуживающая задача для Ф5/Ф6/Ф8→H1/H2/H3; закрывает риски R3/R7. Проверка (DoD): по каждой гипотезе зафиксировано решение с evidence (наблюдение или мини-интервью, желательно более одного респондента — связка с Q6); до решения задачи счётчика, агрегата стоимости, объяснения guardrail и карточки домена заблокированы (гейт). Зависимости: нет.
- Out of scope: unrelated refactors not required for "Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Валидация гипотез H1–H3 — гейт задач Ф5/Ф6/Ф8". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
