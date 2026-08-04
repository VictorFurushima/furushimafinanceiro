import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSelicRate } from "@/lib/selic.functions";

const CACHE_KEY = "furushima:selic";
const ONE_HOUR = 60 * 60 * 1000;

interface Cached { rate: number; fetchedAt: string }

function readCache(): Cached | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch { return null; }
}

export function formatSelicTimestamp(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function useSelic() {
  const fetchSelic = useServerFn(getSelicRate);
  const [data, setData] = useState<Cached | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (force = false) => {
    const cached = readCache();
    if (cached) setData(cached);
    const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < ONE_HOUR;
    if (fresh && !force) { setLoading(false); setStale(false); return; }
    try {
      const res = await fetchSelic();
      const next = { rate: res.rate, fetchedAt: res.fetchedAt };
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      setData(next); setStale(false);
    } catch {
      setStale(!!cached);
      if (!cached) setStale(true);
    } finally { setLoading(false); }
  }, [fetchSelic]);

  useEffect(() => {
    setData(readCache());
    void refresh();
    const id = setInterval(() => void refresh(true), ONE_HOUR);
    return () => clearInterval(id);
  }, [refresh]);

  return { rate: data?.rate ?? null, fetchedAt: data?.fetchedAt ?? null, stale, loading, refresh };
}
