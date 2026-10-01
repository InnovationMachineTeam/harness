---
version: alpha
name: Tokyo Night
description: "Тёмная тема Tokyo Night: глубокий индиго-фон с неоновыми акцентами ночного города"
colors:
  primary: "{colors.accent}"
  page: "#1a1b26"
  surface: "#212330"
  raised: "#292e42"
  overlay: "#2f3450"
  line: "#292e42"
  line-strong: "#3b4261"
  fg: "#c0caf5"
  fg-muted: "#a9b1d6"
  fg-faint: "#6b7394"
  accent: "#7aa2f7"
  info: "#7dcfff"
  warning: "#e0af68"
  danger: "#f7768e"
  swatch-1: "#bb9af7"
  swatch-2: "#f7768e"
  swatch-3: "#ff9e64"
  swatch-4: "#9ece6a"
  swatch-5: "#73daca"
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

# Tokyo Night

## Overview

Тёмная тема Tokyo Night: глубокий индиго-фон с неоновыми акцентами ночного города. Тёмная тема-пресет консоли Agentic OS.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#1a1b26` - фон страницы
- `surface` - `#212330` - панели и карточки
- `raised` - `#292e42` - поля ввода и hover-состояния
- `overlay` - `#2f3450` - модалки и дропдауны
- `line` - `#292e42` - базовые границы
- `line-strong` - `#3b4261` - выделенные границы и активные состояния
- `fg` - `#c0caf5` - основной текст
- `fg-muted` - `#a9b1d6` - вторичный текст
- `fg-faint` - `#6b7394` - приглушённый текст
- `accent` - `#7aa2f7` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#7dcfff` - ссылки и подсказки
- `warning` - `#e0af68` - предупреждения
- `danger` - `#f7768e` - деструктив и ошибки
- `swatch-1` - `#bb9af7` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#f7768e` - категориальный: розовый
- `swatch-3` - `#ff9e64` - категориальный: оранжевый
- `swatch-4` - `#9ece6a` - категориальный: лайм
- `swatch-5` - `#73daca` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "Tokyo Night (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
