import { auth, defineMcp } from "@lovable.dev/mcp-js";

import listAccounts from "./tools/list-accounts";
import listTransactions from "./tools/list-transactions";
import createTransaction from "./tools/create-transaction";
import listRecharges from "./tools/list-recharges";
import listCreditCards from "./tools/list-credit-cards";
import listUpcomingBills from "./tools/list-upcoming-bills";
import financialSummary from "./tools/financial-summary";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "furushima-financeiro-mcp",
  title: "Furushima Financeiro",
  version: "0.1.0",
  instructions:
    "Ferramentas para o dashboard financeiro pessoal Furushima Financeiro. Cada chamada age como o usuário autenticado e respeita RLS. Use para consultar contas, transações, recargas previstas, cartões de crédito, faturas e resumo financeiro do mês, e para registrar novas transações.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listAccounts,
    listTransactions,
    createTransaction,
    listRecharges,
    listCreditCards,
    listUpcomingBills,
    financialSummary,
  ],
});
