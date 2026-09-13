"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Calendario desplegable para el preset "Personalizado" de Resultados. Sin
 * dependencia nueva (no hay date-fns/react-day-picker en el proyecto): la
 * cuadrícula se arma con aritmética de calendario pura (año/mes/día), nunca
 * con instantes — no hay nada que un DST del navegador pueda desalinear aquí.
 */

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];
const MONTH_LABEL = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });

type Props = {
  open: boolean;
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  onClose: () => void;
};

function isoOf(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseIso(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/** Días a mostrar en la cuadrícula del mes (incluye relleno de meses vecinos), lunes primero. */
function buildMonthGrid(year: number, month: number): { iso: string; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = lunes
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: { iso: string; inMonth: boolean }[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const d = new Date(year, month - 1, day);
    cells.push({ iso: isoOf(d.getFullYear(), d.getMonth(), day), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: isoOf(year, month, day), inMonth: true });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = parseIso(cells[cells.length - 1]!.iso)!;
    const d = new Date(last.year, last.month, last.day + 1);
    cells.push({ iso: isoOf(d.getFullYear(), d.getMonth(), d.getDate()), inMonth: false });
    if (cells.length >= 42) break;
  }
  return cells;
}

export function CustomRangePicker({ open, from, to, onApply, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const anchor = parseIso(from) ?? { year: new Date().getFullYear(), month: new Date().getMonth(), day: 1 };
  const [viewYear, setViewYear] = useState(anchor.year);
  const [viewMonth, setViewMonth] = useState(anchor.month);

  useEffect(() => {
    if (!open) return;
    setDraftFrom(from);
    setDraftTo(to);
    const a = parseIso(from);
    if (a) {
      setViewYear(a.year);
      setViewMonth(a.month);
    }
  }, [open, from, to]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const rawMonthLabel = MONTH_LABEL.format(new Date(viewYear, viewMonth, 1));
  // Solo la primera letra: `capitalize` de Tailwind mayusculiza CADA palabra
  // ("Septiembre De 2026"), y aquí solo el mes debe llevar mayúscula inicial.
  const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

  if (!open) return null;

  function pickDay(iso: string) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(iso);
      setDraftTo("");
      return;
    }
    if (iso < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(iso);
    } else {
      setDraftTo(iso);
    }
  }

  function changeMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  const canApply = draftFrom.length > 0 && draftTo.length > 0;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-20 mt-2 w-[300px] rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <Button type="button" size="icon" variant="ghost" onClick={() => changeMonth(-1)} aria-label="Mes anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold">{monthLabel}</span>
        <Button type="button" size="icon" variant="ghost" onClick={() => changeMonth(1)} aria-label="Mes siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-text-3">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="py-1 font-semibold">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell) => {
          const isFrom = cell.iso === draftFrom;
          const isTo = cell.iso === draftTo;
          const inRange =
            draftFrom && draftTo && cell.iso > draftFrom && cell.iso < draftTo;
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => pickDay(cell.iso)}
              className={cn(
                "aspect-square rounded-md text-xs transition-colors",
                !cell.inMonth && "text-text-4",
                cell.inMonth && !isFrom && !isTo && !inRange && "hover:bg-accent",
                (isFrom || isTo) && "bg-brand font-semibold text-brand-fg",
                inRange && "bg-brand-tint"
              )}
            >
              {Number(cell.iso.slice(-2))}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="custom-range-from" className="text-[11px]">
            Desde
          </Label>
          <Input
            id="custom-range-from"
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="custom-range-to" className="text-[11px]">
            Hasta
          </Label>
          <Input
            id="custom-range-to"
            type="date"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canApply}
          onClick={() => {
            onApply(draftFrom, draftTo);
            onClose();
          }}
        >
          Aplicar
        </Button>
      </div>
    </div>
  );
}
