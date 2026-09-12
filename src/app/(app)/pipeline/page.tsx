import { PipelineClient } from "@/components/pipeline/pipeline-client";
import { quotesEnabled } from "@/server/quotes/flag";
import { assetsEnabled } from "@/server/assets/flag";
import { projectsEnabled } from "@/server/projects/flag";

export const dynamic = "force-dynamic";

export default function PipelinePage() {
  return (
    <PipelineClient
      quotesEnabled={quotesEnabled()}
      assetsEnabled={assetsEnabled()}
      projectsEnabled={projectsEnabled()}
    />
  );
}
