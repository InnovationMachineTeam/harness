---
version: alpha
name: One Light
description: "Светлая тема One Light: мягкий белый фон с классическими акцентами Atom"
colors:
  primary: "{colors.accent}"
  page: "#fafafa"
  surface: "#ffffff"
  raised: "#f0f0f1"
  overlay: "#f6f6f6"
  line: "#dcdfe4"
  line-strong: "#c5cad1"
  fg: "#383a42"
  fg-muted: "#5c6370"
  fg-faint: "#9d9fa8"
  accent: "#4078f2"
  info: "#0184bc"
  warning: "#c18401"
  danger: "#e45649"
  swatch-1: "#a626a4"
  swatch-2: "#ca1243"
  swatch-3: "#b76b01"
  swatch-4: "#50a14f"
  swatch-5: "#0184bc"
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

# One Light

## Overview

Светлая тема One Light: мягкий белый фон с классическими акцентами Atom. Светлая тема-пресет консоли Harness.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#fafafa` - фон страницы
- `surface` - `#ffffff` - панели и карточки
- `raised` - `#f0f0f1` - поля ввода и hover-состояния
- `overlay` - `#f6f6f6` - модалки и дропдауны
- `line` - `#dcdfe4` - базовые границы
- `line-strong` - `#c5cad1` - выделенные границы и активные состояния
- `fg` - `#383a42` - основной текст
- `fg-muted` - `#5c6370` - вторичный текст
- `fg-faint` - `#9d9fa8` - приглушённый текст
- `accent` - `#4078f2` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#0184bc` - ссылки и подсказки
- `warning` - `#c18401` - предупреждения
- `danger` - `#e45649` - деструктив и ошибки
- `swatch-1` - `#a626a4` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#ca1243` - категориальный: розовый
- `swatch-3` - `#b76b01` - категориальный: оранжевый
- `swatch-4` - `#50a14f` - категориальный: лайм
- `swatch-5` - `#0184bc` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "One Light (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
