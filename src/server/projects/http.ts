import { ProjectError } from "@/server/projects/service";

/** 021 — Traduce un `ProjectError` al sobre estándar de la API. */
export function projectErrorResponse(err: unknown): Response {
  if (!(err instanceof ProjectError)) throw err;
  const status = err.code === "not_found" ? 404 : 422;
  const code = err.code === "invalid" ? "invalid_body" : err.code;
  return Response.json({ error: { code, message: err.message } }, { status });
}
