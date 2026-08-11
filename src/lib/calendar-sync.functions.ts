import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Camada server-side de sincronização Furushima -> Google Calendar.
 * Fluxo unidirecional: o PostgreSQL é fonte de verdade; o Google é espelho.
 *
 * A integração usa o Connector Gateway da Lovable. Enquanto nenhuma conexão
 * Google Calendar estiver vinculada ao projeto, `readCreds()` devolve null e o
 * adapter permanece inativo (status "Não conectado"), sem quebrar o build e sem
 * expor qualquer credencial ao browser.
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

/**
 * Efeito colateral externo exige autorização explícita: viewer enxerga o espaço
 * do owner por RLS, então "estar logado" não é suficiente.
 */
async function assertAdmin(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => any },
  userId: string,
) {
  const { data, error } = await supabase.rpc("is_admin", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Somente administradores podem sincronizar a agenda");
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
      calendarSummary: CALENDAR_SUMMARY,
      status: configured ? ((data?.status as string | undefined) ?? "pending") : "disconnected",
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
    const { supabase, userId } = context;
    await assertAdmin(supabase as never, userId);

    const creds = readCreds();
    if (!creds) return { synced: false, reason: "not_configured" as const };

    const { data: ev, error } = await supabase
      .from("calendar_events")
      .select(
        "id,title,description,location,starts_at,ends_at,all_day,recurrence_rule,google_event_id,sync_enabled",
      )
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
        // A recorrência é preservada no Postgres e replicada no espelho.
        recurrence: ev.recurrence_rule ? [ev.recurrence_rule as string] : undefined,
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

/**
 * Exclusão consistente: remove primeiro o espelho no Google e só então o
 * registro local. Se o Google falhar, o evento local é preservado com
 * sync_status='error' para retry — nada some silenciosamente.
 */
export const deleteEventEverywhere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { eventId: string }) => {
    if (!data?.eventId) throw new Error("eventId obrigatório");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase as never, userId);

    const { data: ev, error } = await supabase
      .from("calendar_events")
      .select("id,google_event_id")
      .eq("id", data.eventId)
      .maybeSingle();
    if (error) throw error;
    if (!ev) return { deleted: false, reason: "not_found" as const };

    const creds = readCreds();
    const googleId = ev.google_event_id as string | null;

    if (googleId && creds) {
      const { data: integration } = await supabase
        .from("calendar_integrations")
        .select("calendar_id")
        .eq("provider", "google")
        .maybeSingle();
      const calendarId = integration?.calendar_id as string | undefined;
      if (calendarId) {
        try {
          await gateway(
            creds,
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleId)}`,
            { method: "DELETE" },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await supabase
            .from("calendar_events")
            .update({ sync_status: "error", sync_error: `Falha ao remover no Google: ${message}` })
            .eq("id", ev.id);
          return { deleted: false, reason: "remote_error" as const, message };
        }
      }
    }

    const { error: delError } = await supabase.from("calendar_events").delete().eq("id", ev.id);
    if (delError) throw delError;
    return { deleted: true as const, remoteRemoved: Boolean(googleId && creds) };
  });
