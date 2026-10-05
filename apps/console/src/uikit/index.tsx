"use client";

/**
 * Точка входа кита: примитивы живут в components/UIKit, реэкспорт сохраняет
 * короткий импорт "@/uikit" для всех экранов. Остальные компоненты кита -
 * в своих папках: components/VirtualList, components/MarkdownEditor.
 */

export * from "./components/UIKit";
