/**
 * 019 — Estado del mock del receptor n8n (solo entorno de pruebas).
 *
 * Existe por la misma razón que `zoom-mock-state.ts`: el self-test necesita
 * afirmar sobre lo que el CRM mandó de verdad (la FORMA del payload, la firma
 * HMAC), no solo que la llamada "no falló". `shouldFail` es el camino
 * infeliz determinista — igual que `mockCredentialsAreBad` en el mock de
 * Zoom — para probar que un receptor caído nunca cuesta la transición de
 * estado de la cotización.
 */

export type N8nMockEvent = {
  receivedAt: string;
  body: unknown;
  /** Body crudo: para recalcular el HMAC y comparar contra `signature`. */
  raw: string;
  signature: string | null;
};

type MockState = {
  events: N8nMockEvent[];
  shouldFail: boolean;
};

const globalForMock = globalThis as unknown as { __n8nMock?: MockState };

export function n8nMockState(): MockState {
  if (!globalForMock.__n8nMock) {
    globalForMock.__n8nMock = { events: [], shouldFail: false };
  }
  return globalForMock.__n8nMock;
}

export function resetN8nMock(): void {
  const s = n8nMockState();
  s.events.length = 0;
  s.shouldFail = false;
}
