import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Camada server-side de sincronização Furushima -> Google Calendar.
 * Fluxo unidirecional: o PostgreSQL é fonte de verdade; o Google é espelho.
 * Nenhuma credencial trafega para o browser.
 */

const GATEWAY = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_SUMMARY = "Furushima";

interface GoogleCreds {
  lovableKey: string;
  connectionKey: string;
}

function readCreds(): GoogleCreds | null {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["GOOGLE_CALENDAR_API_KEY"];
  if (!lovableKey || !connectionKey) return null;
  return { lovableKey, connectionKey };
}

async function gateway(creds: GoogleCreds, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.lovableKey}`,
      "X-Connection-Api-Key": creds.connectionKey,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[google-calendar] ${path} falhou [${res.status}]: ${text}`);
    throw new Error(`Google Calendar respondeu ${res.status}: ${text}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** Informa à UI se a integração está disponível no servidor (sem expor segredos). */
export const getCalendarSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const configured = readCreds() !== null;
    const { data } = await context.supabase
      .from("calendar_integrations")
      .select("status,calendar_id,account_email,last_error")
      .eq("provider", "google")
      .maybeSingle();
    return {
      configured,
      status: (data?.status as string | undefined) ?? "disconnected",
      calendarId: (data?.calendar_id as string | null | undefined) ?? null,
      accountEmail: (data?.account_email as string | null | undefined) ?? null,
      lastError: (data?.last_error as string | null | undefined) ?? null,
    };
  });

async function ensureCalendarId(
  creds: GoogleCreds,
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("calendar_integrations")
    .select("id,calendar_id")
    .eq("provider", "google")
    .maybeSingle();
  if (data?.calendar_id) return data.calendar_id as string;

  const created = await gateway(creds, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: CALENDAR_SUMMARY, timeZone: "America/Sao_Paulo" }),
  });
  const calendarId = String(created["id"] ?? "");
  if (!calendarId) throw new Error("Google Calendar não retornou o id do calendário");

  await supabase.from("calendar_integrations").upsert(
    {
      user_id: userId,
      provider: "google",
      calendar_id: calendarId,
      status: "connected",
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "user_id,provider" },
  );
  return calendarId;
}

/**
 * Envia (insert/patch) um evento local para o Google. Idempotente:
 * reexecutar apenas atualiza o mesmo google_event_id.
 */
export const pushEventToGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { eventId: string }) => {
    if (!data?.eventId) throw new Error("eventId obrigatório");
    return data;
  })
  .handler(async ({ data, context }) => {
    const creds = readCreds();
    if (!creds) return { synced: false, reason: "not_configured" as const };

    const { supabase, userId } = context;
    const { data: ev, error } = await supabase
      .from("calendar_events")
      .select("id,title,description,location,starts_at,ends_at,all_day,google_event_id,sync_enabled")
      .eq("id", data.eventId)
      .maybeSingle();
    if (error) throw error;
    if (!ev) return { synced: false, reason: "not_found" as const };
    if (!ev.sync_enabled) return { synced: false, reason: "disabled" as const };

    try {
      const calendarId = await ensureCalendarId(creds, supabase as never, userId);
      const body = {
        summary: ev.title,
        description: ev.description ?? undefined,
        location: ev.location ?? undefined,
        start: ev.all_day
          ? { date: String(ev.starts_at).slice(0, 10) }
          : { dateTime: new Date(ev.starts_at as string).toISOString() },
        end: ev.all_day
          ? { date: String(ev.ends_at).slice(0, 10) }
          : { dateTime: new Date(ev.ends_at as string).toISOString() },
      };
      const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
      const result = ev.google_event_id
        ? await gateway(creds, `${path}/${encodeURIComponent(ev.google_event_id as string)}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : await gateway(creds, path, { method: "POST", body: JSON.stringify(body) });

      await supabase
        .from("calendar_events")
        .update({
          google_event_id: String(result["id"] ?? ev.google_event_id ?? ""),
          sync_status: "synced",
          last_synced_at: new Date().toISOString(),
          sync_error: null,
        })
        .eq("id", ev.id);
      return { synced: true as const };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // O dado local nunca é perdido: apenas marcamos o erro para retry manual.
      await supabase
        .from("calendar_events")
        .update({ sync_status: "error", sync_error: message })
        .eq("id", ev.id);
      return { synced: false, reason: "error" as const, message };
    }
  });

/** Remove o espelho no Google quando o evento local é excluído. */
export const deleteEventOnGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { googleEventId: string }) => {
    if (!data?.googleEventId) throw new Error("googleEventId obrigatório");
    return data;
  })
  .handler(async ({ data, context }) => {
    const creds = readCreds();
    if (!creds) return { deleted: false, reason: "not_configured" as const };
    const { data: integration } = await context.supabase
      .from("calendar_integrations")
      .select("calendar_id")
      .eq("provider", "google")
      .maybeSingle();
    const calendarId = integration?.calendar_id as string | undefined;
    if (!calendarId) return { deleted: false, reason: "not_configured" as const };
    try {
      await gateway(
        creds,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(data.googleEventId)}`,
        { method: "DELETE" },
      );
      return { deleted: true as const };
    } catch (e) {
      return { deleted: false, reason: "error" as const, message: e instanceof Error ? e.message : String(e) };
    }
  });
