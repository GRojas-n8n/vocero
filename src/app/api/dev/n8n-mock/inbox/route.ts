import { mockGuard } from "@/lib/dev-guard";
import { n8nMockState, resetN8nMock } from "@/server/dev/n8n-mock-state";

export const dynamic = "force-dynamic";

/**
 * 019 — Receptor de prueba del webhook saliente de cotizaciones. Apunta aquí
 * `QUOTES_N8N_WEBHOOK_URL` durante el self-test (ver tests/e2e/us-cotizaciones.md)
 * para que el arnés pueda afirmar sobre lo que el CRM manda de verdad.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const raw = await req.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // el CRM siempre manda JSON válido; un body roto se guarda como null y
    // el self-test lo vería en `events` igual.
  }

  const state = n8nMockState();
  if (state.shouldFail) {
    // El camino infeliz determinista: simula un n8n caído o que rechaza.
    return new Response(null, { status: 500 });
  }

  state.events.push({
    receivedAt: new Date().toISOString(),
    body,
    raw,
    signature: req.headers.get("x-vocero-signature"),
  });
  return Response.json({ ok: true });
}

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ events: n8nMockState().events });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetN8nMock();
  return Response.json({ cleared: true });
}
