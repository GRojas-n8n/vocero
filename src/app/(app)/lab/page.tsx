import { notFound } from "next/navigation";
import { LabClient } from "@/components/lab/lab-client";
import { labEnabled } from "@/server/lab/flag";

export const dynamic = "force-dynamic";

export default function LabPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!labEnabled()) notFound();
  return <LabClient />;
}
