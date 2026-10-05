# UIKit консоли

Единый источник примитивов интерфейса Harness Console: [`apps/console/src/uikit/components/UIKit/index.tsx`](../apps/console/src/uikit/components/UIKit/index.tsx); подключение - через barrel `src/uikit/index.tsx` (импорт `@/uikit`). Все компоненты приложения живут в `src/uikit/components/` (каждый компонент реестра - папка с `index.tsx` или PascalCase-файл); экраны собираются из этих компонентов - вручную стайлить кнопки, поля, чипы и шапки страниц через Tailwind-классы не нужно.

## Правила

- **Один источник примитивов.** Новый UI-элемент сначала ищется в UIKit; если примитива нет - он добавляется в UIKit, а не в компонент экрана.
- **Нативные браузерные контролы запрещены.** Выпадающие списки - `Select` (нативный `<select>` не используется), подтверждения - `confirmDialog` (вместо `window.confirm`).
- **Тоны и варианты не дублируются.** Цветовые пресеты кнопок, чипов и notice'ов заданы tone-картами UIKit; доменный компонент выбирает тон, а не пишет классы.
- **Иконки - lucide-react.** Библиотека одна на приложение (`lucide-react`); глифы-символы в кнопках и индикаторах не используются. Icon-only кнопки - через `IconButton` (с `label` для `title`/`aria-label`), размер иконки - `size={12|14|16}` по размеру контрола.
- **UIKit домен-свободен.** Список ссылок, активный путь, каталоги данных и тексты - на стороне вызывающего.
- Документация обновляется в той же серии коммитов, что и изменение UIKit (`AGENTS.md §11`).

## Подключение

```tsx
import { Button, Panel, Select } from "@/uikit";
```

Файл помечен `"use client"`; из серверных компонентов примитивы использовать можно - они компилируются как клиентские в графе клиента. Для `confirmDialog` в корневом layout смонтирован хост `<UIKitHost />` (`apps/console/src/app/layout.tsx`) - ровно один на приложение.

## Layout: страница и навигация

| Компонент | Назначение | Ключевые пропсы |
|---|---|---|
| `Page` | Обёртка типовой страницы: `<main>` + шапка (mb-6) + контент | `title`, `description?`, `actions?`, `children`, `className?` |
| `PageHeader` | Шапка страницы: заголовок и описание слева, actions справа; `children` - доп. строки внутри левой колонки (счётчики, статусы) | те же; отступ снизу задаёт вызывающий (`className="mb-8"`) |
| `NavBar` | Горизонтальная навигация из ссылок; активная подсвечена и получает `aria-current="page"`; `right` - слот справа (бренд-строка) | `items: {href,label}[]`, `isActive(href)`, `right?`, `ariaLabel?` |

Логика "какой путь активен" передаётся колбэком - UIKit не знает про роутер. `Nav` приложения (`components/Nav.tsx`) - тонкая доменная обёртка: список разделов и правило активности (`/` - точное совпадение, остальные - `startsWith`).

Типовая страница:

```tsx
<Page
  title="MCP"
  description="Глобальный реестр MCP-серверов."
  actions={
    <Button variant="primary" size="md" onClick={() => setInstallOpen(true)}>
      Установить MCP
    </Button>
  }
>
  <McpPanel />
</Page>
```

Шапка с нестандартной композицией (дашборд: счётчики под заголовком, контролы справа) собирается из `PageHeader` напрямую, а не из `Page`.

## Управляющие элементы

| Компонент | Назначение | Ключевые пропсы |
|---|---|---|
| `Button` | Кнопка; варианты `primary` (accent) / `accent` (info) / `warning` / `danger` / `ghost` / `ghostDim` / `neutral`; размеры `xs` / `sm` / `md` | `variant`, `size`, все пропсы `<button>`; `type="button"` по умолчанию, `disabled:opacity-40` встроен |
| `IconButton` | Кнопка-иконка (lucide-react): квадратная, без текста; те же варианты и размеры, что у `Button` (квадратные габариты). С `href` рендерится `<a target="_blank">` с теми же классами | `icon: LucideIcon`, `label` (обязателен - идёт в `title` и `aria-label`), `variant`, `size`, `href?`, все пропсы `<button>` |
| `Toggle` | Переключатель (`role="switch"`); размеры `sm` (h-5 w-9) и `md` (h-6 w-11) | `checked`, `onChange(value)`, `disabled?`, `title?`, `ariaLabel?` |
| `Select` | Выпадающий список без нативного `<select>`: триггер + попап-listbox; клавиатура - ArrowUp/ArrowDown/Home/End навигация, Enter выбор, Esc закрыть; закрытие по клику вне | `value`, `options: {value,label}[]`, `onChange(value)`, `size: "sm"\|"md"`, `ariaLabel?`, `disabled?` |
| `Input` / `Textarea` | Поля ввода; размеры `compact` (px-2 py-1.5) и `form` (px-3 py-2), у Input ещё `lg` (text-sm, поиск) | все нативные пропсы; ширина через `className` |
| `Segmented` | Слитный переключатель в общей рамке (окно недавности на дашборде) | `options`, `value`, `onChange`, `ariaLabel?` |
| `Tabs` | Вкладки-кнопки (`role="tablist"`); размеры `sm` / `md`; `badge` рисует янтарное "· N" рядом с подписью | `tabs: {key,label,badge?}[]`, `active`, `onChange`, `size?` |

## Подсвеченный редактор markdown

