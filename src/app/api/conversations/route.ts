import { withAuth } from "@/lib/api";
import { listConversations } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  // Mismo contrato que `archived=true` en /api/contacts: agrega los
  // archivados a la lista, no reemplaza la vista activa por ellos.
  const includeArchived = url.searchParams.get("archived") === "true";
  const conversations = await listConversations(
    session.organizationId,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
    { includeArchived }
  );
  return Response.json({ conversations });
});
