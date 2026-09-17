import { describe, expect, it } from "vitest";
import { buildEventIcs } from "@/lib/ics";

const BASE = {
  uid: "bk_123@vocero",
  startUtc: "2026-08-05T15:00:00.000Z",
  durationMinutes: 30,
  summary: "Cita con Más Impulso",
};

describe("buildEventIcs", () => {
  it("por defecto publica un evento CONFIRMED", () => {
    const ics = buildEventIcs(BASE);
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain(`UID:${BASE.uid}`);
    expect(ics).toContain("DTSTART:20260805T150000Z");
    expect(ics).toContain("DTEND:20260805T153000Z");
  });

  /**
   * Antes de esto, `STATUS:CONFIRMED` estaba escrito a mano y no dependía del
   * estado de la cita: el .ics de una cita CANCELADA se veía idéntico al de
   * una vigente. Un cliente de calendario que soporta cancelaciones por UID
   * (Apple, Outlook de escritorio) necesita METHOD:CANCEL + STATUS:CANCELLED
   * en el MISMO UID para poder quitar el evento.
   */
  it("una cita cancelada se publica con METHOD:CANCEL y STATUS:CANCELLED", () => {
    const ics = buildEventIcs({ ...BASE, status: "CANCELLED" });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).not.toContain("METHOD:PUBLISH");
    expect(ics).not.toContain("STATUS:CONFIRMED");
    // Mismo UID: es lo que le permite a un cliente de calendario reconciliar
    // la cancelación con el evento que ya se había guardado.
    expect(ics).toContain(`UID:${BASE.uid}`);
  });

  it("escapa comas, punto y coma y saltos de línea en texto libre", () => {
    const ics = buildEventIcs({
      ...BASE,
      description: "Trae tu, identificación; y llega puntual\na la cita.",
    });
    expect(ics).toContain(
      "DESCRIPTION:Trae tu\\, identificación\\; y llega puntual\\na la cita."
    );
  });
});
