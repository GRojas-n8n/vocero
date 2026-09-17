import { AgentClient } from "@/components/agent/agent-client";
import { labEnabled } from "@/server/lab/flag";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  return <AgentClient labEnabled={labEnabled()} />;
}
