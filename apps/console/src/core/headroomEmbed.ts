/**
 * Встраивание дашборда Headroom (роуты app/dashboard/[[...path]] и
 * app/headroom-api/[[...path]]).
 *
 * Дашборд Headroom запрашивает данные root-relative fetch (`/stats`,
 * `/health`, `/stats-lifetime`, `/transformations/feed`, ...). В iframe с
 * origin консоли такие запросы уходят на консоль и дают 404 - дашборд
 * показывает "Error" и нули. Shim патчит window.fetch внутри iframe:
 * root-relative запросы того же origin (кроме путей embed-прокси
 * /dashboard*) перенаправляются на /headroom-api/* - роут-прокси на
 * литеральный апстрим 127.0.0.1:8787.
 */

export const HEADROOM_API_PREFIX = "/headroom-api";

/** Текст <script>-shim для инжекта в HTML дашборда. */
export function headroomFetchShimScript(): string {
  return `<script>(function(){if(window.__headroomShim)return;window.__headroomShim=true;var p=${JSON.stringify(HEADROOM_API_PREFIX)};var o=window.fetch;if(!o)return;window.fetch=function(i,n){try{var u=typeof i==="string"?i:i&&i.url?i.url:String(i);var a=new URL(u,location.href);if(a.origin===location.origin&&a.pathname.indexOf(p)!==0&&a.pathname!=="/dashboard"&&a.pathname.indexOf("/dashboard/")!==0){a.pathname=p+a.pathname;return o.call(window,a.toString(),n)}}catch(e){}return o.call(window,i,n)}})()</script>`;
}

/**
 * Инжектирует shim в HTML-тело ответа: перед `</head>`, при отсутствии -
 * в начало документа. Повторный вызов не меняет уже пропатченный HTML.
 */
export function injectHeadroomShim(html: string): string {
  if (html.includes("__headroomShim")) return html;
  const script = headroomFetchShimScript();
  const head = html.toLowerCase().indexOf("</head>");
  if (head === -1) return `${script}${html}`;
  return `${html.slice(0, head)}${script}${html.slice(head)}`;
}
