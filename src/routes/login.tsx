import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/furushima-logo.jpg";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Furushima Financeiro" },
      {
        name: "description",
        content:
          "Acesse sua conta do Furushima Financeiro para gerenciar receitas, despesas, metas e cartões.",
      },
      { property: "og:title", content: "Entrar — Furushima Financeiro" },
      {
        property: "og:description",
        content:
          "Acesse sua conta do Furushima Financeiro para gerenciar receitas, despesas, metas e cartões.",
      },
      { property: "og:url", content: "https://furushimafinanceiro.lovable.app/login" },
      { name: "twitter:title", content: "Entrar — Furushima Financeiro" },
      {
        name: "twitter:description",
        content:
          "Acesse sua conta do Furushima Financeiro para gerenciar receitas, despesas, metas e cartões.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://furushimafinanceiro.lovable.app/login" }],
  }),
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" ? { next: s.next } : {},

  component: LoginPage,
});

const schema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Mínimo de 6 caracteres").max(72),
});

function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/")) return "/dashboard";
  try {
    const base = new URL("https://furushima.invalid");
    const parsed = new URL(next, base);
    if (parsed.origin !== base.origin) return "/dashboard";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
  }
}

function LoginPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const target = safeNext(next);

  useEffect(() => {
    if (authLoading || !user) return;
    if (target !== "/dashboard") window.location.assign(target);
    else navigate({ to: "/dashboard", replace: true });
  }, [authLoading, navigate, target, user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: `${window.location.origin}${target}` },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Conta criada! Confira seu e-mail para confirmar o acesso.");
          setMode("login");
          return;
        }
        toast.success("Conta criada! Entrando...");
      } else {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        toast.success("Bem-vindo de volta!");
      }
      // For any non-root target (e.g. OAuth consent), do a full navigation.
      if (target !== "/dashboard") {
        window.location.assign(target);
      } else {
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(friendlyError(err, "Erro ao autenticar"));
    } finally {
      setLoading(false);
    }
  };

  if (!authLoading && user) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Abrindo seu painel...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-[minmax(20rem,0.8fr)_minmax(32rem,1.2fr)]">
      <div className="relative hidden lg:flex flex-col justify-between border-r border-border bg-sidebar p-10 xl:p-14 overflow-hidden furushima-loop before:left-1/2 before:top-1/2 before:h-48 before:w-96 before:-translate-x-1/2 before:-translate-y-1/2 before:border-primary/12 after:left-1/2 after:top-1/2 after:h-48 after:w-96 after:-translate-x-1/2 after:-translate-y-1/2 after:border-success/10">
        <Link to="/" className="relative z-10 flex items-center gap-3">
          <img
            src={logo}
            alt="Furushima Financeiro"
            className="h-12 w-12 rounded-md object-contain"
          />
          <span><span className="block font-display text-base font-semibold uppercase tracking-[0.14em]">Furushima</span><span className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Financeiro</span></span>
        </Link>

        <div className="relative z-10 max-w-sm">
          <div className="mb-6 h-px w-24 furushima-brand-line" />
          <h1 className="font-display text-3xl font-semibold leading-tight">Controle financeiro pessoal</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Patrimônio, movimentações, planejamento e investimentos.</p>
        </div>

        <p className="relative z-10 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Furushima Financeiro</p>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <img
              src={logo}
              alt="Furushima Financeiro"
              className="h-11 w-11 rounded-md object-contain"
            />
            <span><span className="block font-display text-sm font-semibold uppercase tracking-[0.12em]">Furushima</span><span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Financeiro</span></span>
          </div>

          <h2 className="font-display text-3xl font-bold">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "login"
              ? "Acesse seu painel financeiro."
              : "Comece a organizar suas finanças hoje."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
             className="w-full"
              size="lg"
            >
              {loading ? "Carregando..." : mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <p className="mt-6 text-sm text-center text-muted-foreground">
            {mode === "login" ? "Não tem uma conta?" : "Já tem uma conta?"}{" "}
            <button
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
               className="text-primary hover:underline font-medium"
            >
              {mode === "login" ? "Criar conta" : "Entrar"}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
