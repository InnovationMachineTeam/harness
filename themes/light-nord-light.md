---
version: alpha
name: Nord Light
description: "Светлая тема Nord (Snow Storm): снежно-серые поверхности и стальной синий"
colors:
  primary: "{colors.accent}"
  page: "#eceff4"
  surface: "#fafbfd"
  raised: "#e3e8f0"
  overlay: "#eef2f7"
  line: "#d8dee9"
  line-strong: "#b9c3d1"
  fg: "#2e3440"
  fg-muted: "#434c5e"
  fg-faint: "#7b8694"
  accent: "#5e81ac"
  info: "#5c8cb8"
  warning: "#b58900"
  danger: "#b5505a"
  swatch-1: "#8f6d92"
  swatch-2: "#b5654a"
  swatch-3: "#739e57"
  swatch-4: "#5ba3a0"
  swatch-5: "#6a93c4"
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

# Nord Light

## Overview

Светлая тема Nord (Snow Storm): снежно-серые поверхности и стальной синий. Светлая тема-пресет консоли Harness.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#eceff4` - фон страницы
- `surface` - `#fafbfd` - панели и карточки
- `raised` - `#e3e8f0` - поля ввода и hover-состояния
- `overlay` - `#eef2f7` - модалки и дропдауны
- `line` - `#d8dee9` - базовые границы
- `line-strong` - `#b9c3d1` - выделенные границы и активные состояния
- `fg` - `#2e3440` - основной текст
- `fg-muted` - `#434c5e` - вторичный текст
- `fg-faint` - `#7b8694` - приглушённый текст
- `accent` - `#5e81ac` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#5c8cb8` - ссылки и подсказки
- `warning` - `#b58900` - предупреждения
- `danger` - `#b5505a` - деструктив и ошибки
- `swatch-1` - `#8f6d92` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#b5654a` - категориальный: розовый
- `swatch-3` - `#739e57` - категориальный: оранжевый
- `swatch-4` - `#5ba3a0` - категориальный: лайм
- `swatch-5` - `#6a93c4` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "Nord Light (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
