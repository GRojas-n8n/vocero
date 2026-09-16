/**
 * QA manual — simula un prospecto de WhatsApp escribiendo por primera vez y
 * verifica: ingesta del webhook, respuesta del agente, y (si AGENDA=on) el
 * intento de agendar contra el conector Google Calendar.
 *
 * Por qué NO se hace un curl "a mano" contra /api/webhook: este repo no tiene
 * esa ruta genérica. El webhook real es /api/webhooks/wa/[webhookToken] y
 * exige la firma x-hub-signature-256 si META_APP_SECRET está configurado.
 * En vez de fabricar esa firma, se usa /api/dev/wa-mock/inbound — el
 * simulador que el propio proyecto ya trae para esto (arma el payload con
 * forma de Meta y lo entrega al webhook real; 404 incondicional si
 * WA_MOCK_ENABLED no está en true o si es producción).
 *
 * IMPORTANTE — límite del ai-mock: OPENROUTER_BASE_URL en este repo apunta a
 * un LLM de mentira (src/server/dev/ai-mock.ts) determinista por *keywords*.
 * No sabe razonar "el prospecto pregunta por servicios → ofrécele horarios":
 * solo cubre handoff, intención de compra, y un eco genérico. Por eso, tras
 * ver la respuesta del agente, este script llama DIRECTO a
 * /api/bot/availability y /api/bot/bookings — el mismo motor de agenda
 * (src/server/agenda/agent.ts) que el agente real invocaría con un LLM de
 * verdad al decidir "offer_slots"/"book_slot" — para probar de punta a punta
 * que el conector de Google Calendar responde. Si quieres ver al agente
 * DECIDIR esto solo, en vez del ai-mock necesitas un OPENROUTER_API_TOKEN
 * real apuntando a OpenRouter (quita el OPENROUTER_BASE_URL del mock).
 *
 * IMPORTANTE — single-tenant de /api/bot/*: resolveInstanceOrg()
 * (src/server/bot/auth.ts) NO lee la sesión; toma "la" primera organización
 * de la tabla y la cachea en memoria mientras viva el proceso del server
 * (coherente con "una instancia = un negocio", pero una trampa en una BD de
 * pruebas con más de una org). Por eso este script NUNCA crea una cuenta con
 * email al azar: inicia sesión con LA MISMA cuenta fija que usa
 * scripts/e2e-selftest.mjs, para operar sobre la organización que el bot ya
 * resuelve. Si tu BD local tiene más de una organización, corrige QA_EMAIL/
 * QA_PASSWORD abajo para apuntar a la que sea la primera (o limpia la BD).
 *
 * Uso:
 *   1) .env local con WA_MOCK_ENABLED=true, AGENDA=on, GOOGLE_CAL_BASE_URL y
 *      GOOGLE_OAUTH_BASE_URL → http://localhost:3000/api/dev/google-mock
 *      (ver comentario agregado junto a AGENDA en .env), BD migrada.
 *   2) pnpm dev (o el server ya corriendo) en otra terminal.
 *   3) node --env-file=.env scripts/qa-simular-prospecto.mjs
 *
 * Reutiliza siempre la misma cuenta/organización; solo el teléfono del
 * prospecto y el phoneNumberId cambian en cada corrida.
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;
const RUN_ID = Date.now().toString().slice(-8);
const PN = `PN-QA-${RUN_ID}`;
// normalizeMx (src/lib/meta/client.ts) exige exactamente /^521\d{10}$/.
const PROSPECT_PHONE = `521${(`55${RUN_ID}`).padStart(10, "0")}`;

let cookie = "";
let failures = 0;

function section(title) {
  console.log(`\n== ${title} ==`);
}

function ok(name, cond, extra = "") {
  if (cond) {
    console.log(`  OK   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
  return Boolean(cond);
}

function info(msg) {
  console.log(`  ...  ${msg}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE, // Better Auth valida Origin (CSRF) en /api/auth/*
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

function bot(path, opts = {}) {
  return api(path, { ...opts, headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  section("Preflight");
  const health = await api("/api/health");
  if (!ok("la app responde /api/health", health.res.ok)) {
    console.error("¿Está corriendo `pnpm dev` (o el server) en " + BASE + "?");
    process.exit(1);
  }
  if (!BOT_KEY || BOT_KEY.length < 16) {
    console.error("BOT_API_KEY ausente/corta en el entorno: exporta la misma que usa el server.");
    process.exit(1);
  }

  section("Setup: sesión del operador (misma cuenta que scripts/e2e-selftest.mjs)");
  const email = process.env.QA_EMAIL ?? "e2e@vocero.test";
  const password = process.env.QA_PASSWORD ?? "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    // Ya existe (re-corrida, o la creó scripts/e2e-selftest.mjs): inicia sesión.
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  if (!ok("sesión de operador lista", su.res.ok, JSON.stringify(su.json))) {
    console.error("No se pudo iniciar sesión ni crear la cuenta — revisa QA_EMAIL/QA_PASSWORD.");
    process.exit(1);
  }

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: `WABA-QA-${RUN_ID}`, phoneNumberId: PN, token: "tok-qa" }),
  });
  ok("número de WhatsApp conectado (mock)", conn.res.ok, JSON.stringify(conn.json));

  // runAgentTurn (src/server/ai/pipeline.ts) responde en silencio — sin log,
  // sin error — si el perfil del agente existe pero está apagado. Sin este
  // PUT, esta cuenta de pruebas se queda muda para siempre y parece un bug.
  const agentOn = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true, name: "Agente QA" }),
  });
  ok("agente de IA encendido para esta organización", agentOn.res.ok, JSON.stringify(agentOn.json));

  section("Agenda: ¿está encendida esta instancia?");
  const settingsProbe = await api("/api/calendar/settings");
  const agendaOn = settingsProbe.res.status !== 404;
  info(`AGENDA=${agendaOn ? "on" : "off"} (GET /api/calendar/settings → ${settingsProbe.res.status})`);
  if (!agendaOn) {
    info("Sin AGENDA=on no hay nada de agenda/Google que probar. Pon AGENDA=on en .env y reinicia el server.");
  }

  let googleConnected = false;
  if (agendaOn) {
    section("Agenda: horario del negocio");
    const weeklyHours = {
      mon: [{ start: "09:00", end: "18:00" }],
      tue: [{ start: "09:00", end: "18:00" }],
      wed: [{ start: "09:00", end: "18:00" }],
      thu: [{ start: "09:00", end: "18:00" }],
      fri: [{ start: "09:00", end: "18:00" }],
    };
    const sched = await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({
        weeklyHours,
        slotMinutes: 30,
        bufferMinutes: 10,
        minNoticeHours: 1,
        timezone: "America/Mexico_City",
      }),
    });
    ok("horario semanal guardado", sched.res.ok, JSON.stringify(sched.json));

    section("Conector Google Calendar (contra google-mock)");
    const gcal = await api("/api/settings/google", {
      method: "PUT",
      body: JSON.stringify({
        clientId: "qa-client-id",
        clientSecret: "qa-client-secret",
        refreshToken: "qa-refresh-token",
        calendarId: "primary",
      }),
    });
    googleConnected = ok(
      "Google Calendar conectado (testConnection contra el mock pasó)",
      gcal.res.ok,
      JSON.stringify(gcal.json)
    );
    if (!gcal.res.ok) {
      info(
        "Si esto falló con timeout/ENOTFOUND: GOOGLE_CAL_BASE_URL/GOOGLE_OAUTH_BASE_URL no están " +
          "apuntando al mock (deben ser http://localhost:3000/api/dev/google-mock) — revisa .env y reinicia el server."
      );
    }

    if (googleConnected) {
      const useGoogle = await api("/api/calendar/settings", {
        method: "PUT",
        body: JSON.stringify({ connector: "google" }),
      });
      ok("conector activo = google", useGoogle.json?.settings?.connector === "google", JSON.stringify(useGoogle.json));
    }
  }

  section("Simular WhatsApp: prospecto escribe por primera vez preguntando por servicios");
  const waMessageId = `wamid.qa.${RUN_ID}.1`;
  const inbound = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: PROSPECT_PHONE,
      name: "Prospecto QA",
      text: "Hola, vi su anuncio. ¿Qué servicios ofrecen y tienen algún horario disponible esta semana para una cita?",
      waMessageId,
    }),
  });
  ok("mensaje entregado al webhook real", inbound.res.ok, JSON.stringify(inbound.json));

  info("Esperando al agente (coalesce = AGENT_COALESCE_MS, default 6s, + margen de compilación en dev)...");
  let conv = null;
  let reply = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !reply) {
    await sleep(1000);
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    conv = convs.find((c) => c.contact?.phone === normalizePhone(PROSPECT_PHONE)) ?? conv;
    const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
    reply = outbox.find((m) => m.to === PROSPECT_PHONE || m.to === normalizePhone(PROSPECT_PHONE)) ?? null;
  }
  ok("la conversación del prospecto existe", Boolean(conv), `buscado=${PROSPECT_PHONE}`);
  if (ok("el agente respondió por WhatsApp", Boolean(reply))) {
    const replyText = reply.body?.text?.body ?? reply.body;
    console.log(`  ↳ respuesta del agente: ${JSON.stringify(replyText)}`);
    info(
      "Nota: con el ai-mock esta respuesta es un eco genérico (no razona sobre agenda). " +
        "Ver el comentario del encabezado de este script para probar la decisión real con un LLM real."
    );
  }

  if (agendaOn && conv) {
    section("Simular la decisión del agente: ofrecer horarios y agendar (motor real de agenda)");
    const oferta = await bot(
      `/api/bot/availability?conversationId=${conv.id}&limit=6&perDay=3&days=5`
    );
    const slots = oferta.json?.slots ?? [];
    ok("el motor de agenda devuelve huecos disponibles", slots.length > 0, JSON.stringify(oferta.json));

    if (slots[0]) {
      const booking = await bot("/api/bot/bookings", {
        method: "POST",
        body: JSON.stringify({ conversationId: conv.id, startUtc: slots[0].startUtc }),
      });
      const booked = ok(
        "la cita se creó (201 Created)",
        booking.res.status === 201,
        `status=${booking.res.status} body=${JSON.stringify(booking.json)}`
      );
      if (booked) {
        if (googleConnected) {
          ok(
            "linkPending es boolean (contrato del conector Google, asincronía del Meet)",
            typeof booking.json?.linkPending === "boolean",
            JSON.stringify(booking.json)
          );
          info(
            booking.json?.meetingLink
              ? `enlace de Meet ya disponible: ${booking.json.meetingLink}`
              : `enlace de Meet pendiente (linkPending=${booking.json?.linkPending}) — Google lo genera asíncronamente`
          );
          const state = await api("/api/dev/google-mock/_state");
          info(`evento(s) creados en el Google Calendar simulado: ${JSON.stringify(state.json)}`);
        }
        const bookings = (await api("/api/bookings")).json?.bookings ?? [];
        ok(
          "la cita aparece en Citas, marcada como agendada por la IA",
          bookings.some((b) => b.id === booking.json?.bookingId && b.source === "ai")
        );
      }
    } else {
      info("Sin huecos ofrecidos: revisa que el horario semanal cubra hoy/mañana en America/Mexico_City.");
    }
  }

  section("Resultado");
  if (failures === 0) {
    console.log("Todo verde.");
  } else {
    console.log(`${failures} check(s) fallaron — revisa el detalle arriba.`);
    process.exit(1);
  }
}

/** Mismo criterio que normalizeMx en src/lib/meta/client.ts. */
function normalizePhone(phone) {
  return /^521\d{10}$/.test(phone) ? `52${phone.slice(3)}` : phone;
}

main().catch((err) => {
  console.error("Error inesperado en el script:", err);
  process.exit(1);
});
