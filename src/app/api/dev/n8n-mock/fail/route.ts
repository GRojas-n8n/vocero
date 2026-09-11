import { mockGuard } from "@/lib/dev-guard";
import { n8nMockState } from "@/server/dev/n8n-mock-state";

export const dynamic = "force-dynamic";

/** 019 — Interruptor del camino infeliz determinista del mock de n8n. */
export async function POST() {
  const guard = mockGuard();
  if (guard) return guard;
  n8nMockState().shouldFail = true;
  return Response.json({ ok: true });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  n8nMockState().shouldFail = false;
  return Response.json({ ok: true });
}
