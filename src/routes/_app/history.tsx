import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, RotateCcw, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  useFinancialHistory,
  useFinancialAction,
  type HistoryFilters,
} from "@/hooks/use-financial-history";
import { useAccounts, useCreditCards, useCategories } from "@/hooks/use-finance-data";
import { useRole } from "@/hooks/use-role";
import {
  HISTORY_AREAS,
  historyTitle,
  changedFields,
  historyValue,
  historyReferences,
  type ReversalResult,
} from "@/lib/financial-history";
import { invalidateAllFinance } from "@/lib/query-keys";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/integrations/supabase/client";
export const Route = createFileRoute("/_app/history")({ component: HistoryPage });
const timestamp = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
function HistoryPage() {
  const { isAdmin } = useRole();
  const [filters, setFilters] = useState<HistoryFilters>({
    page: 0,
    status: "all",
    table: "all",
    from: "",
    to: "",
    search: "",
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const query = useFinancialHistory(filters);
  const update = (change: Partial<HistoryFilters>) =>
    setFilters((f) => ({ ...f, ...change, page: 0 }));
  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">
            Histórico de ações
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Confira o que mudou e recupere uma ação feita por engano.
          </p>
        </div>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Atualizar
        </Button>
      </header>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="history-status">Situação</Label>
              <Select value={filters.status} onValueChange={(status) => update({ status })}>
                <SelectTrigger id="history-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="active">Ainda não revertidas</SelectItem>
                  <SelectItem value="reverted">Revertidas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-area">Área</Label>
              <Select value={filters.table} onValueChange={(table) => update({ table })}>
                <SelectTrigger id="history-area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as áreas</SelectItem>
                  {Object.entries(HISTORY_AREAS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-from">Desde</Label>
              <Input
                id="history-from"
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => update({ from: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-to">Até</Label>
              <Input
                id="history-to"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => update({ to: e.target.value })}
              />
            </div>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              update({ search: search.trim() });
            }}
          >
            <Input
              aria-label="Buscar no histórico"
              placeholder="Buscar descrição ou nome"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="outline" type="submit">
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        O histórico registra as ações feitas a partir da ativação desta ferramenta. Cada reversão
        recupera a operação inteira. Arquivos enviados e permissões de acesso usam seus próprios
        controles.
      </p>
      {!isAdmin && (
        <p className="text-sm text-muted-foreground">
          Você está em modo espectador. A reversão fica disponível para o titular.
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {friendlyError(query.error, "Não foi possível carregar o histórico")}
        </p>
      )}
      {query.isPending ? (
        <p className="text-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando histórico...
        </p>
      ) : !query.data?.rows.length && !query.error ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <History className="h-8 w-8 mx-auto text-muted-foreground" />
            <p>Nenhuma ação neste filtro.</p>
            <p className="text-sm text-muted-foreground">As próximas alterações aparecerão aqui.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" aria-busy={query.isFetching}>
          {query.data?.rows.map((action) => (
            <Card key={action.id}>
              <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-sm">{historyTitle(action)}</p>
                    <Badge variant="outline">
                      {action.reverted_at ? "Revertida" : "Registrada"}
                    </Badge>
                  </div>
                  {action.description && (
                    <p className="text-sm break-words">{action.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {timestamp(action.created_at)} · {action.change_count}{" "}
                    {action.change_count === 1 ? "registro afetado" : "registros afetados"}
                  </p>
                  {action.reverted_at && (
                    <p className="text-xs text-muted-foreground">
                      Revertida em {timestamp(action.reverted_at)}
                    </p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelected(action.id)}>
                  {isAdmin && !action.reverted_at ? "Detalhes e reversão" : "Ver detalhes"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {query.data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {query.data.count} ações · Página {filters.page + 1}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!filters.page || query.isFetching}
              onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(filters.page + 1) * 25 >= query.data.count || query.isFetching}
              onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
      {selected && <ActionDetail id={selected} onClose={() => setSelected("")} />}
    </div>
  );
}
function ActionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const query = useFinancialAction(id);
  const { data: accounts = [] } = useAccounts();
  const { data: cards = [] } = useCreditCards();
  const { data: categories = [] } = useCategories();
  const [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false);
  const detail = query.data;
  const references = historyReferences(detail?.changes ?? [], [
    ...accounts,
    ...cards,
    ...categories,
  ]);
  const revert = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("revert_financial_action", { p_action_id: id });
      if (error) throw error;
      const result = data as unknown as ReversalResult;
      if (result.status === "conflict") {
        toast.error("Existem alterações posteriores. Confira os conflitos antes de reverter.");
        setConfirming(false);
        await query.refetch();
        return;
      }
      if (!["reverted", "already_reverted"].includes(result.status))
        throw new Error("A reversão não foi confirmada pelo servidor");
      invalidateAllFinance(qc);
      toast.success(
        result.status === "reverted"
          ? "Ação revertida. Os dados foram atualizados."
          : "Esta ação já foi revertida.",
      );
      setConfirming(false);
      onClose();
    } catch (error) {
      toast.error(friendlyError(error, "Não foi possível reverter a ação"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da ação</DialogTitle>
            <DialogDescription>
              Confira o estado registrado e o resultado da reversão antes de confirmar.
            </DialogDescription>
          </DialogHeader>
          {query.isPending && <p className="text-sm">Carregando detalhes...</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {friendlyError(query.error)}
            </p>
          )}
          {detail && (
            <div className="space-y-4">
              <div>
                <p className="font-medium">{historyTitle(detail.action)}</p>
                <p className="text-sm break-words">{detail.action.description}</p>
                <p className="text-xs text-muted-foreground">
                  {timestamp(detail.action.created_at)}
                </p>
              </div>
              {!detail.action.reverted_at && !!detail.conflicts.length && (
                <div
                  role="alert"
                  className="rounded-md border border-warning/40 p-3 text-sm space-y-2"
                >
                  <p className="font-medium">Esta ação não pode ser revertida agora.</p>
                  {[...new Set(detail.conflicts.map((c) => c.reason))].map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              )}
              {detail.action.reverted_at && (
                <p className="text-sm text-muted-foreground">
                  Esta ação já foi revertida. A reversão também fica registrada no histórico.
                </p>
              )}
              <div className="space-y-3">
                {detail.changes.map((change) => {
                  const fields = changedFields(change);
                  return (
                    <section
                      key={`${change.table}:${change.id}`}
                      className="rounded-md border p-3 space-y-2 [content-visibility:auto]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-medium">
                          {HISTORY_AREAS[change.table] ?? "Registro financeiro"}
                        </h2>
                        <Badge variant="outline">
                          {detail.action.reverted_at
                            ? "Reversão realizada"
                            : change.before === null
                              ? "Será removido"
                              : change.after === null
                                ? "Será recuperado"
                                : "Será restaurado"}
                        </Badge>
                      </div>
                      {fields.length ? (
                        <div className="space-y-2">
                          {fields.map((field) => (
                            <div
                              key={field.key}
                              className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_1.2fr] gap-1 sm:gap-3 text-xs border-t pt-2"
                            >
                              <p className="font-medium">{field.label}</p>
                              <p className="break-words whitespace-pre-wrap">
                                <span className="text-muted-foreground">Registrado: </span>
                                {historyValue(field.key, field.current, references)}
                              </p>
                              <p className="break-words whitespace-pre-wrap">
                                <span className="text-muted-foreground">
                                  {detail.action.reverted_at
                                    ? "Estado anterior: "
                                    : "Após reverter: "}
                                </span>
                                {historyValue(field.key, field.restored, references)}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          O vínculo será recuperado junto com a operação.
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
              {isAdmin && !detail.action.reverted_at && (
                <Button
                  className="w-full sm:w-auto"
                  disabled={!detail.can_revert || query.isFetching || busy}
                  onClick={() => setConfirming(true)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reverter esta ação
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar reversão?</AlertDialogTitle>
            <AlertDialogDescription>
              O site recuperará o estado anterior desta operação e atualizará os registros
              vinculados. A reversão também ficará no histórico. Se algo mudou depois, o banco
              interromperá a operação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void revert();
              }}
            >
              {busy ? "Revertendo..." : "Confirmar reversão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
