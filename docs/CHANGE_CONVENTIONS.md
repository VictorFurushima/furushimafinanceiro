# Convenções de Mudança — Furushima Financeiro

## Migrations

- **Migrations já aplicadas nunca são editadas.** Correção = nova migration
  incremental.
- **Uma migration por intenção.** Não misturar automação, índices e RPCs no
  mesmo arquivo sem relação lógica.
- **Nome descritivo**: `timestamp + ação`, por exemplo
  `20260807_add_financial_daily_maintenance_cron.sql`. UUID nunca é a única
  descrição quando há controle manual do nome.
- **Cabeçalho SQL obrigatório**:

```sql
-- Objetivo: <o que muda e por quê>
-- Tabelas afetadas: <lista>
-- Impacto de dados: <nenhum | backfill | idempotente>
-- RLS: <inalterada | policies criadas/alteradas>
-- Índices/FKs: <novos ou nenhum>
-- Rollback: <comando sugerido>
```

- Toda `CREATE TABLE` em `public` inclui `GRANT` na mesma migration.

## Commits

Padrão **Conventional Commits**, em português, escopo curto:

- `perf(db): otimiza rls e indices financeiros`
- `perf(data): move agregacoes para postgres`
- `fix(db): corrige fk de recorrencias`
- `feat(investments): adiciona simulador de aportes`
- `perf(app): finaliza automacao e economia de dados`

Regras:

- Um commit tem **uma intenção principal**.
- Migrations e os tipos Supabase gerados podem ficar no **mesmo commit**.
- **Evitar misturar CSS/UI com migration de banco** no mesmo commit.

## Diff

- Diff pequeno, revisável, sem reformatação gratuita de arquivos.
- A descrição do commit/PR explica **motivo, impacto e rollback** sempre que
  houver mudança de banco.
- Mudança de dados em produção nunca é feita por migration silenciosa: descrever
  explicitamente o impacto.

## Frontend

- Sem `select('*')` em listagens; colunas explícitas.
- Sem agregação de datasets completos no browser — usar RPC.
- Sem automação de negócio disparada por `useEffect`/`localStorage` — usar
  `pg_cron`.
- Cache sempre por `financeKeys` + `invalidateFinance`.
