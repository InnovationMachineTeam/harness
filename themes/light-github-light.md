---
version: alpha
name: GitHub Light
description: "Светлая тема GitHub: белый фон, синий primary и строгие статусные цвета"
colors:
  primary: "{colors.accent}"
  page: "#ffffff"
  surface: "#f6f8fa"
  raised: "#eff2f5"
  overlay: "#ffffff"
  line: "#d1d9e0"
  line-strong: "#afb8c1"
  fg: "#1f2328"
  fg-muted: "#59636e"
  fg-faint: "#818b98"
  accent: "#0969da"
  info: "#1b7c83"
  warning: "#9a6700"
  danger: "#cf222e"
  swatch-1: "#8250df"
  swatch-2: "#bf3989"
  swatch-3: "#bc4c00"
  swatch-4: "#1a7f37"
  swatch-5: "#1b7c83"
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

# GitHub Light

## Overview

Светлая тема GitHub: белый фон, синий primary и строгие статусные цвета. Светлая тема-пресет консоли Agentic OS.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#ffffff` - фон страницы
- `surface` - `#f6f8fa` - панели и карточки
- `raised` - `#eff2f5` - поля ввода и hover-состояния
- `overlay` - `#ffffff` - модалки и дропдауны
- `line` - `#d1d9e0` - базовые границы
- `line-strong` - `#afb8c1` - выделенные границы и активные состояния
- `fg` - `#1f2328` - основной текст
- `fg-muted` - `#59636e` - вторичный текст
- `fg-faint` - `#818b98` - приглушённый текст
- `accent` - `#0969da` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#1b7c83` - ссылки и подсказки
- `warning` - `#9a6700` - предупреждения
- `danger` - `#cf222e` - деструктив и ошибки
- `swatch-1` - `#8250df` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#bf3989` - категориальный: розовый
- `swatch-3` - `#bc4c00` - категориальный: оранжевый
- `swatch-4` - `#1a7f37` - категориальный: лайм
- `swatch-5` - `#1b7c83` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "GitHub Light (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
