# PATCH 2026-09-04 — Auditoria integral e hardening do projeto

## Escopo e fontes verificadas

Esta revisão parte do checkpoint da Issue #1 e compara o commit `d4e5128b3a3196c38a4bf8a2030861340fd18af3`, confirmado como `main` no GitHub e no Lovable, com o código, as migrations e o banco atual. A Visão Geral foi preservada. As áreas removidas na etapa anterior — Tarefas, Rotinas, Agenda, Hoje, Integrações e Anotações — continuam fora das rotas e da navegação.

Antes desta etapa, o banco de produção possuía a migration de limpeza `20260904163028`, 18 tabelas públicas com RLS habilitado e nenhuma das migrations `20260904190000`, `20260904190100` ou `20260904190200` aplicada. A definição SQL da limpeza correspondia ao arquivo do GitHub. Também foi confirmado que `authenticated` e `service_role` já possuem `USAGE` no schema `private`.

## Estado dos dados antes da aplicação

A validação ao vivo encontrou:

- 0 transações, investimentos, leituras OCR, itens de compra e imagens enviadas;
- 1 registro de papel de usuário e nenhum usuário com papéis duplicados;
- 15 despesas recorrentes, todas mensais, ativas e com pagamento no crédito;
- nenhum registro incompatível com os novos limites de valores, datas, percentuais, estados OCR, limites de cartão ou dias de cobrança.

As 15 despesas recorrentes não possuem cartão porque a coluna ainda não existe em produção. A migration `20260904190200` preserva esses registros e os pausa. O usuário deve escolher o cartão antes de reativá-los. Nenhuma cobrança será associada a um cartão por suposição.

## Falhas encontradas e correções

### Ledger, cartão e fatura

- Compras no cartão agora exigem cartão e entram no ciclo correto de fechamento e vencimento.
- Parcelas distribuem centavos sem perda, reservam o limite total e atualizam fatura e limite após edição ou exclusão.
- Pagamento de fatura exige conta pagadora, é idempotente e pode ser estornado sem duplicar saldo.
- Transferências movimentam duas contas e não aparecem como receita, despesa ou saída de caixa.
- Exclusões de contas, cartões e faturas referenciados usam `RESTRICT`, protegendo o histórico.
- O cron também marca faturas vencidas como atrasadas.

### Recorrências

- `recurring_expenses.credit_card_id` liga uma cobrança recorrente ao cartão correto.
- Recorrências ativas no crédito sem cartão são bloqueadas pelo banco.
- O gerador manual e o cron usam o mesmo ledger das compras e ignoram cobranças de crédito sem cartão.
- A execução automática sem JWT só aceita uma compra que corresponda exatamente a uma recorrência ativa do mesmo usuário, cartão, valor e descrição.
- Vencimentos anuais e mensais respeitam meses curtos.
- A opção sem implementação consistente “Personalizada” foi retirada do formulário. Dados legados com essa frequência continuam legíveis.

### Planejador de compras

- A conclusão de compra usa uma função transacional única.
- Compras parceladas com entrada criam uma saída imediata na conta e financiam apenas o restante no cartão.
- `shopping_items.down_payment_transaction_id` mantém o vínculo auditável da entrada.
- Repetir a conclusão não cria lançamentos duplicados.

### OCR e importação

- O servidor recebe somente o identificador da imagem e busca no banco o caminho pertencente ao usuário; o navegador não escolhe mais um caminho de Storage arbitrário.
- Tamanho, assinatura e tipo da imagem são verificados no servidor. Há timeout, limites de texto e quantidade de linhas.
- Salvar uma leitura OCR e marcar seu estado agora ocorre de forma atômica e idempotente.
- Compras OCR no crédito exigem cartão.
- A importação CSV valida datas reais, interpreta separadores brasileiros e internacionais, limita arquivo a 5 MB e 5.000 linhas e exige a coluna `Cartão` para crédito.

### Investimentos

- A edição do investimento e a gravação do evento de histórico ocorrem na mesma transação do banco.
- Valores negativos e vencimento anterior à aplicação são bloqueados no banco.

### Acesso compartilhado

- O administrador passa a enviar um convite; a conta convidada precisa aceitar antes de se tornar espectadora.
- Convites expiram em sete dias e podem ser recusados ou revogados.
- O espectador pode sair do espaço compartilhado e recuperar o próprio espaço administrativo.
- Um índice exclusivo impede mais de um papel simultâneo por usuário.
- RLS permite somente leitura aos participantes dos convites; alterações passam pelas funções controladas.

### Segurança e robustez

