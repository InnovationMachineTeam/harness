import { describe, expect, test } from "bun:test";
import { HEADROOM_API_PREFIX, headroomFetchShimScript, injectHeadroomShim } from "@/core/headroomEmbed";

describe("headroomFetchShimScript", () => {
  test("содержит префикс прокси и исключения embed-путей", () => {
    const script = headroomFetchShimScript();
    expect(script).toContain(HEADROOM_API_PREFIX);
    expect(script).toContain("/dashboard");
    expect(script).toContain("__headroomShim");
  });
});

describe("injectHeadroomShim", () => {
  test("инжектит перед </head>", () => {
    const html = "<html><head><title>t</title></head><body></body></html>";
    const out = injectHeadroomShim(html);
    expect(out).toContain("__headroomShim");
    expect(out.indexOf("__headroomShim")).toBeLessThan(out.indexOf("</head>"));
    expect(out.endsWith("</head><body></body></html>")).toBe(true);
  });

  test("без </head> - в начало документа", () => {
    const out = injectHeadroomShim("<html><body></body></html>");
    expect(out.startsWith("<script>")).toBe(true);
    expect(out).toContain("__headroomShim");
  });

  test("повторный вызов не меняет пропатченный HTML", () => {
    const html = "<html><head></head><body></body></html>";
    const once = injectHeadroomShim(html);
    expect(injectHeadroomShim(once)).toBe(once);
  });
});
