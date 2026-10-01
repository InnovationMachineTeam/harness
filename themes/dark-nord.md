---
version: alpha
name: Nord
description: "Тёмная тема Nord: полярная ночь и морозные синие акценты"
colors:
  primary: "{colors.accent}"
  page: "#2e3440"
  surface: "#3b4252"
  raised: "#434c5e"
  overlay: "#4c566a"
  line: "#4c566a"
  line-strong: "#5e6a86"
  fg: "#eceff4"
  fg-muted: "#c0c8d8"
  fg-faint: "#8891a5"
  accent: "#88c0d0"
  info: "#81a1c1"
  warning: "#ebcb8b"
  danger: "#bf616a"
  swatch-1: "#b48ead"
  swatch-2: "#d08770"
  swatch-3: "#a3be8c"
  swatch-4: "#8fbcbb"
  swatch-5: "#88c0d0"
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
    textColor: "{colors.page}"
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

# Nord

## Overview

Тёмная тема Nord: полярная ночь и морозные синие акценты. Тёмная тема-пресет консоли Agentic OS.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#2e3440` - фон страницы
- `surface` - `#3b4252` - панели и карточки
- `raised` - `#434c5e` - поля ввода и hover-состояния
- `overlay` - `#4c566a` - модалки и дропдауны
- `line` - `#4c566a` - базовые границы
- `line-strong` - `#5e6a86` - выделенные границы и активные состояния
- `fg` - `#eceff4` - основной текст
- `fg-muted` - `#c0c8d8` - вторичный текст
- `fg-faint` - `#8891a5` - приглушённый текст
- `accent` - `#88c0d0` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#81a1c1` - ссылки и подсказки
- `warning` - `#ebcb8b` - предупреждения
- `danger` - `#bf616a` - деструктив и ошибки
- `swatch-1` - `#b48ead` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#d08770` - категориальный: розовый
- `swatch-3` - `#a3be8c` - категориальный: оранжевый
- `swatch-4` - `#8fbcbb` - категориальный: лайм
- `swatch-5` - `#88c0d0` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "Nord (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