`MarkdownEditor` (`uikit/components/MarkdownEditor/index.tsx`) - textarea поверх подсвеченной подложки (highlight.js); оба слоя с одинаковыми метриками шрифта, прокрутка поля синхронизирует подложку. Языки - фиксированный набор в `uikit/components/MarkdownEditor/highlight.ts` (markdown, bash, typescript, javascript, json, yaml, css, xml, python, sql, diff, dockerfile); тема подсветки - классы `.hljs-*` в `globals.css` на дизайн-токенах. Используется редакторами раздела "Дизайн"; `MarkdownView` подсвечивает код-блоки предпросмотра тем же модулем.

## Контейнеры и текст

| Компонент | Назначение | Ключевые пропсы |
|---|---|---|
| `Panel` | Карточка-секция (`rounded-xl border border-line bg-surface/60 p-4`); шапка: `title` слева, `actions` справа | `as: "section"\|"article"\|"div"`, `title?`, `titleClassName?`, `actions?` |
| `Modal` | Оверлей-модалка: шапка с кнопкой "Закрыть", слот `description`, футер `footer` справа; закрывается Esc и кнопкой, клик по оверлею - нет (не терять формы) | `open`, `onClose`, `title`, `description?`, `footer?`, `width?` (default `max-w-2xl`), `scroll?` (внутренний скролл, default true), `closable?` |
| `Notice` | Баннер-уведомление; тоны `info` / `success` / `error` | `tone`, `className?` |
| `Chip` | Маленький чип-лейбл; тоны `neutral` / `solid` / `muted` / `dim` / `dashed` / `accent` / `warning` / `danger` / `info`; с `onClick` рендерится кнопкой | `tone`, `size: "xs"\|"sm"`, `mono?`, `title?`, `onClick?` |
| `Loading` | Строка "загрузка…" | `children?`, `className?` |
| `EmptyState` | Плейсхолдер "пусто" в пунктирной рамке; `sm` - внутри панелей | `size: "sm"\|"md"`, `className?` |
| `SectionLabel` | Подпись секции капсом (`text-[11px] uppercase tracking-wide`) | `as: "p"\|"h3"\|"div"` |
| `FieldLabel` | Подпись поля ввода | `htmlFor?` |
| `Footnote` | Сноска под панелью (`text-[10px] text-fg-faint`) | `className?` |

## Подтверждения вместо window.confirm

`confirmDialog(options)` возвращает `Promise<boolean>` и рендерится хостом `<UIKitHost />`. Повторный вызов перебивает незакрытый диалог, резолвя его в `false`.

```tsx
const remove = async (name: string) => {
  if (
    !(await confirmDialog({
      title: `Удалить ${name}?`,
      message: "Сервер будет удалён из реестра и всех файлов рантаймов.",
      confirmLabel: "Удалить",
      tone: "danger", // красная кнопка подтверждения
    }))
  ) {
    return;
  }
  // ... подтверждено
};
```

Пропсы `ConfirmOptions`: `title`, `message?`, `confirmLabel?` (default `OK`), `cancelLabel?` (default `Отмена`), `tone?: "primary" | "danger"`.

## Утилиты

- `cx(...parts)` - склейка условных классов.
- `useClickOutside(onOutside)` - ref-хук: вызывает колбэк по mousedown вне элемента; используется в `Select` и поиске skills.sh (`components/skillsSh/SkillSearchField.tsx`).

## Дизайн-токены и темы

Цвета UI - семантические Tailwind-классы, разворачивающиеся в CSS-переменные `--design-*` (см. `apps/console/src/app/globals.css`): поверхности `bg-page` / `bg-surface` / `bg-raised` / `bg-overlay`, границы `border-line` / `border-line-strong`, текст `text-fg` / `text-fg-muted` / `text-fg-faint`, смысловые акценты `accent` / `info` / `warning` / `danger` и категориальная палитра `swatch-1…5` (монограммы рантаймов). Палитровые классы Tailwind (`zinc-*`, `emerald-*` и т.п.) в консольном UI не используются.

Темы - два слота токенов (тёмный и светлый), переключаются тумблером ☀/☾ в шапке (`Nav`, состояние в localStorage через `useConsoleStore`). Канонический источник значений - `DESIGN.md` (тёмная) и `DESIGN.light.md` (светлая) в корне репозитория в формате [`@google/design.md`](https://github.com/google-labs-code/design.md). Файлы-эталоны пресетов (5 тёмных + 5 светлых) лежат в папке `themes/` (`dark-*.md` / `light-*.md`, генерируются скриптом `apps/console/gen-themes.ts` из каталога `src/lib/themes.ts`) и подгружаются лениво (GET /api/design/theme) - при выборе пресета на вкладке "Настройки → Внешний вид". Предпросмотр файла следует за активным режимом и при твиках пересобирается на клиенте (имя "<База> (Custom)"), не записывая диск; кнопка "Сохранить" переписывает только DESIGN-файлы в корне (папка `themes/` неизменна) и managed-блок `/* design-tokens:start|end */` в globals.css (`components/design/DesignPanel.tsx`, API `/api/design`). Несохранённые твики - эфемерны (сбрасываются обновлением страницы). Внешний вид консоли - только её собственная тема; дизайн-контекст проектов ведётся в разделе "Дизайн" ([design.md](design.md)).

## Правила расширения

1. Новый примитив добавляется в `uikit/components/UIKit/index.tsx` с докблоком и попадает в таблицы этого документа в той же серии коммитов.
2. Цветовые тона задаются tone-картами UIKit (`BUTTON_VARIANTS`, `CHIP_TONES`, тоны `Notice`) - не в доменных компонентах.
3. Скругления и отступы задаются пропсами `size`/варианта, а не перекрытием классов извне - конфликты Tailwind вида `rounded` + `rounded-lg` непредсказуемы.
4. Доменные данные (списки ссылок, активный путь, каталоги, тексты) - всегда вне UIKit.
