---
version: alpha
name: Graphite Light
description: "Светлая тема консоли Harness: белые панели на светло-сером фоне, тёмный графитовый текст"
colors:
  primary: "{colors.accent}"
  page: "#f4f4f5"
  surface: "#ffffff"
  raised: "#ebebed"
  overlay: "#ffffff"
  line: "#dddee1"
  line-strong: "#c4c6ca"
  fg: "#1d1e20"
  fg-muted: "#55575c"
  fg-faint: "#72747c"
  accent: "#047857"
  info: "#0369a1"
  warning: "#b45309"
  danger: "#dc2626"
  swatch-1: "#7c3aed"
  swatch-2: "#e11d48"
  swatch-3: "#c2410c"
  swatch-4: "#4d7c0f"
  swatch-5: "#0e7490"
rounded:
  md: 6px
  lg: 8px
  xl: 12px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
typography:
  body:
    fontFamily: system-ui, -apple-system, sans-serif
    fontSize: 14px
  caption:
    fontFamily: system-ui, -apple-system, sans-serif
    fontSize: 11px
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 12px
components:
  layout-canvas:
    backgroundColor: "{colors.page}"
    textColor: "{colors.fg}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 8px
  button-ghost:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
  modal:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
  text-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-muted}"
  text-faint:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-faint}"
  badge-info:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.info}"
    rounded: "{rounded.md}"
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
  badge-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
  chip-runtime-1:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.swatch-1}"
    rounded: "{rounded.lg}"
  chip-runtime-2:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.swatch-2}"
    rounded: "{rounded.lg}"
  chip-runtime-3:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.swatch-3}"
    rounded: "{rounded.lg}"
  chip-runtime-4:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.swatch-4}"
    rounded: "{rounded.lg}"
  chip-runtime-5:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.swatch-5}"
    rounded: "{rounded.lg}"
---

# Graphite Light

## Overview

Светлая пара темы Graphite: белые панели на светло-сером фоне, графитовый текст. Акценты намеренно темнее (600-700 оттенки), чтобы держать контраст ≥4.5:1 на белом - смыслы цветов те же, что и в тёмной теме. Переключение между темами не меняет компоновку: все компоненты используют одни и те же семантические классы.

## Colors

- `page` - фон страницы, светло-серый; `surface` - белые панели и карточки.
- `raised` - поля ввода и hover-состояния; `overlay` - модалки (белые, с границей).
- `line` - базовые границы; `line-strong` - выделенные границы и активные состояния.
- `fg` / `fg-muted` / `fg-faint` - три ступени текста, от почти чёрного к серому.
- `accent` (алиас `primary`) - primary-действия и позитивные статусы (тёмный эмералд); `info` - ссылки; `warning` - янтарные предупреждения; `danger` - деструктив и ошибки.
- `swatch-1…5` - категориальная пятёрка для монограмм рантаймов, затемнённые оттенки для читаемости на светлом.

## Typography

Идентична тёмной теме: системный стек, body 14px, caption 11px, mono 12px.

## Layout

Контентная колонка до 72rem с полем 24px (`spacing.lg`); вертикальный ритм 8/16/24px (`spacing.sm/md/lg`).

## Elevation & Depth

Иерархия - светлотой (серый фон → белая панель → серое "приподнятое"), границы `line` отделяют белые поверхности друг от друга; тени не используются.

## Shapes

Радиусы совпадают с тёмной темой: md 6px, lg 8px, xl 12px; полный круг - только точки-индикаторы и аватары.

## Components

- `button-primary` - эмералд-заливка с белым текстом (контраст ≥4.5:1).
- `button-ghost` / `input` - светло-серая приподнятая поверхность, тёмный текст.
- `panel` / `modal` - белые карточки с радиусом xl и границей `line`.
- `text-secondary` / `text-faint` - вторичная и приглушённая ступени текста.
- Статусные бейджи: `badge-warning` - янтарная заливка с белым текстом; `badge-info` / `badge-danger` - цветной текст на поверхности (заливка светлых 600-700 оттенков не даёт нужного контраста).
- `chip-runtime-1…5` - монограммы рантаймов: затемнённые `swatch-1…5` на поверхности.

## Do's and Don'ts

- Не используйте светлые 300-400 оттенки акцентов из тёмной темы: на белом они теряют контраст, берите затемнённые значения ролей.
- Не подмешивайте серые полупрозрачные заливки поверх белых панелей там, где нужна `raised`: полупрозрачность по-разному ложится на разные темы.
- Смысловые цвета - только по назначению; категориальные различия - только через `swatch-1…5`.
