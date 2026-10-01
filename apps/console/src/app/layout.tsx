import type { Metadata } from "next";
import { DesignProvider } from "@/components/DesignProvider";
import { Nav } from "@/components/Nav";
import { StoreHydrator } from "@/components/StoreHydrator";
import { UIKitHost } from "@/ui/UIKit";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic OS Console",
  description: "Дашборд рантаймов агентов: активность, MCP, навыки, сессии, процессы",
};

/** До гидратации ставит data-theme из localStorage - иначе вспышка тёмной темы. */
const themeBootScript = `try{var s=JSON.parse(localStorage.getItem("agentic-console-ui")||"{}").state||{};document.documentElement.dataset.theme=s.theme==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen bg-page text-fg antialiased">
        <DesignProvider />
        <div className="mx-auto max-w-6xl px-6 py-8">
          <StoreHydrator />
          <Nav />
          {children}
        </div>
        <UIKitHost />
      </body>
    </html>
  );
}
