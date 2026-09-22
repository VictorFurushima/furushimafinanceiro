import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, CreditCard, CalendarClock, Loader2 } from "lucide-react";
import { useInstallments } from "@/hooks/use-installments";
import { useCreditCards } from "@/hooks/use-finance-data";
import { useRole } from "@/hooks/use-role";
import { formatCurrency } from "@/lib/format";
import { formatDateOnlyPtBR } from "@/lib/date-only";
import { friendlyError } from "@/lib/friendly-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TransactionDialog } from "@/components/transaction-dialog";

export const Route = createFileRoute("/_app/installments")({ component: InstallmentsPage });
const statusNames = { paid: "Paga", pending: "Pendente", overdue: "Vencida" };

function InstallmentsPage() {
  const { isAdmin } = useRole();
  const { data: cards = [] } = useCreditCards();
  const [card, setCard] = useState("all");
  const [status, setStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const { data, isPending, isFetching, error, refetch } = useInstallments(
    card,
    status,
    search,
    page,
  );
  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold">Parcelas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Acompanhe suas compras parceladas no cartão, os vencimentos e quanto falta pagar.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nova compra parcelada
          </Button>
        )}
      </header>
      <form
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
          setPage(0);
        }}
      >
        <div className="space-y-1">
          <Label>Cartão</Label>
          <Select
            value={card}
            onValueChange={(v) => {
              setCard(v);
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os cartões</SelectItem>
              {cards.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Situação da compra</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="active">Em andamento</SelectItem>
              <SelectItem value="paid">Quitadas</SelectItem>
              <SelectItem value="overdue">Com parcelas vencidas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="installment-search">Buscar compra</Label>
          <div className="flex gap-2">
            <Input
              id="installment-search"
              value={searchInput}
              maxLength={100}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nome da compra"
            />
            <Button type="submit" variant="outline">
              Buscar
            </Button>
          </div>
        </div>
      </form>
      {isPending && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando parcelas...
        </p>
      )}
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="p-4">
            <p role="alert">{friendlyError(error, "Não foi possível carregar as parcelas")}</p>
            <Button variant="outline" onClick={() => refetch()} className="mt-3">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}
      {data && !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-busy={isFetching}>
            {[
              ["Compras em andamento", String(data.summary.active_count)],
              ["Total restante", formatCurrency(data.summary.remaining_amount)],
              ["A pagar neste mês", formatCurrency(data.summary.current_month_amount)],
              ["Valor vencido", formatCurrency(data.summary.overdue_amount)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg sm:text-2xl font-semibold mt-1 break-words">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Os totais e a projeção consideram o cartão e a busca selecionados. A situação filtra a
            lista de compras.
          </p>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarClock className="h-5 w-5" />
                Compromissos nos próximos 12 meses
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {data.forecast.map((f) => (
                <div key={f.month} className="rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    {formatDateOnlyPtBR(f.month, { month: "short", year: "numeric" })}
                  </p>
                  <p className="text-sm font-semibold mt-1">{formatCurrency(f.amount)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="space-y-3" aria-busy={isFetching}>
            {data.rows.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  Nenhuma compra parcelada encontrada para estes filtros.
                </CardContent>
              </Card>
            )}
            {data.rows.map((purchase) => (
              <Card key={purchase.id}>
                <CardContent className="p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold break-words">
                        {purchase.description || "Compra parcelada"}
                      </h2>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <CreditCard className="h-3 w-3" />
                        {purchase.card_name} · {purchase.category_name || "Sem categoria"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Compra em {formatDateOnlyPtBR(purchase.occurred_at)}
                      </p>
                    </div>
                    <Badge variant="outline" className="h-fit">
                      {purchase.remaining_amount === 0
                        ? "Quitada"
                        : purchase.overdue_count > 0
                          ? "Com vencidas"
                          : "Em andamento"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Valor total</p>
                      {formatCurrency(purchase.amount)}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pago</p>
                      {formatCurrency(purchase.paid_amount)}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Restante</p>
                      {formatCurrency(purchase.remaining_amount)}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Progresso</p>
                      {purchase.paid_count} de {purchase.installment_count} pagas
                    </div>
                  </div>
                  <progress
                    aria-label={`Parcelas pagas de ${purchase.description || "compra"}`}
                    value={purchase.paid_count}
                    max={purchase.installment_count}
                    className="w-full h-2 accent-primary"
                  />
                  <p className="text-xs text-muted-foreground">
                    {purchase.next_due_date
                      ? `Próximo vencimento: ${formatDateOnlyPtBR(purchase.next_due_date)}. `
                      : "Todas as parcelas foram pagas. "}
                    Última parcela: {formatDateOnlyPtBR(purchase.last_due_date)}.
                  </p>
                  <details>
                    <summary className="cursor-pointer text-sm text-primary py-2">
                      Ver todas as parcelas
                    </summary>
                    <ul className="divide-y divide-border">
                      {purchase.installments.map((i) => (
                        <li
                          key={i.number}
                          className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                        >
                          <div>
                            <p>
                              {i.number}/{purchase.installment_count} ·{" "}
                              {formatDateOnlyPtBR(i.due_date)}
                            </p>
                            {i.payment_date && (
                              <p className="text-xs text-muted-foreground">
                                Paga em {formatDateOnlyPtBR(i.payment_date)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span>{formatCurrency(i.amount)}</span>
                            <Badge variant="outline">{statusNames[i.status]}</Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Button asChild variant="outline" className="mt-2">
                      <Link to="/cards">Abrir faturas do cartão</Link>
                    </Button>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {data.count} compras · Página {page + 1}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page === 0 || isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * 20 >= data.count || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
      <TransactionDialog open={open} onOpenChange={setOpen} installmentMode />
    </div>
  );
}
