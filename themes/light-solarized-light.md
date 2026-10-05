---
version: alpha
name: Solarized Light
description: "Светлая тема Solarized: тёплый кремовый фон и землистые акценты"
colors:
  primary: "{colors.accent}"
  page: "#fdf6e3"
  surface: "#fefaf1"
  raised: "#eee8d5"
  overlay: "#f4eeda"
  line: "#ddd6c1"
  line-strong: "#c8c0a8"
  fg: "#073642"
  fg-muted: "#586e75"
  fg-faint: "#93a1a1"
  accent: "#268bd2"
  info: "#2aa198"
  warning: "#b58900"
  danger: "#dc322f"
  swatch-1: "#6c71c4"
  swatch-2: "#d33682"
  swatch-3: "#cb4b16"
  swatch-4: "#859900"
  swatch-5: "#2aa198"
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

# Solarized Light

## Overview

Светлая тема Solarized: тёплый кремовый фон и землистые акценты. Светлая тема-пресет консоли Harness.

Файл-эталон: находится в `themes/`, читается лениво (GET /api/design/theme) и показывается на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении папка `themes/` не меняется - обновляются только `DESIGN.md` и `DESIGN.light.md` в корне.

## Colors

- `page` - `#fdf6e3` - фон страницы
- `surface` - `#fefaf1` - панели и карточки
- `raised` - `#eee8d5` - поля ввода и hover-состояния
- `overlay` - `#f4eeda` - модалки и дропдауны
- `line` - `#ddd6c1` - базовые границы
- `line-strong` - `#c8c0a8` - выделенные границы и активные состояния
- `fg` - `#073642` - основной текст
- `fg-muted` - `#586e75` - вторичный текст
- `fg-faint` - `#93a1a1` - приглушённый текст
- `accent` - `#268bd2` - primary-действия и позитивные статусы (алиас primary)
- `info` - `#2aa198` - ссылки и подсказки
- `warning` - `#b58900` - предупреждения
- `danger` - `#dc322f` - деструктив и ошибки
- `swatch-1` - `#6c71c4` - категориальный: фиолетовый (монограммы рантаймов)
- `swatch-2` - `#d33682` - категориальный: розовый
- `swatch-3` - `#cb4b16` - категориальный: оранжевый
- `swatch-4` - `#859900` - категориальный: лайм
- `swatch-5` - `#2aa198` - категориальный: циан

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design и запекаются в `DESIGN.md` / `DESIGN.light.md` (кастом получает имя "Solarized Light (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится в `DESIGN.md` / `DESIGN.light.md`, а `themes/` - только каталог пресетов.
