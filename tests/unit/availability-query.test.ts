import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  dayIsoInTz,
  eachDateInRange,
  todayInTz,
  weekdayKeyOf,
  zonedWallClockToUtc,
  type SlotUtc,
} from "@/lib/time/slots";
import { buildCandidateSlots, filterFreeSlots } from "@/server/agenda/availability";
import {
  MAX_REGISTERED,
  answerQuery,
  claimsNoAvailability,
  type AvailabilityAnswer,
  type AvailabilityQuery,
  type DayData,
} from "@/server/agenda/availability-query";
import { DEFAULT_CALENDAR_SETTINGS, type CalendarSettings } from "@/server/agenda/settings";

/**
 * Spec 025 — el núcleo PURO de la consulta de disponibilidad. Los días se
 * construyen con las MISMAS funciones puras del motor (`buildCandidateSlots` +
 * `filterFreeSlots`): horario semanal, zona horaria, duración, buffers, aviso
 * mínimo y citas existentes. Sin BD ni mocks.
 *
 * «Ahora» = jueves 17 sep 2026, 12:00 en Ciudad de México (18:00Z).
 */

const NOW = new Date("2026-09-17T18:00:00Z");

function settingsWith(over: Partial<CalendarSettings> = {}): CalendarSettings {
  return { ...DEFAULT_CALENDAR_SETTINGS, ...over };
}

/** Los mismos pasos que `computeAvailability`, sin la lectura de citas de la BD. */
function buildDays(settings: CalendarSettings, now: Date, busy: SlotUtc[] = []) {
  const tz = settings.timezone;
  const todayIso = todayInTz(now, tz);
  const horizonEndIso = addDaysISO(todayIso, settings.maxDaysAhead);
  const candidates = buildCandidateSlots(settings, todayIso, horizonEndIso);
  const free = filterFreeSlots(candidates, busy, {
    now,
    minNoticeHours: settings.minNoticeHours,
    timezone: tz,
  });
  // Un solo `dayIsoInTz` por horario (construir un Intl por horario y día es O(n²) y lento).
  const byDay = new Map<string, typeof free>();
  for (const s of free) {
    const d = dayIsoInTz(new Date(s.startUtc), tz);
    const bucket = byDay.get(d);
    if (bucket) bucket.push(s);
    else byDay.set(d, [s]);
  }
  const days: DayData[] = eachDateInRange(todayIso, horizonEndIso).map((dayIso) => {
    const key = weekdayKeyOf(dayIso, tz);
    return {
      dayIso,
      free: byDay.get(dayIso) ?? [],
      candidates: buildCandidateSlots(settings, dayIso, dayIso),
      intervals: (key ? settings.weeklyHours[key] : undefined) ?? [],
    };
  });
  return { days, todayIso, horizonEndIso, free };
}

function ask(
  query: AvailabilityQuery,
  opts: { settings?: CalendarSettings; now?: Date; busy?: SlotUtc[] } = {}
): AvailabilityAnswer {
  const settings = opts.settings ?? settingsWith();
  const now = opts.now ?? NOW;
  const { days, todayIso, horizonEndIso } = buildDays(settings, now, opts.busy);
  return answerQuery({ query, settings, now, todayIso, horizonEndIso, days });
}

/** Un bloqueo de pared en la zona del negocio. */
function block(dayIso: string, from: string, to: string, tz = "America/Mexico_City"): SlotUtc {
  return {
    startUtc: zonedWallClockToUtc(dayIso, from, tz)!.toISOString(),
    endUtc: zonedWallClockToUtc(dayIso, to, tz)!.toISOString(),
  };
}

const MON = "2026-09-21";

