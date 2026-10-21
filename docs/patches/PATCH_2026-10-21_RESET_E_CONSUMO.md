# Patch de 21/10/2026: reset dos dados e redução de consumo

Data: 21/10/2026. Base: `c9b0573` (main, mesmo commit do Lovable).
Branch: `claude/furushima-audit-completo-a40zdy`, recriada a partir da `main` depois do merge do PR #8.
Projeto: VictorFurushima/furushimafinanceiro, Lovable ec051308-bc31-4b3a-854d-14e500a89183.

## Resumo

1. **Reset dos dados (produção, pedido do titular):** todos os dados financeiros foram apagados. Ficaram
   só o login, o perfil e o papel de administrador. A conta voltou ao estado de um cadastro novo.
2. **Consumo:** o Lovable mediu 14 dias (08 a 21/10). 95,4% dos créditos vêm do banco ligado 24 horas
   por dia no menor tier (`pico`, 26,09 créditos de compute e 3,46 de storage). Este patch reduz as
   requisições do front e o tamanho das imagens enviadas à IA. A maior economia, porém, depende de
   pausar o banco, e isso é uma configuração da plataforma, não de código.

## 1. Reset dos dados (executado em 21/10 pelo conector)

Havia 1 usuário cadastrado, o titular, e nenhum espectador ou convite. Uma única transação fez
tudo: cópia de segurança, limpeza e recriação dos padrões. Se qualquer passo falhasse, nada seria
apagado.

| Tabela                                              |    Antes | Depois                                                                                                             |
| --------------------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------ |
| `transactions`                                      |       93 | 0                                                                                                                  |
| `credit_card_bill_items` / `credit_card_bills`      |   91 / 6 | 0 / 0                                                                                                              |
| `credit_cards`                                      |        1 | 0                                                                                                                  |
| `recurring_expenses`                                |       14 | 0                                                                                                                  |
| `balance_recharges`                                 |        2 | 0                                                                                                                  |
| `shopping_items`                                    |        1 | 0                                                                                                                  |
| `uploaded_transaction_images`                       |       25 | 0                                                                                                                  |
| `ocr_detected_transactions` / `ocr_import_receipts` | 117 / 72 | 0 / 0                                                                                                              |
| `user_settings`                                     |        1 | 0 (o app recria ao salvar preferências)                                                                            |
| `categories`                                        |       11 | 9 padrões do cadastro (Salário, Freelance, Investimentos, Alimentação, Moradia, Transporte, Lazer, Saúde, Compras) |
| `accounts`                                          |        2 | 1 ("Conta Principal", corrente)                                                                                    |
| `profiles`                                          |        1 | 1 (nome e e-mail mantidos; cartão principal e aviso zerados)                                                       |
| `user_roles`                                        |        1 | 1 (admin)                                                                                                          |
| `auth.users`                                        |        1 | 1 (login intacto)                                                                                                  |

Também foram limpas, já vazias: orçamentos, limites por categoria, metas, investimentos (posições,
eventos, acompanhamento, histórico de avaliação e credenciais), convites e o Histórico de ações. O
storage de prints não tinha arquivos. Ficaram intactos o cron (manutenção diária e cotações), as
cotações de mercado, que não pertencem a nenhum usuário, e o registro de migrations.

Detalhes técnicos:

- `TRUNCATE` não dispara os gatilhos de linha: nem a trava de compra com fatura paga nem a captura
  do Histórico. `credit_cards` foi apagada com `DELETE`, porque `profiles` aponta para ela. A captura
  ignora operações sem usuário logado, e o Histórico terminou com 0 registros.
- Categorias e conta padrão foram recriadas com os mesmos valores de `public.handle_new_user()`.

### Cópia de segurança

Schema `backup_reset_20261021`, acessível só pelo papel `postgres` (fora da API do site), com as 14
tabelas que tinham dados. As contagens são iguais às da coluna "Antes". Apagar quando não for mais
necessária:

```sql
DROP SCHEMA backup_reset_20261021 CASCADE;
```

Restaurar (só se o reset precisar ser desfeito): limpar de novo as tabelas e copiar de volta de
`backup_reset_20261021.<tabela>` na ordem das FKs (contas, categorias, cartões, faturas, recorrências,
transações, itens de fatura, prints, itens de OCR, recibos, compras, preferências) e, por fim,
restaurar `profiles.primary_card_id`.

