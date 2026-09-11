import { notFound } from "next/navigation";
import { QuotesClient } from "@/components/quotes/quotes-client";
import { quotesEnabled } from "@/server/quotes/flag";

export const dynamic = "force-dynamic";

export default function QuotesPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!quotesEnabled()) notFound();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Cotizaciones</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <QuotesClient />
      </div>
    </div>
  );
}