- Uploads aceitam somente JPEG, PNG ou WebP, com limite de 10 MB no bucket privado configurado pela API de Storage; as políticas SQL restringem o acesso a `authenticated` e à pasta do próprio usuário.
- O schema `public` não permite criação de objetos por `PUBLIC`, `anon` ou `authenticated`.
- Funções internas e financeiras perderam execução pública ou anônima; somente as funções necessárias permanecem disponíveis ao usuário autenticado.
- Respostas HTTP recebem `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`.
- O redirecionamento OAuth aceita apenas esquemas seguros e destinos permitidos.
- O login não navega durante a renderização e informa corretamente quando o cadastro depende de confirmação por e-mail.
- Erros técnicos de integridade, permissão e vínculo aparecem como mensagens compreensíveis.
- A ferramenta MCP de criar transação valida datas, transferências, cartões e parcelas e devolve somente os campos necessários.
- Dependências vulneráveis transitivas foram substituídas por versões corrigidas via `overrides` e lockfile.

## Alterações de banco

### `20260904190000_harden_financial_ledger.sql`

Cria e protege o ledger de parcelas `credit_card_bill_items`, adiciona `transactions.installment_count`, separa saldo anterior em `credit_card_bills.manual_amount`, corrige os triggers de cartão, pagamentos, ownership, FKs e o fluxo do Planejador.

### `20260904190100_fix_financial_cash_series.sql`

Corrige o saldo inicial e a série de caixa para excluir transferências e compras no cartão, incluindo o pagamento da fatura apenas quando há saída real da conta.

### `20260904190200_full_project_hardening.sql`

Adiciona:

- constraints de valores, datas, percentuais, estados e parcelas;
- `recurring_expenses.credit_card_id`, FK `RESTRICT` e índice parcial;
- `shopping_items.down_payment_transaction_id`, FK `SET NULL` e índice parcial;
- funções atualizadas de recorrência e manutenção diária;
- conclusão transacional de compra com entrada;
- edição transacional de investimento;
- salvamento OCR atômico;
- tabela `viewer_invitations`, dois índices, RLS e policy de leitura;
- funções de convidar, aceitar, recusar, revogar, listar e sair do acesso compartilhado;
- índice único `user_roles_one_role_per_user` e validação da relação admin/viewer;
- políticas de Storage e redução de privilégios de schema e funções.

O limite de 10 MB e os MIME types do bucket `transaction-prints` são aplicados pela API de Storage do Lovable/Supabase. O ajuste não fica na migration porque o executor de migrations do Lovable bloqueia alterações diretas em `storage.buckets`. As políticas sobre `storage.objects` permanecem versionadas nesta migration.

## Arquivos de aplicação afetados

Os formulários de contas, cartões, transações, recorrências, Planejador, investimentos, recargas, metas, orçamentos, configurações, OCR e CSV foram alinhados às regras do banco. Os tipos Supabase e as consultas foram atualizados para os novos campos e RPCs. A configuração do Vite mantém o gerador MCP no Linux do Lovable e evita uma incompatibilidade de normalização de caminhos no Windows; as rotas MCP geradas continuam presentes.

## Validação local

- TypeScript (`tsc --noEmit`): aprovado.
- 19 testes integrados em PostgreSQL isolado: aprovados.
- ESLint de lógica: 0 erros; 6 avisos preexistentes de Fast Refresh em componentes visuais gerados.
- Build de produção completo: aprovado para cliente, SSR, Nitro e Cloudflare.
- Auditoria Bun: 0 vulnerabilidades em 637 pacotes.
- `git diff --check`: aprovado.

A execução integral do ESLint no checkout Windows também aplica a regra Prettier a arquivos antigos com CRLF e produz milhares de diferenças de fim de linha. Esses arquivos não foram reformatados em massa para evitar um patch sem mudança funcional. A análise com a regra de formatação desativada confirmou 0 erros de lógica. Uma tentativa adicional com Knip não pôde ser usada porque a própria ferramenta falhou ao resolver a API do TypeScript; os imports e usos foram revisados pelas ferramentas que concluíram com sucesso.

## Aplicação e verificação pós-migration

As migrations devem ser aplicadas na ordem `190000`, `190100`, `190200`. Depois da aplicação, verificar:

1. histórico de migrations contendo as três versões;
2. existência dos dois novos campos, da tabela de convites, dos índices e das constraints;
3. RLS ativo e policies esperadas;
4. privilégios das funções sem execução por `anon`;
5. bucket com limite e MIME definidos;
6. 15 recorrências antigas preservadas e pausadas;
7. nenhuma transação ou fatura criada pela migration.

Se o ambiente de produção divergir dos dados auditados, a guarda da migration financeira interrompe a aplicação antes de converter histórico por suposição.

## Rollback

Migrations aplicadas não devem ser editadas. Qualquer rollback deve ser incremental: preservar/exportar itens de fatura e convites, restaurar funções e privilégios anteriores, remover índices/FKs/constraints na ordem de dependência e, por último, remover colunas ou tabelas novas. O código deve continuar compatível com o banco durante toda a reversão.
