import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, UserPlus, Eye, Check, X, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCategories, useCategoryLimits } from "@/hooks/use-finance-data";
import {
  useUserSettings,
  useViewers,
  useInvestments,
  useViewerInvitations,
  DEFAULT_SETTINGS,
} from "@/hooks/use-app-data";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { formatCurrency } from "@/lib/format";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { data: categories = [] } = useCategories();
  const { data: limits = [] } = useCategoryLimits();
  const { isAdmin, userId } = useRole();
  const { data: settingsRow } = useUserSettings();
  const { data: viewers = [] } = useViewers(isAdmin);
  const { data: viewerInvitations = [] } = useViewerInvitations(!!userId);
  const { data: investments = [] } = useInvestments();
  const qc = useQueryClient();

  const [newCat, setNewCat] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");
  const [newCatColor, setNewCatColor] = useState("#228E9A");

  const [limitCat, setLimitCat] = useState("");
  const [limitAmount, setLimitAmount] = useState("");
  const [viewerEmail, setViewerEmail] = useState("");

  const [prefs, setPrefs] = useState({ ...DEFAULT_SETTINGS });
  useEffect(() => {
    if (settingsRow) setPrefs({ ...DEFAULT_SETTINGS, ...settingsRow });
  }, [settingsRow]);

  const guard = () => {
    if (!isAdmin) {
      toast.error(VIEWER_MESSAGE);
      return false;
    }
    return true;
  };

  const addCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!guard() || !newCat.trim() || !userId) return;
    const { error } = await supabase.from("categories").insert({
      user_id: userId,
      name: newCat.trim(),
      type: newCatType,
      color: newCatColor,
      icon: "circle",
    });
    if (error) return toast.error(friendlyError(error));
    toast.success("Categoria criada");
    invalidateFinance(qc, "categories");
    setNewCat("");
  };

  const delCategory = async (id: string) => {
    if (!guard()) return;
    if (!confirm("Excluir esta categoria?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(friendlyError(error));
    invalidateFinance(qc, "categories");
  };

  const setLimit = async (e: FormEvent) => {
    e.preventDefault();
    if (!guard() || !userId) return;
    const v = parseFloat(limitAmount.replace(",", "."));
    if (!limitCat || !v || v <= 0) return toast.error("Preencha categoria e valor");
    const { error } = await supabase.from("category_limits").upsert(
      {
        user_id: userId,
        category_id: limitCat,
        monthly_limit: v,
      },
      { onConflict: "user_id,category_id" },
    );
    if (error) return toast.error(friendlyError(error));
    toast.success("Limite definido");
    invalidateFinance(qc, "categoryLimits");
    setLimitAmount("");
  };

  const delLimit = async (id: string) => {
    if (!guard()) return;
    const { error } = await supabase.from("category_limits").delete().eq("id", id);
    if (error) return toast.error(friendlyError(error));
    invalidateFinance(qc, "categoryLimits");
  };

  const savePrefs = async (e: FormEvent) => {
    e.preventDefault();
    if (!guard() || !userId) return;
    const { error } = await supabase
      .from("user_settings")
      .upsert({ ...prefs, user_id: userId }, { onConflict: "user_id" });
    if (error) return toast.error(friendlyError(error));
    toast.success("Preferências salvas");
    invalidateFinance(qc, "settings");
  };

  const grantViewer = async (e: FormEvent) => {
    e.preventDefault();
    if (!guard()) return;
    const email = viewerEmail.trim();
    if (!email) return toast.error("Informe o e-mail");
    const { data, error } = await supabase.rpc("grant_viewer_access", { p_email: email });
    if (error) return toast.error(friendlyError(error));
    if (data === "not_found") return toast.error("Nenhuma conta encontrada com esse e-mail");
    if (data === "self") return toast.error("Você não pode se tornar espectador");
    if (data === "forbidden") return toast.error(VIEWER_MESSAGE);
    if (data === "already_viewer") return toast.error("Essa conta já é espectadora");
    toast.success("Convite enviado; a outra conta precisa aceitar");
    setViewerEmail("");
    invalidateFinance(qc, "viewers");
  };

  const revokeViewer = async (uid: string) => {
    if (!guard()) return;
    const { data, error } = await supabase.rpc("revoke_viewer_access", { p_user_id: uid });
    if (error) return toast.error(friendlyError(error));
    if (data === "not_found") return toast.error("Acesso ou convite não encontrado");
    toast.success("Acesso revogado");
    invalidateFinance(qc, "viewers");
  };

  const respondToViewerInvitation = async (id: string, accept: boolean) => {
    const { data, error } = accept
      ? await supabase.rpc("accept_viewer_access", { p_invitation_id: id })
      : await supabase.rpc("decline_viewer_access", { p_invitation_id: id });
    if (error) return toast.error(friendlyError(error));
    if (data !== "ok") return toast.error("Esse convite não está mais disponível");
    if (accept) {
      toast.success("Acesso de espectador ativado");
      qc.clear();
      window.location.assign("/dashboard");
      return;
    }
    toast.success("Convite recusado");
    qc.invalidateQueries({ queryKey: ["viewer-invitations"] });
  };

  const leaveViewerAccess = async () => {
    if (!confirm("Sair do acesso compartilhado e voltar ao seu espaço próprio?")) return;
    const { data, error } = await supabase.rpc("leave_viewer_access");
    if (error) return toast.error(friendlyError(error));
    if (data !== "ok") return toast.error("Acesso compartilhado não encontrado");
    qc.clear();
    window.location.assign("/dashboard");
  };

  return (
    <div className="p-4 sm:p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <h1 className="font-display text-3xl sm:text-4xl font-bold">Configurações</h1>
      {!isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-secondary/30 p-3">
          <p className="text-sm text-muted-foreground">{VIEWER_MESSAGE}</p>
          <Button type="button" variant="outline" size="sm" onClick={leaveViewerAccess}>
            <LogOut className="h-4 w-4 mr-2" /> Sair do acesso compartilhado
          </Button>
        </div>
      )}

      {viewerInvitations.length > 0 && (
        <Card className="bg-gradient-card border-primary/30 shadow-card">
          <CardHeader>
            <CardTitle className="font-display">Convites de visualização</CardTitle>
            <p className="text-xs text-muted-foreground">
              Ao aceitar, esta conta passa a visualizar o espaço indicado até você sair dele.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {viewerInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-secondary/30 p-3"
              >
                <span className="text-sm">Convite de {invitation.owner_email}</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => respondToViewerInvitation(invitation.id, true)}
                  >
                    <Check className="h-4 w-4 mr-1" /> Aceitar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => respondToViewerInvitation(invitation.id, false)}
                  >
                    <X className="h-4 w-4 mr-1" /> Recusar
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Categorias</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <form
              onSubmit={addCategory}
              className="grid grid-cols-1 md:grid-cols-[1fr,140px,80px,auto] gap-3"
            >
              <Input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="Nome da categoria"
                maxLength={50}
              />
              <Select
                value={newCatType}
                onValueChange={(v) => setNewCatType(v as "income" | "expense")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Despesa</SelectItem>
                  <SelectItem value="income">Receita</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                className="h-10"
                aria-label="Cor da categoria"
              />
              <Button
                type="submit"
                className="bg-gradient-primary text-primary-foreground"
                aria-label="Adicionar categoria"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </form>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 group"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                  {c.name}
                  <span className="text-xs text-muted-foreground">
                    ({c.type === "income" ? "receita" : "despesa"})
                  </span>
                </span>
                {isAdmin && (
                  <button
                    onClick={() => delCategory(c.id)}
                    aria-label={`Excluir categoria ${c.name}`}
                    className="p-2 -m-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Limites mensais por categoria</CardTitle>
          <p className="text-xs text-muted-foreground">
            Receba alertas quando uma categoria ultrapassar o limite
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <form
              onSubmit={setLimit}
              className="grid grid-cols-1 md:grid-cols-[1fr,200px,auto] gap-3"
            >
              <Select value={limitCat} onValueChange={setLimitCat}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((c) => c.type === "expense")
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                value={limitAmount}
                onChange={(e) => setLimitAmount(e.target.value)}
                placeholder="Limite (R$)"
                inputMode="decimal"
              />
              <Button type="submit" className="bg-gradient-primary text-primary-foreground">
                Salvar
              </Button>
            </form>
          )}
          <ul className="space-y-2">
            {limits.length === 0 && (
              <li className="text-sm text-muted-foreground">Nenhum limite definido.</li>
            )}
            {limits.map((l) => {
              const cat = categories.find((c) => c.id === l.category_id);
              return (
                <li
                  key={l.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <span className="text-sm">{cat?.name ?? "—"}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">
                      {formatCurrency(Number(l.monthly_limit))}
                    </span>
                    {isAdmin && (
                      <button
                        onClick={() => delLimit(l.id)}
                        aria-label="Excluir limite"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Regras de compras e aportes</CardTitle>
          <p className="text-xs text-muted-foreground">
            Usadas na análise de viabilidade do carrinho
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePrefs} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="min_reserve">Reserva mínima (R$)</Label>
                <Input
                  id="min_reserve"
                  inputMode="decimal"
                  disabled={!isAdmin}
                  value={String(prefs.min_reserve)}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      min_reserve: Number(e.target.value.replace(",", ".")) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="max_free">% máx. do saldo livre</Label>
                <Input
                  id="max_free"
                  inputMode="decimal"
                  disabled={!isAdmin}
                  value={String(prefs.max_free_balance_pct)}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      max_free_balance_pct: Number(e.target.value.replace(",", ".")) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="max_inst">% máx. da renda em parcelas</Label>
                <Input
                  id="max_inst"
                  inputMode="decimal"
                  disabled={!isAdmin}
                  value={String(prefs.max_income_installment_pct)}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      max_income_installment_pct: Number(e.target.value.replace(",", ".")) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                <Label htmlFor="allow_low">Permitir desejo com score baixo</Label>
                <Switch
                  id="allow_low"
                  disabled={!isAdmin}
                  checked={prefs.allow_low_score_wants}
                  onCheckedChange={(v) => setPrefs({ ...prefs, allow_low_score_wants: v })}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                <Label htmlFor="alerts">Alertas de compra</Label>
                <Switch
                  id="alerts"
                  disabled={!isAdmin}
                  checked={prefs.purchase_alerts}
                  onCheckedChange={(v) => setPrefs({ ...prefs, purchase_alerts: v })}
                />
              </div>
              <div className="space-y-1">
                <Label>Prioridade mínima para aprovação</Label>
                <Select
                  value={prefs.min_priority_auto}
                  disabled={!isAdmin}
                  onValueChange={(v) => setPrefs({ ...prefs, min_priority_auto: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="media">Média</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg bg-secondary/30 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="reminder">Lembrete mensal de aporte</Label>
                <Switch
                  id="reminder"
                  disabled={!isAdmin}
                  checked={prefs.reminder_enabled}
                  onCheckedChange={(v) => setPrefs({ ...prefs, reminder_enabled: v })}
                />
              </div>
              {prefs.reminder_enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="rday">Dia do mês</Label>
                    <Input
                      id="rday"
                      type="number"
                      min={1}
                      max={28}
                      disabled={!isAdmin}
                      value={prefs.reminder_day}
                      onChange={(e) =>
                        setPrefs({ ...prefs, reminder_day: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ramount">Valor sugerido (R$)</Label>
                    <Input
                      id="ramount"
                      inputMode="decimal"
                      disabled={!isAdmin}
                      value={String(prefs.reminder_amount)}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          reminder_amount: Number(e.target.value.replace(",", ".")) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rmsg">Mensagem</Label>
                    <Input
                      id="rmsg"
                      disabled={!isAdmin}
                      value={prefs.reminder_message ?? ""}
                      onChange={(e) => setPrefs({ ...prefs, reminder_message: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Investimento recomendado</Label>
                    <Select
                      value={prefs.reminder_investment_id ?? "none"}
                      disabled={!isAdmin}
                      onValueChange={(v) =>
                        setPrefs({ ...prefs, reminder_investment_id: v === "none" ? null : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Nenhum" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {investments
                          .filter((i) => i.status !== "resgatado")
                          .map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {isAdmin && (
              <Button
                type="submit"
                className="w-full sm:w-auto bg-gradient-primary text-primary-foreground"
              >
                Salvar preferências
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardHeader>
            <CardTitle className="font-display">Espectadores</CardTitle>
            <p className="text-xs text-muted-foreground">
              Contas com acesso somente leitura aos seus dados. A pessoa precisa já ter uma conta
              criada.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={grantViewer} className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3">
              <Input
                type="email"
                value={viewerEmail}
                onChange={(e) => setViewerEmail(e.target.value)}
                placeholder="email@exemplo.com"
                aria-label="E-mail do espectador"
              />
              <Button type="submit" className="bg-gradient-primary text-primary-foreground">
                <UserPlus className="h-4 w-4 mr-2" /> Conceder acesso
              </Button>
            </form>
            <ul className="space-y-2">
              {viewers.length === 0 && (
                <li className="text-sm text-muted-foreground">Nenhum espectador cadastrado.</li>
              )}
              {viewers.map((v) => (
                <li
                  key={v.user_id}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <Eye className="h-4 w-4 text-muted-foreground" /> {v.email}
                    {v.status === "pending" && (
                      <span className="text-xs text-muted-foreground">(convite pendente)</span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeViewer(v.user_id)}
                    aria-label={`Revogar acesso de ${v.email}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="bg-gradient-card border-border/50 shadow-card">
        <CardHeader>
          <CardTitle className="font-display">Preferências gerais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
            <span>Moeda padrão</span>
            <span className="font-medium text-foreground">Real (R$)</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
            <span>Tema</span>
            <span className="font-medium text-foreground">Dark mode</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
