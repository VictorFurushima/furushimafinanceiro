/**
 * Camada central para colunas DATE (data-only) do Postgres.
 *
 * Regras:
 * - Nunca usar `new Date("YYYY-MM-DD")` para exibir uma DATE: o JS interpreta
 *   como UTC e no Brasil (UTC-3) mostra o dia anterior.
 * - Nunca usar `toISOString().slice(0,10)` para obter a data local: depois das
 *   21h (BRT) o valor vira o dia seguinte.
 *
 * Todas as funções aqui tratam a string "YYYY-MM-DD" como um rótulo de
 * calendário, sem fuso, e a "data de hoje" sempre em America/Sao_Paulo.
 */

export const APP_TIMEZONE = "America/Sao_Paulo";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida formato E existência real no calendário (rejeita 2026-02-30). */
export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth && y >= 1900 && y <= 2200;
}

/**
 * Converte "YYYY-MM-DD" num Date posicionado ao meio-dia LOCAL.
 * O meio-dia evita que qualquer conversão de fuso mude o dia exibido.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = value.slice(0, 10);
  if (!isValidDateOnly(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Formata uma DATE ("YYYY-MM-DD") em dd/mm/aaaa sem deslocamento de fuso. */
export function formatDateOnlyPtBR(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = parseDateOnly(value);
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", options);
}

/** Converte um Date (componentes locais) em "YYYY-MM-DD". */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Data de hoje em America/Sao_Paulo no formato "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  // en-CA produz YYYY-MM-DD; o timeZone garante o dia correto no Brasil.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Soma dias a uma DATE preservando o calendário. */
export function addDaysISO(value: string, days: number): string {
  const d = parseDateOnly(value);
  if (!d) return value;
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

/** Diferença em dias inteiros entre duas DATEs (b - a). */
export function diffDaysISO(a: string, b: string): number | null {
  const da = parseDateOnly(a);
  const db = parseDateOnly(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}