describe("las cuatro consultas del requisito, agenda VACÍA de 09:00 a 18:00", () => {
  it("«¿Tienes más horarios mañana?» → TODO el día, exhaustiva, sin inventar ocupación", () => {
    const a = ask({ day: "mañana" });
    expect(a.text).toBe(
      "Mañana viernes, 18 de septiembre puedo iniciar de 09:00 a 17:30 (cada 30 min). Cada sesión dura 30 min."
    );
    expect(a.meta).toEqual({
      kind: "day",
      scopeComplete: true,
      exhaustive: true,
      hasMore: false,
      total: 18,
      conveyed: 18,
    });
    expect(claimsNoAvailability(a.text)).toBe(false);
    // Todos los del día quedan registrados y mostrados (el prospecto puede elegir cualquiera).
    expect(a.offers).toHaveLength(18);
    expect(a.offers.every((o) => o.shown)).toBe(true);
    expect(a.offers[0]!.startUtc).toBe("2026-09-18T15:00:00.000Z"); // 09:00 MX
    expect(a.offers.at(-1)!.startUtc).toBe("2026-09-18T23:30:00.000Z"); // 17:30 MX
    expect(a.ok).toBe(true);
    expect(a.status).toBe("availability");
  });

  it("«¿Lunes a las 11 o 12?» → ambas libres", () => {
    const a = ask({ day: "lunes", times: ["11", "12"] });
    expect(a.text).toBe("Lunes, 21 de septiembre sí tengo libre a las 11:00 y 12:00.");
    expect(a.checks).toEqual([
      { dayIso: MON, hhmm: "11:00", free: true, reason: undefined },
      { dayIso: MON, hhmm: "12:00", free: true, reason: undefined },
    ]);
    expect(a.meta).toMatchObject({ kind: "times", exhaustive: true, hasMore: false, total: 2, conveyed: 2 });
    // El día completo queda registrado para poder elegir otra hora.
    expect(a.offers).toHaveLength(18);
    expect(a.offers.filter((o) => o.shown).map((o) => o.startUtc)).toEqual([
      "2026-09-21T17:00:00.000Z",
      "2026-09-21T18:00:00.000Z",
    ]);
  });

  it("«¿El lunes a las 4 o 5 de la tarde?» → 16:00 y 17:00 libres (17:00 termina 17:30 ≤ 18:00)", () => {
    for (const times of [["4 de la tarde", "5 de la tarde"], ["4", "5"], ["16:00", "17:00"], ["4 pm", "5 pm"]]) {
      const a = ask({ day: "lunes", times });
      expect(a.text, JSON.stringify(times)).toBe("Lunes, 21 de septiembre sí tengo libre a las 16:00 y 17:00.");
      expect(a.meta.total).toBe(2);
    }
  });

  it("«¿Cuál es el horario más tarde?» → 17:30 (agenda vacía) y el más temprano 09:00", () => {
    const late = ask({ day: "lunes", edge: "latest" });
    expect(late.text).toBe("Lunes, 21 de septiembre, el horario más tarde para iniciar es a las 17:30.");
    expect(late.meta).toMatchObject({ kind: "edge", exhaustive: true, total: 1 });
    const early = ask({ day: "lunes", edge: "earliest" });
    expect(early.text).toContain("más temprano para iniciar es a las 09:00");
  });

  it("sin día, «el más tarde» describe los primeros 3 días con agenda y DECLARA que hay más", () => {
    const a = ask({ edge: "latest" });
    // Hoy (jueves) desde las 14:00 por el aviso mínimo; luego viernes y lunes.
    expect(a.text.split("\n")).toHaveLength(4); // 3 días + la invitación a elegir
    expect(a.text).toContain("Hoy jueves, 17 de septiembre, el horario más tarde para iniciar es a las 17:30.");
    expect(a.meta).toMatchObject({ kind: "edge", hasMore: true, exhaustive: false, total: 6, conveyed: 3 });
    expect(a.text).toContain("Tengo más días con horarios disponibles");
  });
});

