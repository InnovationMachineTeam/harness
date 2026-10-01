---
version: alpha
name: One Dark Pro
description: "Тёмная тема One Dark Pro: графитово-синий фон, мягкие неоновые акценты"
colors:
  primary: "{colors.accent}"
  page: "#282c34"
  surface: "#2c313a"
  raised: "#353b45"
  overlay: "#3b4048"
  line: "#3e4451"
  line-strong: "#4d5566"
  fg: "#d7dae0"
  fg-muted: "#abb2bf"
  fg-faint: "#7f8798"
  accent: "#61afef"
  info: "#56b6c2"
  warning: "#e5c07b"
  danger: "#e06c75"
  swatch-1: "#c678dd"
  swatch-2: "#e06c75"
  swatch-3: "#d19a66"
  swatch-4: "#98c379"
  swatch-5: "#56b6c2"
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

# One Dark Pro

## Overview

Тёмная тема One Dark Pro: графитово-синий фон, мягкие неоновые акценты. Тёмная тема-пресет консоли Agentic OS.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#282c34` - фон страницы
- `surface` - `#2c313a` - панели и карточки
- `raised` - `#353b45` - поля ввода и hover-состояния
- `overlay` - `#3b4048` - модалки и дропдауны
- `line` - `#3e4451` - базовые границы
- `line-strong` - `#4d5566` - выделенные границы и активные состояния
- `fg` - `#d7dae0` - основной текст
- `fg-muted` - `#abb2bf` - вторичный текст
- `fg-faint` - `#7f8798` - приглушённый текст
- `accent` - `#61afef` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#56b6c2` - ссылки и подсказки
- `warning` - `#e5c07b` - предупреждения
- `danger` - `#e06c75` - деструктив и ошибки
- `swatch-1` - `#c678dd` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#e06c75` - категориальный: розовый
- `swatch-3` - `#d19a66` - категориальный: оранжевый
- `swatch-4` - `#98c379` - категориальный: лайм
- `swatch-5` - `#56b6c2` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "One Dark Pro (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
