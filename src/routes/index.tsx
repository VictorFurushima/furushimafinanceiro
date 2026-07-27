import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Furushima Financeiro — Controle financeiro pessoal" },
      { name: "description", content: "Gerencie receitas, despesas, assinaturas, metas e cartões em um só lugar com estatísticas em tempo real." },
      { property: "og:title", content: "Furushima Financeiro — Controle financeiro pessoal" },
      { property: "og:description", content: "Gerencie receitas, despesas, assinaturas, metas e cartões em um só lugar com estatísticas em tempo real." },
      { property: "og:url", content: "https://furushimafinanceiro.lovable.app/" },
      { name: "twitter:title", content: "Furushima Financeiro — Controle financeiro pessoal" },
      { name: "twitter:description", content: "Gerencie receitas, despesas, assinaturas, metas e cartões em um só lugar com estatísticas em tempo real." },
    ],
    links: [{ rel: "canonical", href: "https://furushimafinanceiro.lovable.app/" }],
  }),
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-primary shadow-glow" />
      </div>
    );
  }
  return <Navigate to={user ? "/dashboard" : "/login"} />;
}
