---
id: "202610091947-039C"
title: "Карточка домена чата и индикатор redaction"
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
doc_updated_at: "2026-10-09T19:47:02.495Z"
doc_updated_by: "HARNESS"
description: "Карточка назначения и границ домена прямого чата при первом открытии (скрываемая, повторно открываемая); индикатор redaction объясняет факт редактирования PII без раскрытия содержимого; сама карточка не содержит PII (privacy-инвариант). Трассировка: Ф8→H3←T4 (S1, S3, гипотеза — старт после гейта; базовый фон: 2 вопроса за пределами домена с отредактированными персональными данными). Проверка (DoD): карточка открывается, скрывается и переоткрывается; индикатор не раскрывает PII; статический контент проверен на отсутствие PII (AC Ф8 1–3). Зависимости: валидация гипотез."
sections:
  Summary: |-
    Карточка домена чата и индикатор redaction

    Карточка назначения и границ домена прямого чата при первом открытии (скрываемая, повторно открываемая); индикатор redaction объясняет факт редактирования PII без раскрытия содержимого; сама карточка не содержит PII (privacy-инвариант). Трассировка: Ф8→H3←T4 (S1, S3, гипотеза — старт после гейта; базовый фон: 2 вопроса за пределами домена с отредактированными персональными данными). Проверка (DoD): карточка открывается, скрывается и переоткрывается; индикатор не раскрывает PII; статический контент проверен на отсутствие PII (AC Ф8 1–3). Зависимости: валидация гипотез.
  Scope: |-
    - In scope: Карточка назначения и границ домена прямого чата при первом открытии (скрываемая, повторно открываемая); индикатор redaction объясняет факт редактирования PII без раскрытия содержимого; сама карточка не содержит PII (privacy-инвариант). Трассировка: Ф8→H3←T4 (S1, S3, гипотеза — старт после гейта; базовый фон: 2 вопроса за пределами домена с отредактированными персональными данными). Проверка (DoD): карточка открывается, скрывается и переоткрывается; индикатор не раскрывает PII; статический контент проверен на отсутствие PII (AC Ф8 1–3). Зависимости: валидация гипотез.
    - Out of scope: unrelated refactors not required for "Карточка домена чата и индикатор redaction".
  Plan: "PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval."
  Verify Steps: |-
    PLANNER fallback scaffold for "Карточка домена чата и индикатор redaction". Replace with task-specific acceptance checks when PLANNER context is available.

    1. Review the requested outcome for "Карточка домена чата и индикатор redaction". Expected: the visible result matches ## Summary and stays inside approved scope.
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

Карточка домена чата и индикатор redaction

Карточка назначения и границ домена прямого чата при первом открытии (скрываемая, повторно открываемая); индикатор redaction объясняет факт редактирования PII без раскрытия содержимого; сама карточка не содержит PII (privacy-инвариант). Трассировка: Ф8→H3←T4 (S1, S3, гипотеза — старт после гейта; базовый фон: 2 вопроса за пределами домена с отредактированными персональными данными). Проверка (DoD): карточка открывается, скрывается и переоткрывается; индикатор не раскрывает PII; статический контент проверен на отсутствие PII (AC Ф8 1–3). Зависимости: валидация гипотез.

## Scope

- In scope: Карточка назначения и границ домена прямого чата при первом открытии (скрываемая, повторно открываемая); индикатор redaction объясняет факт редактирования PII без раскрытия содержимого; сама карточка не содержит PII (privacy-инвариант). Трассировка: Ф8→H3←T4 (S1, S3, гипотеза — старт после гейта; базовый фон: 2 вопроса за пределами домена с отредактированными персональными данными). Проверка (DoD): карточка открывается, скрывается и переоткрывается; индикатор не раскрывает PII; статический контент проверен на отсутствие PII (AC Ф8 1–3). Зависимости: валидация гипотез.
- Out of scope: unrelated refactors not required for "Карточка домена чата и индикатор redaction".

## Plan

PLANNER semantic plan required. Replace this placeholder with a task-specific implementation plan before approval.

## Verify Steps

PLANNER fallback scaffold for "Карточка домена чата и индикатор redaction". Replace with task-specific acceptance checks when PLANNER context is available.

1. Review the requested outcome for "Карточка домена чата и индикатор redaction". Expected: the visible result matches ## Summary and stays inside approved scope.
2. Run the most relevant validation step for this task. Expected: it succeeds without unexpected regressions in touched behavior.
3. Compare the final result against ## Scope and record any residual follow-up in ## Findings. Expected: open edges are explicit rather than implicit.

## Verification

<!-- BEGIN VERIFICATION RESULTS -->
<!-- END VERIFICATION RESULTS -->

## Rollback Plan

- Revert task-related commit(s).
- Re-run required checks to confirm rollback safety.

## Findings
