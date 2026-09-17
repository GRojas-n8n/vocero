import { withAuth } from "@/lib/api";
import { listVersions } from "@/server/agent/profile-history";

export const dynamic = "force-dynamic";

/** Fase 6 — historial de comportamiento del agente (pila de deshacer). */
export const GET = withAuth(async (session) => {
  const versions = await listVersions(session.organizationId);
  return Response.json({
    versions: versions.map((v) => ({
      id: v.version.id,
      name: v.version.name,
      tone: v.version.tone,
      instructions: v.version.instructions,
      escalationRules: v.version.escalationRules,
      greeting: v.version.greeting,
      changedByName: v.changedByName,
      createdAt: v.version.createdAt.toISOString(),
    })),
  });
});