describe("con citas y bloqueos reales, sólo lo ocupado deja de ofrecerse", () => {
  it("una comida 13:00-14:00 el lunes: se dice ocupado, no «no hay»; el resto del día sigue libre", () => {
    const busy = [block(MON, "13:00", "14:00")];
    const a = ask({ day: "lunes", times: ["1", "2"] }, { busy });
    expect(a.checks.map((c) => [c.hhmm, c.free, c.reason])).toEqual([
      ["13:00", false, "occupied"],
      ["14:00", true, undefined],
    ]);
    expect(a.text).toContain("a las 13:00 ya está ocupado");
    expect(a.text).toContain("a las 14:00 sí tengo");
    // …y completa con TODO lo que sí hay ese día (rangos exactos).
    expect(a.text).toContain("Ese día también puedo iniciar de 09:00 a 12:30 y de 14:00 a 17:30");
  });

  it("una cita a las 17:30 baja el más tarde a 17:00; una a las 17:00 lo deja en 17:30", () => {
    expect(ask({ day: "lunes", edge: "latest" }, { busy: [block(MON, "17:30", "18:00")] }).text).toContain("a las 17:00");
    expect(ask({ day: "lunes", edge: "latest" }, { busy: [block(MON, "17:00", "17:30")] }).text).toContain("a las 17:30");
  });

  it("una cita de 60 min bloquea los DOS slots de 30 min que toca", () => {
    const a = ask({ day: "lunes", times: ["11", "11:30", "12"] }, { busy: [block(MON, "11:00", "12:00")] });
    expect(a.checks.map((c) => [c.hhmm, c.free])).toEqual([
      ["11:00", false],
      ["11:30", false],
      ["12:00", true],
    ]);
  });

  it("día completamente ocupado: SÍ es una negación honesta (día evaluado completo) y sugiere lo más cercano", () => {
    const a = ask({ day: "lunes" }, { busy: [block(MON, "09:00", "18:00")] });
    expect(a.text).toContain("Lunes, 21 de septiembre ya no me quedan horarios libres.");
    expect(claimsNoAvailability(a.text)).toBe(true);
    expect(a.meta).toMatchObject({ scopeComplete: true, total: 0, exhaustive: true, hasMore: false });
    expect(a.text).toContain("Lo más cercano que tengo:");
    expect(a.offers.length).toBeGreaterThan(0); // las cercanas quedan ofrecibles
    expect(a.offers.every((o) => o.shown)).toBe(true);
    expect(a.ok).toBe(false);
  });

  it("una hora que hoy ya no alcanza: aviso mínimo (no «ocupado»)", () => {
    const a = ask({ day: "hoy", times: ["13"] });
    expect(a.checks[0]).toMatchObject({ hhmm: "13:00", free: false, reason: "too_soon" });
    expect(a.text).toContain("no alcanzo a agendarlo (aviso mínimo de 2 h)");
    const past = ask({ day: "hoy", times: ["10"] });
    expect(past.checks[0]).toMatchObject({ free: false, reason: "past" });
    expect(past.text).toContain("ya pasó");
  });
});

describe("casos límite: cada negación tiene una causa REAL", () => {
  it("día que no atiende", () => {
    const a = ask({ day: "domingo", times: ["11"] });
    expect(a.checks[0]).toMatchObject({ reason: "closed_day" });
    expect(a.text).toContain("ese día no atiendo");
    expect(ask({ day: "domingo" }).text).toContain("Domingo, 20 de septiembre no atiendo.");
  });

  it("hora fuera de horario", () => {
    const a = ask({ day: "lunes", times: ["8 pm", "7:30"] });
    expect(a.checks.map((c) => c.reason)).toEqual(["out_of_hours", "out_of_hours"]);
    expect(a.text).toContain("queda fuera de mi horario (09:00 a 18:00)");
  });

  it("hora fuera de la rejilla: explica los inicios reales en vez de decir «ocupado»", () => {
    const a = ask({ day: "lunes", times: ["11:15"] });
    expect(a.checks[0]).toMatchObject({ free: false, reason: "off_grid" });
    expect(a.text).toContain("no coincide con mis horarios de inicio (cada 30 min: 11:00 o 11:30)");
  });

  it("fecha pasada y fuera de horizonte: no afirman disponibilidad ni la niegan", () => {
    const past = ask({ day: "2026-09-10" });
    expect(past.text).toContain("ya pasó");
    expect(past.meta).toMatchObject({ kind: "none", scopeComplete: false, total: 0, exhaustive: false });
    expect(past.offers).toEqual([]);
    const far = ask({ day: "2026-10-30" });
    expect(far.text).toContain("Por ahora agendo hasta el jueves, 24 de septiembre");
    expect(far.meta.kind).toBe("none");
    expect(claimsNoAvailability(far.text)).toBe(false); // «agendo hasta…» no es «no hay»
  });

  it("no entiende el día o la hora: PREGUNTA, no ofrece ni afirma nada", () => {
    const d = ask({ day: "la semana que viene" });
    expect(d.status).toBe("availability_clarify");
    expect(d.offers).toEqual([]);
    expect(d.meta).toMatchObject({ kind: "clarify", total: 0, hasMore: false });
    const t = ask({ day: "lunes", times: ["por la tarde"] });
    expect(t.status).toBe("availability_clarify");
    const r = ask({ day: "lunes", from: "pronto" });
    expect(r.status).toBe("availability_clarify");
  });

  it("sin día: la pregunta de una hora se responde sobre el horizonte y declara los días omitidos", () => {
    const a = ask({ times: ["11"] });
    // Hoy 11:00 ya pasó; libres: vie 18, lun 21, mar 22, mié 23, jue 24 → se describen 3.
    expect(a.meta).toMatchObject({ kind: "times", total: 5, hasMore: true, exhaustive: false });
    expect(a.text).toContain("Tengo más días con horarios disponibles");
  });

  it("sin día y sin nada que cumpla en TODO el horizonte: negación honesta con el alcance dicho", () => {
    const a = ask({ times: ["11"] }, { settings: settingsWith({ weeklyHours: { mon: [{ start: "14:00", end: "18:00" }] } }) });
    expect(a.text).toContain("No tengo libre a esa hora en los próximos 7 días.");
    expect(a.meta).toMatchObject({ scopeComplete: true, total: 0, exhaustive: true });
  });
});

