import { describe, expect, it } from "vitest";
import { bookingCopy, type PublicBooking } from "@/server/agenda/public-view";

/**
 * 015 — El título que ve un prospecto ajeno al CRM (.ics, Google/Outlook,
 * página de confirmación) viene SIEMPRE de `calendar_settings.appointment_title`
 * (ya resuelto por `getSettings`), nunca del nombre de la organización: ese
 * puede ser un placeholder de setup ("Negocio de Germán") que nadie quiere
 * mostrarle a un cliente.
 */

const BASE: PublicBooking = {
  id: "bk_123",
  status: "agendada",
  scheduledAt: new Date("2026-08-05T15:00:00.000Z"),
  durationMinutes: 30,
  updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  meetingLink: null,
  linkPending: false,
  connectorLabel: undefined,
  timezone: "America/Mexico_City",
  orgName: "Negocio de Germán",
  contactName: "Ana",
  appointmentTitle: "Llamada inicial | Más Impulso Digital",
};

describe("bookingCopy", () => {
  it("usa el título configurado, no el nombre (placeholder) de la organización", () => {
    const { title } = bookingCopy(BASE);
    expect(title).toBe("Llamada inicial | Más Impulso Digital");
    expect(title).not.toContain("Negocio de Germán");
  });

  it("el título no depende de si hay nombre de contacto o de organización", () => {
    const { title } = bookingCopy({ ...BASE, orgName: "", contactName: "" });
    expect(title).toBe("Llamada inicial | Más Impulso Digital");
  });

  it("la descripción sí puede llevar el nombre del contacto", () => {
    const { description } = bookingCopy(BASE);
    expect(description).toContain("Cita de Ana.");
  });
});
