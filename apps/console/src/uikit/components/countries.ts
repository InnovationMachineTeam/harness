import { VENDOR_COUNTRY_META, type VendorCountry } from "@/core/types";

/** Значение фильтра страны: конкретная страна или "все". */
export type CountryFilter = VendorCountry | "all";

/**
 * Опции фильтра страны: emoji-флаг, подпись страны - в подсказке кнопки
 * (title); количество карточек подставляет вызывающий. Порядок - все, us, eu, ru, ch, world.
 */
export const COUNTRY_FILTERS: readonly { key: CountryFilter; label: string; title: string }[] = [
  { key: "all", label: "🌐", title: "Все страны" },
  ...(Object.keys(VENDOR_COUNTRY_META) as VendorCountry[]).map((key) => ({
    key: key as CountryFilter,
    label: VENDOR_COUNTRY_META[key].flag,
    title: VENDOR_COUNTRY_META[key].label,
  })),
];

/** Подпись страны карточки: emoji-флаг и код. Неизвестное значение - "🌍 World". */
export function countryLabel(country: VendorCountry | undefined): string {
  const meta = VENDOR_COUNTRY_META[country ?? "world"] ?? VENDOR_COUNTRY_META.world;
  return `${meta.flag} ${meta.label}`;
}

/** Карточка входит в выбранную страну; "world" - все, не попавшие в us/eu/ru/ch. */
export function matchesCountry(country: VendorCountry | undefined, filter: CountryFilter): boolean {
  return filter === "all" || (country ?? "world") === filter;
}