describe("rangos", () => {
  it("«entre las 2 y las 5 de la tarde» → inicio ≥ 14:00 y FIN ≤ 17:00", () => {
    const a = ask({ day: "lunes", from: "2 pm", to: "5 pm" });
    expect(a.text).toContain("entre esas horas puedo iniciar de 14:00 a 16:30 (cada 30 min)");
    expect(a.meta).toMatchObject({ kind: "range", total: 6, exhaustive: true });
  });

  it("sólo «después de las 3»", () => {
    const a = ask({ day: "lunes", from: "3 pm" });
    expect(a.text).toContain("de 15:00 a 17:30");
    expect(a.meta.total).toBe(6);
  });

  it("sólo «antes de las 11»", () => {
    const a = ask({ day: "lunes", to: "11" });
    expect(a.text).toContain("de 09:00 a 10:30");
  });

  it("rango sin coincidencias: lo dice y muestra lo que SÍ hay ese día (día evaluado completo)", () => {
    const a = ask({ day: "lunes", from: "7 pm", to: "9 pm" });
    expect(a.text).toContain("no tengo horarios dentro de ese rango");
    expect(a.text).toContain("Ese día sí puedo iniciar de 09:00 a 17:30");
    expect(a.meta).toMatchObject({ total: 0, scopeComplete: true });
    expect(a.offers).toHaveLength(18);
  });

  it("rango + extremo: «lo más tarde antes de las 4»", () => {
    const a = ask({ day: "lunes", to: "4 pm", edge: "latest" });
    expect(a.text).toContain("a las 15:30"); // el último inicio cuyo fin (16:00) ≤ 16:00
  });
});

