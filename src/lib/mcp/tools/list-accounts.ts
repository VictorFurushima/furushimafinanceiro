import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, jsonResult, requireAuth, supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "list_accounts",
  title: "Listar contas",
  description: "Lista todas as contas (banco, carteira, etc.) do usuário com saldos atuais.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const authErr = requireAuth(ctx);
    if (authErr) return authErr;
    const { data, error } = await supabaseForUser(ctx).rpc("get_account_balances");
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);

  },
});
