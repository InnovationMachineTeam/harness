---
version: alpha
name: Graphite Light
description: "Светлая пара Graphite: белые панели на светло-сером фоне, тёмный графитовый текст"
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
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
  text-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-muted}"
  text-faint:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-faint}"
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

Светлая пара Graphite: белые панели на светло-сером фоне, тёмный графитовый текст. Светлая тема-пресет консоли Harness.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#f4f4f5` - фон страницы
- `surface` - `#ffffff` - панели и карточки
- `raised` - `#ebebed` - поля ввода и hover-состояния
- `overlay` - `#ffffff` - модалки и дропдауны
- `line` - `#dddee1` - базовые границы
- `line-strong` - `#c4c6ca` - выделенные границы и активные состояния
- `fg` - `#1d1e20` - основной текст
- `fg-muted` - `#55575c` - вторичный текст
- `fg-faint` - `#72747c` - приглушённый текст
- `accent` - `#047857` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#0369a1` - ссылки и подсказки
- `warning` - `#b45309` - предупреждения
- `danger` - `#dc2626` - деструктив и ошибки
- `swatch-1` - `#7c3aed` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#e11d48` - категориальный: розовый
- `swatch-3` - `#c2410c` - категориальный: оранжевый
- `swatch-4` - `#4d7c0f` - категориальный: лайм
- `swatch-5` - `#0e7490` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "Graphite Light (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
