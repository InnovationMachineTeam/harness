---
version: alpha
name: Dracula
description: "Классическая тёмная палитра Dracula: сине-фиолетовый фон и неоновые акценты"
colors:
  primary: "{colors.accent}"
  page: "#282a36"
  surface: "#2d2f3d"
  raised: "#353846"
  overlay: "#3b3e4e"
  line: "#44475a"
  line-strong: "#565869"
  fg: "#f8f8f2"
  fg-muted: "#a9adcd"
  fg-faint: "#6272a4"
  accent: "#50fa7b"
  info: "#8be9fd"
  warning: "#f1fa8c"
  danger: "#ff5555"
  swatch-1: "#bd93f9"
  swatch-2: "#ff79c6"
  swatch-3: "#ffb86c"
  swatch-4: "#f1fa8c"
  swatch-5: "#57c7ff"
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

# Dracula

## Overview

Классическая тёмная палитра Dracula: сине-фиолетовый фон и неоновые акценты. Тёмная тема-пресет консоли Harness.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#282a36` - фон страницы
- `surface` - `#2d2f3d` - панели и карточки
- `raised` - `#353846` - поля ввода и hover-состояния
- `overlay` - `#3b3e4e` - модалки и дропдауны
- `line` - `#44475a` - базовые границы
- `line-strong` - `#565869` - выделенные границы и активные состояния
- `fg` - `#f8f8f2` - основной текст
- `fg-muted` - `#a9adcd` - вторичный текст
- `fg-faint` - `#6272a4` - приглушённый текст
- `accent` - `#50fa7b` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#8be9fd` - ссылки и подсказки
- `warning` - `#f1fa8c` - предупреждения
- `danger` - `#ff5555` - деструктив и ошибки
- `swatch-1` - `#bd93f9` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#ff79c6` - категориальный: розовый
- `swatch-3` - `#ffb86c` - категориальный: оранжевый
- `swatch-4` - `#f1fa8c` - категориальный: лайм
- `swatch-5` - `#57c7ff` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "Dracula (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
