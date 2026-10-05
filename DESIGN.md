---
version: alpha
name: Dracula
description: "Тёмная тема консоли Harness: графитовые поверхности с эмералд-акцентом"
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
    padding: 8px
  button-ghost:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
  modal:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
  text-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-muted}"
  text-faint:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-faint}"
  badge-info:
    backgroundColor: "{colors.info}"
    textColor: "{colors.page}"
    rounded: "{rounded.md}"
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.page}"
    rounded: "{rounded.md}"
  badge-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.page}"
    rounded: "{rounded.md}"
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

Graphite - тёмная тема консоли Harness по умолчанию. Графитовые поверхности (заметно светлее "чёрной ночи") с одним хроматическим акцентом - эмералдом. Лёгкая холодная нейтральность фона не спорит с цветовыми смыслами: акценты (success/info/warning/danger) всегда читаются как сигналы, а не декор. Тема парная к Graphite Light (DESIGN.light.md).

## Colors

- `page` - фон страницы, самый тёмный слой.
- `surface` - панели и карточки, на ступень светлее страницы.
- `raised` - поля ввода, hover-состояния, "приподнятые" элементы.
- `overlay` - модальные окна и дропдауны, самый светлый из поверхностных слоёв.
- `line` - базовые границы; `line-strong` - выделенные границы и активные состояния.
- `fg` / `fg-muted` / `fg-faint` - три ступени текста: основной, вторичный, приглушённый.
- `accent` (алиас `primary`) - primary-действия и позитивные статусы; `info` - ссылки и подсказки; `warning` - предупреждения; `danger` - деструктив и ошибки.
- `swatch-1…5` - категориальная пятёрка (монограммы рантаймов, цветные бейджи): фиолетовый, розовый, оранжевый, лайм, циан.

## Typography

Системный стек без веб-шрифтов: body 14px, caption 11px (плотный дашборд), моноширинный 12px для идентификаторов, путей и терминального вывода.

## Layout

Контентная колонка до 72rem с полем 24px (`spacing.lg`); вертикальный ритм 8/16/24px (`spacing.sm/md/lg`); плотность выше обычной - консоль показывает много табличных данных.

## Elevation & Depth

Глубина передаётся светлотой поверхностей (page → surface → raised → overlay), а не тенями: тени почти не используются, разделение - границы `line`.

## Shapes

Радиусы: md 6px (кнопки, поля), lg 8px (иконные кнопки, мелкие карточки), xl 12px (панели и модалки). Полный круг - только для точек-индикаторов и аватаров.

## Components

- `button-primary` - эмералд-заливка с тёмным текстом: единственный полностью залитый элемент на экране, всегда означает главное действие.
- `button-ghost` / `input` - приподнятая поверхность `raised` с обычным текстом; вторичные действия и поля ввода.
- `panel` / `modal` - контейнеры дашборда и модалок: surface/overlay-заливка, радиус xl.
- `text-secondary` / `text-faint` - вторичная и приглушённая ступени текста.
- `badge-info/warning/danger` - залитые бейджи статусов с тёмным текстом.
- `chip-runtime-1…5` - монограммы рантаймов: категориальные цвета `swatch-1…5` на поверхности без заливки.

## Do's and Don'ts

- Используйте смысловые акценты (`accent/info/warning/danger`) по назначению, а не как декоративные цвета.
- Не вводите новые хроматические цвета поверх `swatch-1…5`: для категориальных различий расширяйте палитру, а не переиспользуйте смысловые роли.
- Текст только трёх ступеней (`fg/fg-muted/fg-faint`); четвёртая ступень - сигнал к упрощению, а не к новому оттенку.
- Не полагайтесь на тени: иерархия строится светлотой поверхностей и границами.
