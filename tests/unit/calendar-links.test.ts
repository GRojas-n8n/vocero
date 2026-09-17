import { describe, expect, it } from "vitest";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar-links";

/**
 * Enlaces de "agregar a mi calendario" que el prospecto ve en la página de
 * confirmación de la cita. Puros: sin red, sin BD — el instante que llevan es
 * el que se les pasa, así que si la cita cambia, basta con volver a llamarlos
 * con los datos frescos (la página los recalcula en cada carga).
 */

const INPUT = {
  title: "Cita con Más Impulso",
  startUtc: "2026-08-05T15:00:00.000Z",
  durationMinutes: 30,
  description: "Sesión de diagnóstico inicial.",
  location: "https://meet.ejemplo.com/sala",
  timezone: "America/Mexico_City",
};

describe("googleCalendarUrl", () => {
  it("apunta al render de Google Calendar en modo plantilla", () => {
    const url = new URL(googleCalendarUrl(INPUT));
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render"
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
  });

  it("codifica inicio y fin en UTC compacto, separados por /", () => {
    const url = new URL(googleCalendarUrl(INPUT));
    // 15:00Z + 30 min = 15:30Z.
    expect(url.searchParams.get("dates")).toBe(
      "20260805T150000Z/20260805T153000Z"
    );
  });

  it("lleva título, descripción, lugar y zona horaria", () => {
    const url = new URL(googleCalendarUrl(INPUT));
    expect(url.searchParams.get("text")).toBe(INPUT.title);
    expect(url.searchParams.get("details")).toBe(INPUT.description);
    expect(url.searchParams.get("location")).toBe(INPUT.location);
    expect(url.searchParams.get("ctz")).toBe(INPUT.timezone);
  });

  it("descripción y lugar son opcionales", () => {
    const url = new URL(
      googleCalendarUrl({
        title: INPUT.title,
        startUtc: INPUT.startUtc,
        durationMinutes: INPUT.durationMinutes,
        timezone: INPUT.timezone,
      })
    );
    expect(url.searchParams.has("details")).toBe(false);
    expect(url.searchParams.has("location")).toBe(false);
  });
});

describe("outlookCalendarUrl", () => {
  it("apunta al deeplink de Outlook para agregar un evento", () => {
    const url = new URL(outlookCalendarUrl(INPUT));
    expect(url.origin + url.pathname).toBe(
      "https://outlook.live.com/calendar/0/deeplink/compose"
    );
    expect(url.searchParams.get("rru")).toBe("addevent");
  });

  it("codifica inicio y fin como ISO 8601 en UTC", () => {
    const url = new URL(outlookCalendarUrl(INPUT));
    expect(url.searchParams.get("startdt")).toBe("2026-08-05T15:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2026-08-05T15:30:00.000Z");
  });

  it("lleva asunto, cuerpo y lugar", () => {
    const url = new URL(outlookCalendarUrl(INPUT));
    expect(url.searchParams.get("subject")).toBe(INPUT.title);
    expect(url.searchParams.get("body")).toBe(INPUT.description);
    expect(url.searchParams.get("location")).toBe(INPUT.location);
  });
});
