"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 020 — Activos de cliente: infraestructura y credenciales de un trato.
 * Vive dentro del cajón del trato (`LeadDrawer`), no en una pantalla aparte
 * — es información del cliente, no algo que se explore suelto.
 */

type ClientAssetType =
  | "domain"
  | "vps"
  | "wordpress"
  | "github"
  | "cloudflare"
  | "other";

type ClientAsset = {
  id: string;
  leadId: string;
  type: ClientAssetType;
  name: string;
  url: string | null;
  username: string | null;
  hasSecret: boolean;
  expiresAt: string | null;
  notes: string | null;
};

const TYPE_LABEL: Record<ClientAssetType, string> = {
  domain: "Dominio",
  vps: "VPS",
  wordpress: "WordPress",
  github: "GitHub",
  cloudflare: "Cloudflare",
  other: "Otro",
};

type Draft = {
  type: ClientAssetType;
  name: string;
  url: string;
  username: string;
  secret: string;
  expiresAt: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = {
  type: "domain",
  name: "",
  url: "",
  username: "",
  secret: "",
  expiresAt: "",
  notes: "",
};

export function AssetsPanel({ leadId }: { leadId: string }) {
  const [assets, setAssets] = useState<ClientAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function refresh() {
    const res = await fetch(`/api/assets?leadId=${leadId}`).catch(() => null);
    if (!res?.ok) {
      setAssets([]);
      return;
    }
    const data = (await res.json()) as { assets: ClientAsset[] };
    setAssets(data.assets);
  }

  async function crear() {
    if (!draft.name.trim()) {
      setError("El activo necesita un nombre");
      return;
    }
    setError(null);
    setBusy("new");
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leadId,
        type: draft.type,
        name: draft.name.trim(),
        url: draft.url.trim() || null,
        username: draft.username.trim() || null,
        secret: draft.secret || null,
        expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
        notes: draft.notes.trim() || null,
      }),
    }).catch(() => null);
    setBusy(null);

    if (res?.status !== 201) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar el activo");
      return;
    }
    setShowNew(false);
    setDraft({ ...EMPTY_DRAFT });
    await refresh();
  }

  async function borrar(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/assets/${id}`, { method: "DELETE" }).catch(
      () => null
    );
    setBusy(null);
    if (!res?.ok) {
      setError("No se pudo borrar el activo");
      return;
    }
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await refresh();
  }

  async function revelar(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/assets/${id}/secret`).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError("No se pudo revelar la clave");
      return;
    }
    const data = (await res.json()) as { secret: string | null };
    if (data.secret !== null) {
      setRevealed((prev) => ({ ...prev, [id]: data.secret! }));
    }
  }

  function ocultar(id: string) {
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  if (!assets) return <p className="text-sm text-text-3">Cargando…</p>;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!showNew ? (
        <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}>
          + Activo
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap gap-2">
            <div className="w-32 space-y-1.5">
              <Label htmlFor="asset-type">Tipo</Label>
              <select
                id="asset-type"
                value={draft.type}
                onChange={(e) =>
                  setDraft({ ...draft, type: e.target.value as ClientAssetType })
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft"
              >
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <Label htmlFor="asset-name">Nombre</Label>
              <Input
                id="asset-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="ejemplo.com"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <Label htmlFor="asset-url">URL</Label>
              <Input
                id="asset-url"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://ejemplo.com/wp-admin"
              />
            </div>
            <div className="min-w-[140px] flex-1 space-y-1.5">
              <Label htmlFor="asset-username">Usuario</Label>
              <Input
                id="asset-username"
                value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="asset-secret">Clave / secreto</Label>
            <Input
              id="asset-secret"
              type="password"
              value={draft.secret}
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
              placeholder="Se guarda cifrado — nunca se muestra en la lista"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="asset-expires">Vence</Label>
              <Input
                id="asset-expires"
                type="date"
                value={draft.expiresAt}
                onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
                className="w-40"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="asset-notes">Notas</Label>
            <Textarea
              id="asset-notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" disabled={busy === "new"} onClick={() => void crear()}>
              Guardar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowNew(false);
                setDraft({ ...EMPTY_DRAFT });
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {assets.length === 0 && !showNew && (
        <p className="text-sm text-text-3">Todavía no hay activos registrados.</p>
      )}

      <ul className="space-y-2">
        {assets.map((a) => (
          <li key={a.id} className="rounded-md border p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {a.name}
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-normal text-text-3">
                    {TYPE_LABEL[a.type]}
                  </span>
                </p>
                {a.url && (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-brand hover:underline"
                  >
                    {a.url}
                  </a>
                )}
                {a.username && (
                  <p className="text-xs text-text-3">Usuario: {a.username}</p>
                )}
              </div>
              <button
                aria-label="Borrar activo"
                disabled={busy === a.id}
                onClick={() => void borrar(a.id)}
                className="rounded p-1 text-text-3 hover:bg-accent hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {a.hasSecret && (
              <div className="mt-1.5 flex items-center gap-2">
                {revealed[a.id] ? (
                  <>
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                      {revealed[a.id]}
                    </code>
                    <button
                      aria-label="Ocultar clave"
                      onClick={() => ocultar(a.id)}
                      className="text-text-3 hover:text-foreground"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy === a.id}
                    onClick={() => void revelar(a.id)}
                    className={cn(
                      "flex items-center gap-1 text-xs text-text-3 hover:text-foreground"
                    )}
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Ver clave
                    <Eye className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            {a.expiresAt && (
              <p className="mt-1 text-[11px] text-text-3">
                Vence: {new Date(a.expiresAt).toLocaleDateString("es-MX")}
              </p>
            )}
            {a.notes && <p className="mt-1 text-xs text-text-3">{a.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
