import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { testAiCredentials } from "@/lib/ai";
import { getAiCredentials } from "@/server/ai/credentials";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().trim().optional(),
  model: z.string().trim().optional(),
});

/**
 * Probar sin guardar. Con los campos vacíos prueba lo YA guardado — así el
 * operador puede verificar la conexión sin volver a pegar un token que la UI
 * nunca le devolvió.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const stored = await getAiCredentials(session.organizationId);
  const token = body.data.token || stored?.token;
  const model = body.data.model || stored?.model;

  if (!token || !model) {
    return apiError(422, "invalid_body", "Faltan el token o el modelo a probar");
  }

  const check = await testAiCredentials({ apiToken: token, model });
  if (!check.ok) return apiError(422, "ai_invalid", check.error);
  return Response.json({ ok: true });
});
