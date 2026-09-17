import { desc } from "drizzle-orm";
import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { labDisabledResponse, labEnabled } from "@/server/lab/flag";
import { RunConflictError, startRun } from "@/server/lab/runner";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withAuth(async (session) => {
  if (!labEnabled()) return labDisabledResponse();
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);
    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      // Fase 6 — una corrida sobre un cambio SIN GUARDAR no es comparable
      // con el historial de lo que sí está en producción.
      isDraftPreview: run.isDraftPreview,
      delta:
        run.status === "done" &&
        run.score !== null &&
        prev?.score != null &&
        !run.isDraftPreview
          ? run.score - prev.score
          : null,
    };
  });
  return Response.json({ runs: withDelta, aiConfigured: isAiConfigured() });
});

const profileOverrideSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
});
// Body opcional (Fase 6): sin `profileOverride`, corre contra lo publicado —
// mismo contrato de siempre para el botón "Correr" del Laboratorio.
const postSchema = z.object({
  profileOverride: profileOverrideSchema.optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!labEnabled()) return labDisabledResponse();
  if (!isAiConfigured()) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura tu proveedor de IA para correr el Laboratorio"
    );
  }
  // Un body vacío es válido (fetch sin `body` desde el botón normal):
  // solo se exige que parsee si de verdad se mandó algo.
  const raw = await req.text();
  let profileOverride: z.infer<typeof postSchema>["profileOverride"];
  if (raw.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return apiError(422, "invalid_body", "El body debe ser JSON válido");
    }
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(422, "invalid_body", "profileOverride inválido");
    }
    profileOverride = parsed.data.profileOverride;
  }
  try {
    const runId = await startRun(session.organizationId, profileOverride);
    return Response.json({ runId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) {
      return apiError(
        409,
        "run_in_progress",
        "Ya hay una corrida en curso; espera a que termine"
      );
    }
    throw err;
  }
});