## 2. Redução de consumo

Medição do Lovable (08 a 21/10):

| Item                    | Créditos | Ação neste patch                                                  |
| ----------------------- | -------: | ----------------------------------------------------------------- |
| Compute do banco (pico) |    26,09 | Não muda por código: cobrança por hora ligada (~1,86 crédito/dia) |
| Storage do banco        |     3,46 | Não muda por código: cobrança pelo espaço alocado                 |
| Build Mode              |     0,90 | —                                                                 |
| Funções                 |     0,28 | —                                                                 |
| IA do OCR               |     0,24 | Imagens grandes reduzidas no navegador; releitura com confirmação |
| Rede e arquivos         |   0,0026 | Menos requisições repetidas e imagens menores                     |

### Front: cache e polling

- `useCategories` e `useAccounts` passam a ficar 10 minutos em cache (`CATALOG_STALE_TIME`), contra
  60 segundos antes. Criar, excluir ou desfazer uma categoria ou conta já invalida essas listas na
  hora. Para o titular nada fica desatualizado. O espectador vê mudanças do titular em até 10 minutos,
  ou na hora se recarregar a página.
- Investimentos e Carteira Global consultavam o banco a cada 2 minutos com a tela aberta. As cotações
  só mudam a cada 30 minutos (cron `investment-quotes-30min`). Agora consultam a cada 10 minutos
  (`MARKET_REFRESH_INTERVAL`). Lançamentos feitos no app continuam atualizando essas telas na hora.
- `refetchOnWindowFocus` já estava desligado globalmente (`src/router.tsx`).

### OCR por print

- **Redução no navegador** (`src/lib/image-resize.ts`): a IA cobra a imagem por blocos. A regra limita
  o lado menor a 1600 px e o total a 6 MP, e só age quando reduz mais de 10% e o arquivo fica menor.
  O formato é mantido.
  - Prints de celular (1170×2532, 1080×2400), de tela de computador (1920×1080) e prints longos
    seguem intactos. Um print rolado de 1170×8000 mantém a largura legível.
  - Fotos de câmera de 4032×3024 caem para 2133×1600. No Chromium, uma foto JPEG foi de 1.724 KB
    para 751 KB.
- O hash gravado passa a ser o do arquivo enviado, que o servidor confere antes de ler. A busca de
  print repetido considera o hash do original e o da versão reduzida.
- **Reprocessamento:** reenviar o mesmo print já abria a revisão existente sem chamar a IA, e um
  print já lido não é relido sem pedido. O botão "Reler" agora pede confirmação, porque chama a IA de
  novo e devolve itens não salvos ao resultado da nova leitura.

### Fora do alcance do código

- **Pausar o banco** é a economia que pesa: cerca de 1,86 crédito por dia parado, quase todo o
  consumo. É feito no painel do Lovable, área Cloud do projeto, se o plano oferecer. Com o banco
  pausado, login e telas ficam indisponíveis e o cron não roda. Depois de uma pausa longa, confira
  assinaturas e recargas recorrentes, porque um mês inteiro parado não gera as ocorrências daquele
  mês.
- **Tokens de saída da IA:** o Gemini 2.5 Flash usa raciocínio interno, cobrado como saída. Desligar
  depende de um parâmetro do gateway do Lovable. O gateway não é acessível deste ambiente para
  validar, então nada foi alterado. Mudar às cegas poderia quebrar a leitura de prints.

## Testes

- `test:finance` 19, `test:import-installments` 30 (novo teste da regra de redução), `test:history` 27,
  `test:investments` 22, `test:recurrence` 10, `test:viewers` 5: todos passaram.
- `tsc --noEmit`, ESLint e Prettier nos arquivos alterados passaram.
- Teste ponta a ponta do site inteiro (`npm run test:e2e`): 42/42, sem erros de console ou de API,
  incluindo os 8 cenários do import por print.
- Redução de imagem conferida em Chromium com JPEG, PNG e WebP.

## Rollback

1. Front: reverter o commit `perf(app)` desta branch.
2. Dados: seção "Cópia de segurança" acima.
