import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  // Sentinel para el self-test: valida el flujo de "credenciales rechazadas"
  // (contrato ai.md) sin depender de un token real.
  if (req.headers.get("authorization") === "Bearer token-invalido") {
    return Response.json(
      { error: { message: "Invalid API key" } },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: unknown }[];
  };
  const content = aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
