import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import logo from "@/assets/furushima-logo.jpg";

// Beta namespace on the Supabase client — narrow local wrapper so TS doesn't
// complain if the type isn't exported. Uses the actual runtime methods.
type OAuthDetails = {
  client?: { name?: string; client_uri?: string; logo_uri?: string } | null;
  redirect_url?: string;
  redirect_to?: string;
  scope?: string;
  requested_scopes?: string[];
};
type OAuthResult = { data: OAuthDetails | null; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

function safeOAuthRedirect(target: string): string {
  const base = new URL("https://furushima.invalid");
  if (target.startsWith("/")) {
    const relative = new URL(target, base);
    if (relative.origin === base.origin) {
      return `${relative.pathname}${relative.search}${relative.hash}`;
    }
  }

  const url = new URL(target);
  const localHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
    throw new Error("Destino OAuth inseguro");
  }
  return url.toString();
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: Supabase reads its session from localStorage.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(friendlyError(error));
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: safeOAuthRedirect(immediate) });
    return data;
  },
  component: ConsentPage,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="font-display text-2xl font-bold">Não foi possível carregar</h1>
        <p className="text-sm text-muted-foreground">
          {(error as Error)?.message ?? String(error)}
        </p>
      </div>
    </main>
  ),
});

function ConsentPage() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      const message = friendlyError(error);
      setError(message);
      toast.error(message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Servidor de autorização não retornou destino de redirecionamento.");
      return;
    }
    // External redirect back to the OAuth client.
    try {
      window.location.assign(safeOAuthRedirect(target));
    } catch (redirectError) {
      const message = friendlyError(redirectError, "Destino de redirecionamento inválido.");
      setBusy(false);
      setError(message);
      toast.error(message);
    }
  }

  const clientName = details?.client?.name ?? "Aplicativo externo";
  const scopes =
    details?.requested_scopes ?? (details?.scope ? details.scope.split(" ").filter(Boolean) : []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/50 backdrop-blur p-8 shadow-glow space-y-6">
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt="Furushima"
            className="h-11 w-11 rounded-xl object-cover shadow-glow"
          />
          <div>
            <p className="text-xs text-muted-foreground">Furushima Financeiro</p>
            <h1 className="font-display text-xl font-bold leading-tight">
              Conectar <span className="text-gradient">{clientName}</span>
            </h1>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{clientName}</strong> poderá usar o Furushima
          Financeiro como você — ler contas, transações, recargas, cartões e registrar novas
          transações. Suas políticas de acesso (RLS) continuam válidas.
        </p>

        {scopes.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Permissões solicitadas</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {scopes.map((s: string) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => decide(false)}
          >
            Cancelar
          </Button>
          <Button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90"
          >
            {busy ? "Conectando..." : "Autorizar"}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Isso não contorna as permissões do app nem as políticas do banco de dados.
        </p>
      </div>
    </main>
  );
}
