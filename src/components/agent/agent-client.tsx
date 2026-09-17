"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, History, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
};

/** Los únicos campos que entran a la vista previa / historial (Fase 6):
 *  `enabled` es un interruptor instantáneo, no una "versión" de instrucciones. */
type BehaviorField = "name" | "tone" | "instructions" | "escalationRules" | "greeting";
const BEHAVIOR_FIELDS: { key: BehaviorField; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "tone", label: "Tono" },
  { key: "instructions", label: "Instrucciones" },
  { key: "escalationRules", label: "Reglas de escalado" },
  { key: "greeting", label: "Saludo" },
];

type ProfileVersion = {
  id: string;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
  changedByName: string | null;
  createdAt: string;
};

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export function AgentClient({ labEnabled }: { labEnabled: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  const refetch = useCallback(async () => {
    const [p, kb, size] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  async function saveProfile(patch: Partial<Profile>) {
    await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void refetch();
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Agente de IA</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label="Agente encendido"
            disabled={!aiConfigured}
            onClick={() => void saveProfile({ enabled: !profile.enabled })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
              profile.enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-knob transition-transform ${
                profile.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </header>

      {!aiConfigured && (
        <div className="mx-4 mt-4 rounded-lg border border-brand-soft bg-brand-tint p-5 text-center sm:mx-6 sm:mt-6 sm:p-6">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">Configura tu proveedor de IA para activar el agente</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Agrega <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code> y{" "}
            <code className="rounded bg-secondary px-1">OPENROUTER_MODEL</code> a las variables
            de entorno de la instancia y reiníciala. Mientras tanto puedes dejar listo el
            comportamiento y el conocimiento aquí abajo.
          </p>
        </div>
      )}

      <div className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-2">
        <div className="space-y-4 sm:space-y-6">
          <ProfileSection profile={profile} labEnabled={labEnabled} onSave={saveProfile} />
          <HistorySection onRestored={() => void refetch()} />
        </div>
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
      </div>
    </div>
  );
}

function ProfileSection({
  profile,
  labEnabled,
  onSave,
}: {
  profile: Profile;
  labEnabled: boolean;
  onSave: (patch: Partial<Profile>) => Promise<void>;
}) {
  const [form, setForm] = useState(profile);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => setForm(profile), [profile]);

  const changed = BEHAVIOR_FIELDS.some(({ key }) => form[key] !== profile[key]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a tus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nombre del agente</Label>
          <Input
            id="agent-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">Tono</Label>
          <Input
            id="agent-tone"
            placeholder="p. ej. cercano y directo, con usted"
            value={form.tone ?? ""}
            onChange={(e) => setForm({ ...form, tone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">Instrucciones</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            placeholder="Qué debe y no debe hacer el agente…"
            value={form.instructions ?? ""}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-escalation">Reglas de escalado</Label>
          <Textarea
            id="agent-escalation"
            rows={3}
            placeholder="Cuándo pasar la conversación a un humano…"
            value={form.escalationRules ?? ""}
            onChange={(e) => setForm({ ...form, escalationRules: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-greeting">Saludo</Label>
          <Input
            id="agent-greeting"
            placeholder="Saludo para conversaciones nuevas"
            value={form.greeting ?? ""}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
        </div>
        <Button onClick={() => setPreviewing(true)} disabled={!changed}>
          Revisar y publicar
        </Button>
        {!changed && (
          <p className="text-xs text-muted-foreground">
            Nada por publicar: el formulario coincide con lo vigente.
          </p>
        )}
      </CardContent>

      {previewing && (
        <PublishPreviewDialog
          original={profile}
          draft={form}
          labEnabled={labEnabled}
          onClose={() => setPreviewing(false)}
          onConfirm={async () => {
            await onSave(form);
            setPreviewing(false);
          }}
        />
      )}
    </Card>
  );
}

/**
 * Fase 6 — vista previa OBLIGATORIA antes de publicar: antes, "Guardar" era
 * directo a producción, sin ver el cambio ni poder probarlo. Aquí se ve
 * exactamente qué campo cambia, con opción de probarlo en el Laboratorio
 * ANTES de que le llegue a un cliente real.
 */
function PublishPreviewDialog({
  original,
  draft,
  labEnabled,
  onClose,
  onConfirm,
}: {
  original: Profile;
  draft: Profile;
  labEnabled: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [publishing, setPublishing] = useState(false);
  const [testState, setTestState] = useState<
    | { status: "idle" }
    | { status: "starting" }
    | { status: "running"; runId: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const diffs = BEHAVIOR_FIELDS.filter(({ key }) => original[key] !== draft[key]);

  async function testInLab() {
    setTestState({ status: "starting" });
    const overridePatch: Record<string, string | null> = {};
    for (const { key } of diffs) overridePatch[key] = draft[key];
    const res = await fetch("/api/lab/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileOverride: overridePatch }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setTestState({
        status: "error",
        message: data?.error?.message ?? "No se pudo iniciar la prueba",
      });
      return;
    }
    const data = (await res.json()) as { runId: string };
    setTestState({ status: "running", runId: data.runId });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Revisar cambios antes de publicar"
    >
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-xl">
        <h3 className="mb-1 font-semibold">Revisar antes de publicar</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Esto es lo que va a cambiar. Se aplica al agente en cuanto confirmes
          — ningún cliente ve esto hasta que pulses &quot;Publicar&quot;.
        </p>

        {diffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cambios.</p>
        ) : (
          <ul className="space-y-3">
            {diffs.map(({ key, label }) => (
              <li key={key} className="rounded-md border p-3 text-sm">
                <p className="mb-1 font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">Antes: </span>
                  {original[key]?.trim() || "(vacío)"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium text-primary">Después: </span>
                  {draft[key]?.trim() || "(vacío)"}
                </p>
              </li>
            ))}
          </ul>
        )}

        {labEnabled && (
          <div className="mt-4 rounded-md border border-brand-soft bg-brand-tint p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <FlaskConical className="h-4 w-4" /> Probar antes de publicar
            </p>
            {testState.status === "idle" && (
              <Button size="sm" variant="secondary" onClick={() => void testInLab()}>
                Correr el Laboratorio con este cambio
              </Button>
            )}
            {testState.status === "starting" && (
              <p className="text-xs text-muted-foreground">Iniciando…</p>
            )}
            {testState.status === "running" && (
              <p className="text-xs text-muted-foreground">
                Corriendo — revisa el resultado en{" "}
                <Link href="/lab" className="text-brand-text underline">
                  el Laboratorio
                </Link>{" "}
                (marcado como &quot;vista previa&quot;, no cuenta contra el
                historial de producción). Puedes publicar antes de que
                termine si ya confías en el cambio.
              </p>
            )}
            {testState.status === "error" && (
              <p className="text-xs text-destructive">{testState.message}</p>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={publishing}>
            Cancelar
          </Button>
          <Button
            disabled={publishing || diffs.length === 0}
            onClick={async () => {
              setPublishing(true);
              await onConfirm();
              setPublishing(false);
            }}
          >
            {publishing ? "Publicando…" : "Publicar cambios"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Fase 6 — historial de comportamiento (pila de deshacer): antes no había
 * forma de ver qué cambió ni de volver atrás si una instrucción resultaba
 * defectuosa. Revertir es en sí una publicación más: queda registrada.
 */
function HistorySection({ onRestored }: { onRestored: () => void }) {
  const [versions, setVersions] = useState<ProfileVersion[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/agent/profile/versions").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { versions: ProfileVersion[] };
    setVersions(data.versions);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function restore(id: string) {
    setRestoring(id);
    setConfirmRestore(null);
    const res = await fetch(`/api/agent/profile/versions/${id}/restore`, {
      method: "POST",
    }).catch(() => null);
    setRestoring(null);
    if (res?.ok) {
      onRestored();
      void refetch();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <History className="h-4 w-4" /> Historial de comportamiento
        </CardTitle>
        <CardDescription>
          Cada vez que publicas un cambio, lo que estaba antes queda aquí.
          Revertir no borra nada: el estado actual también se guarda.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {versions === null && (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )}
        {versions?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Todavía no has publicado ningún cambio.
          </p>
        )}
        {versions && versions.length > 0 && (
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Vigente hasta el{" "}
                    {new Date(v.createdAt).toLocaleString("es-MX", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {v.changedByName ? ` · cambiado por ${v.changedByName}` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpanded((e) => (e === v.id ? null : v.id))
                      }
                    >
                      {expanded === v.id ? "Ocultar" : "Ver detalle"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={restoring === v.id}
                      onClick={() => setConfirmRestore(v.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Revertir
                    </Button>
                  </div>
                </div>

                {expanded === v.id && (
                  <dl className="mt-2 space-y-1 border-t pt-2 text-xs">
                    {BEHAVIOR_FIELDS.map(({ key, label }) => (
                      <div key={key}>
                        <dt className="font-medium text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="whitespace-pre-wrap">
                          {v[key]?.trim() || "(vacío)"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {confirmRestore === v.id && (
                  <div className="mt-2 flex items-center gap-2 rounded-sm bg-subtle p-2">
                    <span className="text-xs">
                      ¿Publicar este estado como el comportamiento vigente?
                    </span>
                    <Button
                      size="sm"
                      disabled={restoring === v.id}
                      onClick={() => void restore(v.id)}
                    >
                      Sí, revertir
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRestore(null)}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [block, setBlock] = useState("");

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "qa", question, answer }),
    }).catch(() => null);
    setQuestion("");
    setAnswer("");
    onChanged();
  }

  async function addBlock() {
    if (!block.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "block", content: block }),
    }).catch(() => null);
    setBlock("");
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/kb/${id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí, no lo
              afirma.
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {kbSize.chars.toLocaleString("es-MX")} caracteres
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-warning-text">
            El conocimiento se acerca al límite del contexto del modelo (v1 lo
            inyecta completo en cada turno). Considera depurar entradas.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva pregunta / respuesta</p>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void addQa()}
            disabled={!question.trim() || !answer.trim()}
          >
            <Plus className="h-4 w-4" /> Agregar P/R
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo bloque de texto libre</p>
          <Textarea
            placeholder="Horarios, direcciones, políticas…"
            rows={3}
            value={block}
            onChange={(e) => setBlock(e.target.value)}
          />
          <Button size="sm" onClick={() => void addBlock()} disabled={!block.trim()}>
            <Plus className="h-4 w-4" /> Agregar bloque
          </Button>
        </div>

        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1 text-sm">
                {e.kind === "qa" ? (
                  <>
                    <p className="font-medium">{e.question}</p>
                    <p className="mt-0.5 text-muted-foreground">{e.answer}</p>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar entrada"
                onClick={() => void remove(e.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agrega lo que el agente debe saber.
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