describe("zona horaria, horario partido, duración y buffers", () => {
  it("zona distinta a la del servidor: 09:00 de Tokio es 00:00Z y «mañana» es el mañana de TOKIO", () => {
    const tokyo = settingsWith({
      timezone: "Asia/Tokyo",
      weeklyHours: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "09:00", end: "18:00" }]])
      ),
    });
    // 18:00Z del 17 = 03:00 del 18 en Tokio → hoy=18, mañana=19.
    const a = ask({ day: "mañana", times: ["9"] }, { settings: tokyo });
    expect(a.checks[0]).toMatchObject({ dayIso: "2026-09-19", hhmm: "09:00", free: true });
    expect(a.offers[0]!.startUtc).toBe("2026-09-19T00:00:00.000Z");
    expect(a.text).toContain("sábado, 19 de septiembre");
  });

  it("zona con horario de verano (Los Ángeles, UTC-7 en septiembre)", () => {
    const la = settingsWith({ timezone: "America/Los_Angeles" });
    const a = ask({ day: "lunes", times: ["9"] }, { settings: la });
    expect(a.offers.find((o) => o.shown)!.startUtc).toBe("2026-09-21T16:00:00.000Z");
  });

  it("horario partido 09-13 y 15-19: rangos por tramo y el hueco del mediodía es «fuera de horario»", () => {
    const split = settingsWith({
      weeklyHours: { mon: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }] },
    });
    const day = ask({ day: "lunes" }, { settings: split });
    expect(day.text).toContain("de 09:00 a 12:30 y de 15:00 a 18:30 (cada 30 min)");
    const gap = ask({ day: "lunes", times: ["2 de la tarde"] }, { settings: split });
    expect(gap.checks[0]).toMatchObject({ reason: "out_of_hours" });
    expect(gap.text).toContain("queda fuera de mi horario (09:00 a 13:00 y 15:00 a 19:00)");
  });

  it("duración 45 min + buffer 15: inicios cada 60 min y el último que CABE (17:00 termina 17:45)", () => {
    const s = settingsWith({ slotMinutes: 45, bufferMinutes: 15 });
    const a = ask({ day: "lunes" }, { settings: s });
    expect(a.text).toContain("de 09:00 a 17:00 (cada 60 min)");
    expect(a.text).toContain("Cada sesión dura 45 min.");
    const off = ask({ day: "lunes", times: ["9:30"] }, { settings: s });
    expect(off.checks[0]).toMatchObject({ reason: "off_grid" });
    expect(off.text).toContain("cada 60 min");
    expect(ask({ day: "lunes", edge: "latest" }, { settings: s }).text).toContain("a las 17:00");
  });

  it("aviso mínimo de 24 h: mañana temprano ya no se ofrece", () => {
    const s = settingsWith({ minNoticeHours: 24 });
    const a = ask({ day: "mañana", times: ["9", "13"] }, { settings: s });
    // Ahora = jue 12:00; +24 h = vie 12:00 → 09:00 no; 13:00 sí.
    expect(a.checks.map((c) => [c.hhmm, c.free, c.reason])).toEqual([
      ["09:00", false, "too_soon"],
      ["13:00", true, undefined],
    ]);
  });

  it("un día con MÁS de 60 inicios: se registra el tope y se DECLARA (hasMore), sin fingir que es todo", () => {
    const dense = settingsWith({
      slotMinutes: 10,
      weeklyHours: { mon: [{ start: "08:00", end: "20:00" }] }, // 72 inicios
    });
    const a = ask({ day: "lunes" }, { settings: dense });
    expect(a.meta).toMatchObject({ total: 72, conveyed: MAX_REGISTERED, hasMore: true, exhaustive: false });
    expect(a.offers).toHaveLength(MAX_REGISTERED);
    expect(a.text).toContain("Tengo más horarios ese día");
  });
});

