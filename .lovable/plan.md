# Reforma visual Furushima Financeiro

## Objetivo
Modernizar exclusivamente a apresentação do produto atual, preservando integralmente dados, regras, fluxos e funcionalidades do PR #7. A direção será uma interface financeira densa e sóbria, com navy profundo e acentos controlados em azul, ciano, teal e verde.

## Implementação
1. **Sistema visual compartilhado**
   - Revisar tokens globais de superfícies, bordas, textos, marca, estados, raios e sombras.
   - Substituir gradientes e glows recorrentes por superfícies planas, bordas finas e acentos Furushima discretos.
   - Refinar botões, cards, tabelas, campos, seletores, diálogos, badges e barras de progresso para propagar a linguagem por todo o produto.
   - Criar uma assinatura abstrata de loop em CSS, de baixa opacidade, restrita ao shell e login.

2. **Shell e navegação**
   - Compactar e organizar a sidebar em quatro grupos visuais sem remover ou esconder rotas.
   - Tratar o logo como marca, com “FURUSHIMA” e “FINANCEIRO” em hierarquia discreta.
   - Usar fundo e faixa lateral sutis no item ativo, sem gradiente ou glow.
   - Refinar a navegação móvel e o menu completo, mantendo todas as funções e safe areas.

3. **Telas prioritárias**
   - Visão Geral: tornar patrimônio o dado dominante e organizar os demais indicadores, gráficos e listas com hierarquia financeira mais clara.
   - Carteira Global e Investimentos: diferenciar capital disponível e investido, com dados de mercado compactos e precisos, sem tocar nos cálculos do PR #7.
   - Contas e Cartões: remover efeitos decorativos excessivos e reforçar leitura de saldo, limite, fatura, fechamento e vencimento.
   - Importar por Print: destacar upload, processamento e revisão com um fluxo visual compacto, preservando OCR e seleção automática de cartão.
   - Transações: melhorar densidade de filtros e histórico sem mudar paginação, exportação ou operações.
   - Login: aplicar a marca e o loop abstrato com formulário direto, removendo textos promocionais inventados.

4. **Coerência geral**
   - Ajustar apenas classes visuais locais necessárias nas demais páginas para que os componentes compartilhados não deixem resíduos de glow ou gradientes fortes.
   - Não alterar migrations, banco, autenticação, queries, RPCs, cálculos ou regras de negócio.

## Validação
- Verificar visualmente desktop (1280 px) e celular (390 px), incluindo navegação, telas prioritárias e ausência de overflow.
- Rodar TypeScript, lint relevante e build Linux.
- Corrigir somente regressões da reforma e bloqueadores de integração existentes no código sincronizado.
- Não publicar; entregar a atualização apenas no preview para revisão.

## Observação técnica
O estado inicial já apresenta erros TypeScript em dois diálogos de investimentos por valores anuláveis. Eles serão tratados apenas se bloquearem a validação final, sem alterar comportamento ou regras financeiras.
