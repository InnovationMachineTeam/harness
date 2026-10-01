---
version: alpha
name: Graphite
description: "Тёмная тема консоли по умолчанию: графитовые поверхности с эмералд-акцентом"
colors:
  primary: "{colors.accent}"
  page: "#242528"
  surface: "#2a2c30"
  raised: "#333539"
  overlay: "#383a3e"
  line: "#43464a"
  line-strong: "#55585d"
  fg: "#ececee"
  fg-muted: "#a9abae"
  fg-faint: "#94969b"
  accent: "#34d399"
  info: "#38bdf8"
  warning: "#fbbf24"
  danger: "#f87171"
  swatch-1: "#a78bfa"
  swatch-2: "#fb7185"
  swatch-3: "#fb923c"
  swatch-4: "#a3e635"
  swatch-5: "#22d3ee"
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

# Graphite

## Overview

Тёмная тема консоли по умолчанию: графитовые поверхности с эмералд-акцентом. Тёмная тема-пресет консоли Agentic OS.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#242528` - фон страницы
- `surface` - `#2a2c30` - панели и карточки
- `raised` - `#333539` - поля ввода и hover-состояния
- `overlay` - `#383a3e` - модалки и дропдауны
- `line` - `#43464a` - базовые границы
- `line-strong` - `#55585d` - выделенные границы и активные состояния
- `fg` - `#ececee` - основной текст
- `fg-muted` - `#a9abae` - вторичный текст
- `fg-faint` - `#94969b` - приглушённый текст
- `accent` - `#34d399` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#38bdf8` - ссылки и подсказки
- `warning` - `#fbbf24` - предупреждения
- `danger` - `#f87171` - деструктив и ошибки
- `swatch-1` - `#a78bfa` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#fb7185` - категориальный: розовый
- `swatch-3` - `#fb923c` - категориальный: оранжевый
- `swatch-4` - `#a3e635` - категориальный: лайм
- `swatch-5` - `#22d3ee` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "Graphite (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
