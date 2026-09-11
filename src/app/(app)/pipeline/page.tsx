import { PipelineClient } from "@/components/pipeline/pipeline-client";
import { quotesEnabled } from "@/server/quotes/flag";

export const dynamic = "force-dynamic";

export default function PipelinePage() {
  return <PipelineClient quotesEnabled={quotesEnabled()} />;
}
