import { createServerFn } from "@tanstack/react-start";

export interface SelicResult {
  rate: number;
  fetchedAt: string;
}

/** Proxy seguro para a série 432 (Selic meta % a.a.) do Banco Central do Brasil. */
export const getSelicRate = createServerFn({ method: "GET" }).handler(
  async (): Promise<SelicResult> => {
    const url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`BCB respondeu ${res.status}`);
    const json = (await res.json()) as { data: string; valor: string }[];
    const raw = json?.[0]?.valor;
    const rate = raw ? parseFloat(String(raw).replace(",", ".")) : NaN;
    if (!Number.isFinite(rate)) throw new Error("Resposta inválida do Banco Central");
    return { rate, fetchedAt: new Date().toISOString() };
  },
);
