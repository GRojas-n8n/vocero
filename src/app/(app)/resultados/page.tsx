import { ResultsClient } from "@/components/results/results-client";

export const dynamic = "force-dynamic";

export default function ResultadosPage() {
  return (
    <div className="h-full overflow-y-auto">
      <ResultsClient />
    </div>
  );
}
