import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

const profile = {
  id: "agentprofile_1",
  organizationId: "org_1",
  enabled: true,
  name: "Asistente",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

describe("buildAgentSystemPrompt — agenda (015)", () => {
  it("sin agenda, no menciona horarios ni gasta tokens en offers", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: false,
    });
    expect(prompt).not.toContain("offer_slots");
    expect(prompt).not.toContain("book_slot");
    expect(prompt).not.toContain("Horarios vigentes");
  });

  it("con agenda pero sin oferta vigente, no incluye el bloque de horarios", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: true,
      offers: [],
    });
    expect(prompt).toContain("offer_slots");
    expect(prompt).not.toContain("→ startUtc:");
  });

  it("con oferta vigente, expone el startUtc EXACTO para que book_slot no lo adivine", () => {
    // Este es el bug reportado 2026-09-16: sin este bloque, el modelo solo ve
    // la etiqueta humana que él mismo mandó ("mié 16 sep, 09:00") y tiene que
    // adivinar el instante UTC — findOffered exige el epoch exacto, así que
    // adivinar casi nunca coincide y book_slot se rechaza en loop infinito.
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: true,
      offers: [
        { startUtc: "2026-09-16T15:00:00.000Z", label: "mié 16 sep, 09:00" },
        { startUtc: "2026-09-16T15:30:00.000Z", label: "mié 16 sep, 09:30" },
      ],
    });
    expect(prompt).toContain("Horarios vigentes");
    expect(prompt).toContain("mié 16 sep, 09:00");
    expect(prompt).toContain("2026-09-16T15:00:00.000Z");
    expect(prompt).toContain("mié 16 sep, 09:30");
    expect(prompt).toContain("2026-09-16T15:30:00.000Z");
    expect(prompt).toMatch(/COPIA TAL CUAL/);
  });
});
