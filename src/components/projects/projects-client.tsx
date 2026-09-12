"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { formatMoneyCents } from "@/lib/money";

/** 021 — Proyectos: lista y avance de hitos. Todo proyecto nace automático
 *  al aceptar una cotización (`src/server/quotes/service.ts`) — aquí solo
 *  se sigue el avance, no se crea a mano. */

type ProjectStatus = "planning" | "in_progress" | "review" | "completed" | "paused";
type MilestoneStatus = "pending" | "in_progress" | "completed";

type Milestone = {
  id: string;
  title: string;
  status: MilestoneStatus;
  position: number;
  dueDate: string | null;
};

type Project = {
  id: string;
  leadId: string;
  contactName: string;
  quoteId: string | null;
  name: string;
  status: ProjectStatus;
  budgetCents: number | null;
  currency: string | null;
  targetDate: string | null;
  milestones: Milestone[];
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planeación",
  in_progress: "En curso",
  review: "Revisión",
  completed: "Completado",
  paused: "Pausado",
};

const STATUS_VARIANT: Record<
  ProjectStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  planning: "secondary",
  in_progress: "default",
  review: "warning",
  completed: "success",
  paused: "destructive",
};

const MILESTONE_LABEL: Record<MilestoneStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Completado",
};

const MILESTONE_ORDER: MilestoneStatus[] = ["pending", "in_progress", "completed"];

export function ProjectsClient() {
  const searchParams = useSearchParams();
  const leadId = searchParams.get("leadId");

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function refresh() {
    const url = leadId ? `/api/projects?leadId=${leadId}` : "/api/projects";
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) {
      setProjects([]);
      return;
    }
    const data = (await res.json()) as { projects: Project[] };
    setProjects(data.projects);
  }

  async function cambiarEstado(id: string, status: ProjectStatus) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError("No se pudo actualizar el proyecto");
      return;
    }
    await refresh();
  }

  async function avanzarHito(projectId: string, milestoneId: string, next: MilestoneStatus) {
    setBusy(milestoneId);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/milestones/${milestoneId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError("No se pudo actualizar el hito");
      return;
    }
    await refresh();
  }

  if (!projects) return <p className="text-sm text-text-3">Cargando…</p>;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          {leadId ? "Proyecto de este trato" : "Todos los proyectos"}{" "}
          <span className="text-text-3">({projects.length})</span>
        </h3>
        {projects.length === 0 && (
          <p className="text-sm text-text-3">
            {leadId
              ? "Este trato todavía no tiene proyecto — nace automático al aceptar una cotización."
              : "Todavía no hay proyectos."}
          </p>
        )}
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-text-3">{p.contactName}</p>
                </div>
                <div className="flex items-center gap-2">
                  {p.budgetCents !== null && (
                    <span className="text-sm tabular-nums text-text-3">
                      {formatMoneyCents(p.budgetCents, p.currency ?? "MXN")}
                    </span>
                  )}
                  <Badge variant={STATUS_VARIANT[p.status]}>
                    {STATUS_LABEL[p.status]}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                  <button
                    key={s}
                    disabled={busy === p.id || s === p.status}
                    onClick={() => void cambiarEstado(p.id, s)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      s === p.status
                        ? "border-brand bg-brand-tint font-semibold text-brand-text"
                        : "border-border text-text-2 hover:bg-accent"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>

              <ul className="space-y-1.5">
                {p.milestones.map((m) => {
                  const nextIdx = Math.min(
                    MILESTONE_ORDER.indexOf(m.status) + 1,
                    MILESTONE_ORDER.length - 1
                  );
                  const next = MILESTONE_ORDER[nextIdx]!;
                  return (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5"
                    >
                      <span className="text-sm">{m.title}</span>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            m.status === "completed"
                              ? "success"
                              : m.status === "in_progress"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {MILESTONE_LABEL[m.status]}
                        </Badge>
                        {m.status !== "completed" && (
                          <button
                            disabled={busy === m.id}
                            onClick={() => void avanzarHito(p.id, m.id, next)}
                            className="text-xs text-brand hover:underline"
                          >
                            Marcar {MILESTONE_LABEL[next].toLowerCase()}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
