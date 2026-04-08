# TODO — Meu Caixa

Mapa de funcionalidades e melhorias planejadas para o **Meu Caixa**.

## ✅ Concluído

- [x] **Autenticação JWT** — Login com usuário/senha, troca obrigatória no primeiro acesso, múltiplos usuários
- [x] **Backup automatizado** — Dump diário via APScheduler (02:00 UTC) + backup manual pela interface + restauração de backups pela interface
- [x] **Registros Recorrentes com período** — Criação e edição com controle de intervalo (início/fim); coluna "Gerado até" na listagem
- [x] **Cores por tipo no dashboard** — Entradas e saídas com cores distintas nas colunas Previsto e Efetivo
- [x] **Bind mount de dados** — `./data` e `./backups` mapeados como volumes no Docker Compose
- [x] **Layout Mobile Friendly** — Interface 100% responsiva com Data Cards em telas pequenas; modais e popovers adaptados ao viewport
- [x] **Totalizadores inteligentes** — Entradas, saídas e "A Pagar" com prioridade efetivo → previsto; filtro de pendentes no total a pagar
- [x] **Sanitização XSS** — `escHtml()` global aplicada em todos os campos de texto livre injetados via `innerHTML`
- [x] **Validação de inputs no backend** — Formato `AAAA-MM` via Pydantic e nos parâmetros de query; intervalo de `dia_vencimento` (1–28) e `mes_anual` (1–12) com `Field(ge, le)`
- [x] **Robustez no frontend** — Race condition em `loadTransactions` corrigida com contador de sequência; navegação de mês imutável com `new Date()`

## 📊 Novas Funcionalidades

- [ ] **Painel de Investimentos** — Controle simplificado do valor total investido no ano e metas anuais de investimento. Sem cadastro de cada produto; foco em visão consolidada (quanto investiu vs. quanto planejou investir no ano).
- [ ] **Exportação CSV** — Botão para baixar as transações do mês atual em `.csv` para conferência externa.
- [ ] **Busca por Discriminação** — Campo de texto para pesquisar e filtrar transações cadastradas pelo nome/descrição.
- [ ] **Integração Home Assistant (Webhook / Alertas)** — Criar endpoint para que o Home Assistant capture automaticamente transações marcadas como "pendentes" (PEN) que possuam o prazo de vencimento para o "dia atual". Objetivo: Home Assistant despachar uma notificação PUSH/Alerta aos moradores ("A conta de Luz vence hoje e ainda não foi paga!").
- [ ] **Extração Automática de Faturas (Água/Energia)** — Construir ferramenta para raspar/consultar diretamente os sites (ou APIs) de concessionárias, extraindo automaticamente os valores mensais e as respectivas datas de vencimento com base na Unidade Consumidora.
  - Criar um painel de configuração para informar a URL da requisição, payload necessário e Códigos de Usuário.
  - Priorizar simular/replicar a *própria requisição HTTP* que os portais originais costumam disparar pelo navegador, invés de UI scrapping complexo (ou o uso de uma API pública local caso exista).