describe("claimsNoAvailability (guard de una negación escrita por el modelo)", () => {
  it.each([
    "Lo siento, no tengo más horarios disponibles.",
    "Por ahora no me quedan horarios libres.",
    "No hay horarios para mañana.",
    "La agenda está llena esta semana.",
    "No hay disponibilidad ese día.",
    "Ya no tenemos disponibilidad de horarios.",
  ])("detecta «%s»", (t) => {
    expect(claimsNoAvailability(t)).toBe(true);
  });

  it.each([
    "Claro, aquí tienes algunos horarios disponibles:",
    "Mañana tengo libre a las 11:00.",
    "No tengo disponibilidad de stock de ese producto.",
    "No hay problema, con gusto te ayudo.",
    "¿Qué horarios te acomodan?",
    "Por ahora agendo hasta el jueves 24.",
  ])("no confunde «%s»", (t) => {
    expect(claimsNoAvailability(t)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Propiedades: nunca se inventa ocupación ni disponibilidad.            */
/* ------------------------------------------------------------------ */

/** PRNG determinista (mulberry32): la prueba es reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("propiedades sobre 150 agendas y consultas aleatorias", () => {
  const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

  it("lo que dice coincide con lo que hay: nada inventado, ninguna negación falsa", () => {
    const r = rng(2026);
    const zones = ["America/Mexico_City", "America/Bogota", "Asia/Tokyo", "America/Los_Angeles", "Europe/Madrid"];
    const dayExprs = [undefined, "hoy", "mañana", "lunes", "martes", "viernes", "domingo", "2026-09-22", "25 de septiembre", "2026-11-01", "no sé"];
    const timeTokens = ["9", "11", "12", "1", "4", "5", "16:30", "4 de la tarde", "8 pm", "10:15", "7"];
    let negations = 0;
    let questions = 0;

    for (let i = 0; i < 150; i++) {
      const tz = pick(r, zones);
      const weekly: CalendarSettings["weeklyHours"] = {};
      for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const) {
        const roll = r();
        if (roll < 0.25) continue; // día cerrado
        weekly[d] =
          roll < 0.5
            ? [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }]
            : [{ start: pick(r, ["08:00", "09:00", "10:00"]), end: pick(r, ["17:00", "18:00", "20:00"]) }];
      }
      const settings = settingsWith({
        timezone: tz,
        weeklyHours: weekly,
        slotMinutes: pick(r, [15, 30, 45, 60]),
        bufferMinutes: pick(r, [0, 0, 5, 15]),
        minNoticeHours: pick(r, [0, 1, 2, 24]),
        maxDaysAhead: pick(r, [3, 5, 7]),
      });
      const now = new Date(Date.UTC(2026, 8, 17, Math.floor(r() * 24), pick(r, [0, 30])));
      const todayIso = todayInTz(now, tz);
      const span = eachDateInRange(todayIso, addDaysISO(todayIso, settings.maxDaysAhead));
      const busy: SlotUtc[] = [];
      for (let b = 0; b < Math.floor(r() * 7); b++) {
        const d = span[Math.floor(r() * span.length)]!;
        const h = 8 + Math.floor(r() * 11);
        busy.push(block(d, `${String(h).padStart(2, "0")}:00`, `${String(h + 1 + Math.floor(r() * 2)).padStart(2, "0")}:00`, tz));
      }
      const truth = buildDays(settings, now, busy);
      const freeSet = new Set(truth.free.map((s) => s.startUtc));

      const q: AvailabilityQuery = {};
      const dExpr = pick(r, dayExprs);
      if (dExpr) q.day = dExpr;
      const shape = r();
      if (shape < 0.4) q.times = [pick(r, timeTokens), pick(r, timeTokens)];
      else if (shape < 0.55) q.edge = pick(r, ["earliest", "latest"] as const);
      else if (shape < 0.7) {
        q.from = pick(r, timeTokens);
        if (r() < 0.6) q.to = pick(r, ["6 pm", "5 pm", "12", "3 pm"]);
      }
      const a = answerQuery({
        query: q,
        settings,
        now,
        todayIso,
        horizonEndIso: addDaysISO(todayIso, settings.maxDaysAhead),
        days: truth.days,
      });
      const ctxLabel = `caso ${i} ${JSON.stringify(q)} tz=${tz}`;
      questions++;

      // (P1) NUNCA se ofrece un horario que el motor no tiene libre.
      for (const o of a.offers) expect(freeSet.has(o.startUtc), `${ctxLabel}: ofrece ${o.startUtc} que no está libre`).toBe(true);
      // (P2) …ni se dice ocupado/libre lo contrario de la verdad.
      for (const c of a.checks) {
        const iso = zonedWallClockToUtc(c.dayIso, c.hhmm, tz)!.toISOString();
        expect(c.free, `${ctxLabel}: ${c.dayIso} ${c.hhmm}`).toBe(freeSet.has(iso));
        expect(Boolean(c.reason)).toBe(!c.free);
      }
      // (P3) shown ⊆ offers, tope y consistencia de la metadata.
      expect(a.offers.length).toBeLessThanOrEqual(MAX_REGISTERED);
      expect(a.meta.exhaustive, ctxLabel).toBe(a.meta.scopeComplete && !a.meta.hasMore);
      expect(a.meta.conveyed).toBeLessThanOrEqual(Math.max(a.meta.total, a.offers.length));
      if (a.meta.hasMore) expect(a.meta.exhaustive).toBe(false);
      // (P4) una negación de agenda SÓLO con el alcance completo y cero coincidencias.
      if (claimsNoAvailability(a.text)) {
        negations++;
        expect(a.meta.scopeComplete, `${ctxLabel}: negación sin alcance completo → ${a.text}`).toBe(true);
        expect(a.meta.total, `${ctxLabel}: negación con coincidencias → ${a.text}`).toBe(0);
      }
      // (P5) `total` es la cuenta REAL de lo que cumple (todos los matches están libres).
      for (const m of a.matches) expect(freeSet.has(m.startUtc), ctxLabel).toBe(true);
      expect(a.matches.length).toBe(a.meta.total);
      // (P6) una respuesta de aclaración/fuera de horizonte jamás registra ni afirma.
      if (a.meta.kind === "clarify" || a.meta.kind === "none") {
        expect(a.offers).toEqual([]);
        expect(a.meta.total).toBe(0);
      }
    }
    expect(questions).toBe(150);
    // La prueba de verdad ejercita ambas ramas (no es vacua).
    expect(negations).toBeGreaterThanOrEqual(3);
  }, 90_000);
});
