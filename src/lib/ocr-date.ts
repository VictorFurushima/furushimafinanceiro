import { addDaysISO, isValidDateOnly } from "./date-only";

/**
 * Converte o rótulo de data visto no print em "YYYY-MM-DD", relativo à data de referência
 * (dia em que o print foi tirado). Cobre os formatos de extratos, SMS e mensageiros:
 * "Hoje", "Ontem", "sexta-feira, 19:29", "sex., 6 de nov.", "06/11" e datas com ano.
 * Sem ano, vale o ano da referência; se a data cair depois dela, o ano anterior.
 * Só dia da semana: o último dia com esse nome antes da referência.
 */
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

const pad = (n: number) => String(n).padStart(2, "0");

function withYear(day: number, month: number, year: number | null, reference: string) {
  if (year !== null) {
    const full = year < 100 ? 2000 + year : year;
    const iso = `${full}-${pad(month)}-${pad(day)}`;
    return isValidDateOnly(iso) ? iso : null;
  }
  const refYear = Number(reference.slice(0, 4));
  const iso = `${refYear}-${pad(month)}-${pad(day)}`;
  if (iso > reference) {
    const previous = `${refYear - 1}-${pad(month)}-${pad(day)}`;
    return isValidDateOnly(previous) ? previous : null;
  }
  return isValidDateOnly(iso) ? iso : null;
}

export function resolveOcrDateLabel(
  label: string | null | undefined,
  reference: string,
): string | null {
  if (!label || !isValidDateOnly(reference)) return null;
  const text = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return withYear(Number(iso[3]), Number(iso[2]), Number(iso[1]), reference);

  const named = text.match(
    /\b(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s*(?:de\s+)?(\d{4}))?/,
  );
  if (named)
    return withYear(
      Number(named[1]),
      MONTHS.indexOf(named[2]) + 1,
      named[3] ? Number(named[3]) : null,
      reference,
    );

  const numeric = text.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?\b/);
  if (numeric)
    return withYear(
      Number(numeric[1]),
      Number(numeric[2]),
      numeric[3] ? Number(numeric[3]) : null,
      reference,
    );

  if (/\banteontem\b/.test(text)) return addDaysISO(reference, -2);
  if (/\bontem\b/.test(text)) return addDaysISO(reference, -1);
  if (/\bhoje\b/.test(text)) return reference;

  const weekday = text.match(/\b(dom|seg|ter|qua|qui|sex|sab)[a-z]*\b/);
  if (weekday) {
    const [y, m, d] = reference.split("-").map(Number);
    const refDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const back = (refDay - WEEKDAYS.indexOf(weekday[1]) + 7) % 7 || 7;
    return addDaysISO(reference, -back);
  }
  return null;
}
