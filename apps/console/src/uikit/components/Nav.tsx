"use client";

import { Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useConsoleStore } from "@/store/console";
import { IconButton, NavBar } from "@/uikit";

const LINKS = [
  { href: "/agent", label: "Агент" },
  { href: "/design", label: "Дизайн" },
  { href: "/runtimes", label: "Рантаймы" },
  { href: "/memory", label: "Знание" },
  { href: "/monitoring", label: "Мониторинг" },
  { href: "/settings", label: "Настройки" },
];

/** Доменная обёртка NavBar: список разделов, правило активности пути и тумблер темы. */
export function Nav() {
  const pathname = usePathname();
  const theme = useConsoleStore((s) => s.theme);
  const setTheme = useConsoleStore((s) => s.setTheme);
  return (
    <NavBar
      items={LINKS}
      isActive={(href) => (href === "/" ? pathname === "/" : pathname.startsWith(href))}
      right={
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-fg-faint">Harness Console</span>
          <IconButton
            icon={theme === "dark" ? Sun : Moon}
            label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            size="sm"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          />
        </span>
      }
    />
  );
}
