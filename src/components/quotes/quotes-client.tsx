"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoneyCents, parseMoneyToCents } from "@/lib/money";

/** 019 — Cotizaciones: lista, alta (desde un trato) y transiciones de estado. */

type QuoteStatus = "borrador" | "enviada" | "aceptada" | "rechazada";
type QuoteDisplayStatus = QuoteStatus | "vencida";

type QuoteItem = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

type Quote = {
  id: string;
  leadId: string;
  contactId: string;
  contactName: string;
  status: QuoteStatus;
  displayStatus: QuoteDisplayStatus;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  validUntil: string | null;
  webhookStatus: "pending" | "sent" | "failed" | "skipped";
  webhookError: string | null;
  items: QuoteItem[];
};

const STATUS_LABEL: Record<QuoteDisplayStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
};

const STATUS_VARIANT: Record<
  QuoteDisplayStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  borrador: "secondary",
  enviada: "default",
  aceptada: "success",
  rechazada: "destructive",
  vencida: "warning",
};

type DraftItem = { description: string; quantity: string; unitPrice: string };

const EMPTY_ITEM: DraftItem = { description: "", quantity: "1", unitPrice: "" };

export function QuotesClient() {
  const searchParams = useSearchParams();
  const leadId = searchParams.get("leadId");

  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftValidUntil, setDraftValidUntil] = useState("");

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function refresh() {
    const url = leadId ? `/api/quotes?leadId=${leadId}` : "/api/quotes";
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) {
      setQuotes([]);
      return;
    }
    const data = (await res.json()) as { quotes: Quote[] };
    setQuotes(data.quotes);
  }

  function addRow() {
    setDraftItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeRow(i: number) {
    setDraftItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, patch: Partial<DraftItem>) {
    setDraftItems((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row))
    );
  }

  async function createQuote() {
    if (!leadId) return;
    setError(null);
    const items = draftItems
      .filter((r) => r.description.trim())
      .map((r) => {
        const unitPriceCents = parseMoneyToCents(r.unitPrice) ?? 0;
        return {
          description: r.description.trim(),
          quantity: Math.max(1, Math.trunc(Number(r.quantity) || 1)),
          unitPriceCents,
        };
      });
    if (items.length === 0) {
      setError("Agrega al menos un renglón con descripción");
      return;
    }

    setBusy("new");
    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leadId,
        notes: draftNotes.trim() || null,
        validUntil: draftValidUntil
          ? new Date(draftValidUntil).toISOString()
          : null,
        items,
      }),
    }).catch(() => null);
    setBusy(null);

    if (res?.status !== 201) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la cotización");
      return;
    }
    setShowNew(false);
    setDraftItems([{ ...EMPTY_ITEM }]);
    setDraftNotes("");
    setDraftValidUntil("");
    await refresh();
  }

  async function act(id: string, body: unknown) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/quotes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo completar la acción");
      return;
    }
    await refresh();
  }

  async function removeDraft(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/quotes/${id}`, { method: "DELETE" }).catch(
      () => null
    );
    setBusy(null);
    if (!res?.ok) {
      setError("No se pudo borrar el borrador");
      return;
    }
    await refresh();
  }

  if (!quotes) return <p className="text-sm text-text-3">Cargando…</p>;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {leadId ? (
        <section className="space-y-2">
          {!showNew ? (
            <Button variant="secondary" onClick={() => setShowNew(true)}>
              Nueva cotización
            </Button>
          ) : (
            <div className="space-y-3 rounded-md border p-3">
              <h3 className="text-sm font-semibold">Nueva cotización</h3>

              <div className="space-y-2">
                {draftItems.map((row, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[180px] flex-1 space-y-1.5">
                      <Label htmlFor={`desc-${i}`}>Descripción</Label>
                      <Input
                        id={`desc-${i}`}
                        value={row.description}
                        onChange={(e) =>
                          updateRow(i, { description: e.target.value })
                        }
                        placeholder="Consultoría, mes 1"
                      />
                    </div>
                    <div className="w-20 space-y-1.5">
                      <Label htmlFor={`qty-${i}`}>Cant.</Label>
                      <Input
                        id={`qty-${i}`}
                        type="number"
                        min={1}
                        value={row.quantity}
                        onChange={(e) =>
                          updateRow(i, { quantity: e.target.value })
                        }
                      />
                    </div>
                    <div className="w-32 space-y-1.5">
                      <Label htmlFor={`price-${i}`}>Precio unitario</Label>
                      <Input
                        id={`price-${i}`}
                        value={row.unitPrice}
                        onChange={(e) =>
                          updateRow(i, { unitPrice: e.target.value })
                        }
                        placeholder="1,500"
                      />
                    </div>
                    {draftItems.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRow(i)}
                      >
                        Quitar
                      </Button>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={addRow}>
                  + Renglón
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="valid-until">Vence</Label>
                  <Input
                    id="valid-until"
                    type="date"
                    value={draftValidUntil}
                    onChange={(e) => setDraftValidUntil(e.target.value)}
                    className="w-40"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notas</Label>
                <Textarea
                  id="notes"
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="Condiciones, forma de pago…"
                />
              </div>

              <div className="flex gap-2">
                <Button disabled={busy === "new"} onClick={createQuote}>
                  Guardar borrador
                </Button>
                <Button variant="ghost" onClick={() => setShowNew(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <p className="text-sm text-text-3">
          Para crear una cotización, ábrela desde la tarjeta del trato en el
          pipeline.
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          {leadId ? "Cotizaciones de este trato" : "Todas las cotizaciones"}{" "}
          <span className="text-text-3">({quotes.length})</span>
        </h3>
        {quotes.length === 0 && (
          <p className="text-sm text-text-3">Todavía no hay cotizaciones.</p>
        )}
        <ul className="divide-y rounded-md border">
          {quotes.map((q) => (
            <li key={q.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{q.contactName}</span>
                <span className="text-sm tabular-nums text-text-3">
                  {formatMoneyCents(q.totalCents, q.currency)}
                </span>
                <Badge variant={STATUS_VARIANT[q.displayStatus]}>
                  {STATUS_LABEL[q.displayStatus]}
                </Badge>
                {q.status === "enviada" &&
                  q.webhookStatus === "failed" && (
                    <Badge variant="secondary" title={q.webhookError ?? undefined}>
                      n8n no se enteró
                    </Badge>
                  )}
              </div>

              <ul className="space-y-0.5 text-sm text-text-3">
                {q.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {item.quantity} × {item.description}
                    </span>
                    <span className="tabular-nums">
                      {formatMoneyCents(item.totalCents, q.currency)}
                    </span>
                  </li>
                ))}
              </ul>

              {q.notes && <p className="text-sm text-text-3">{q.notes}</p>}
              {q.validUntil && (
                <p className="text-xs text-text-3">
                  Vence: {new Date(q.validUntil).toLocaleDateString("es-MX")}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {q.status === "borrador" && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy === q.id}
                      onClick={() => act(q.id, { action: "send" })}
                    >
                      Enviar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === q.id}
                      onClick={() => removeDraft(q.id)}
                    >
                      Borrar
                    </Button>
                  </>
                )}
                {q.status === "enviada" && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy === q.id}
                      onClick={() => act(q.id, { action: "accept" })}
                    >
                      Marcar aceptada
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === q.id}
                      onClick={() => act(q.id, { action: "reject" })}
                    >
                      Marcar rechazada
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
