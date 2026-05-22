import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Wallet, TrendingUp, PieChart } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const schema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Mínimo de 6 caracteres").max(72),
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (!authLoading && user) {
    navigate({ to: "/dashboard" });
  }

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
        const { error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        toast.success("Conta criada! Entrando...");
      } else {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        toast.success("Bem-vindo de volta!");
      }
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Hero side */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-primary opacity-20" />
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-primary-glow/20 blur-3xl" />

        <Link to="/" className="relative z-10 flex items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-gradient-primary shadow-glow flex items-center justify-center">
            <Wallet className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-2xl font-bold">Furushima Financeiro</span>
        </Link>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="font-display text-5xl font-bold leading-tight">
              Seu dinheiro<br />na <span className="text-gradient">palma da mão.</span>
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-md">
              Receitas, despesas, orçamentos e estatísticas — tudo em um só lugar, rápido e bonito.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 max-w-md">
            {[
              { icon: TrendingUp, label: "Estatísticas em tempo real" },
              { icon: PieChart, label: "Gráficos por categoria" },
              { icon: Wallet, label: "Múltiplas contas" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-xl bg-card/40 backdrop-blur border border-border/50 p-4">
                <Icon className="h-5 w-5 text-primary-glow mb-2" />
                <p className="text-xs text-muted-foreground leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-muted-foreground">© Furushima Financeiro — controle financeiro inteligente</p>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-primary shadow-glow flex items-center justify-center">
              <Wallet className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-2xl font-bold">Furushima Financeiro</span>
          </div>

          <h2 className="font-display text-3xl font-bold">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "login" ? "Acesse seu painel financeiro." : "Comece a organizar suas finanças hoje."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} required />
            </div>
            <Button type="submit" disabled={loading} className="w-full bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90 transition" size="lg">
              {loading ? "Carregando..." : mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <p className="mt-6 text-sm text-center text-muted-foreground">
            {mode === "login" ? "Não tem uma conta?" : "Já tem uma conta?"}{" "}
            <button onClick={() => setMode(mode === "login" ? "signup" : "login")} className="text-primary-glow hover:underline font-medium">
              {mode === "login" ? "Criar conta" : "Entrar"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
