# TODO — Meu Caixa

Mapa de funcionalidades e melhorias planejadas para o **Meu Caixa**.

## ✅ Concluído

- [x] **Autenticação JWT** — Login com usuário/senha, troca obrigatória no primeiro acesso, múltiplos usuários
- [x] **Backup automatizado** — Dump diário via APScheduler (02:00 UTC) + backup manual pela interface + restauração de backups pela interface
- [x] **Registros Recorrentes com período** — Criação e edição com controle de intervalo (início/fim); coluna "Gerado até" na listagem
- [x] **Cores por tipo no dashboard** — Entradas e saídas com cores distintas nas colunas Previsto e Efetivo
- [x] **Bind mount de dados** — `./data` e `./backups` mapeados como volumes no Docker Compose

## 📊 Novas Funcionalidades

- [ ] **Painel de Investimentos** — Controle simplificado do valor total investido no ano e metas anuais de investimento. Sem cadastro de cada produto; foco em visão consolidada (quanto investiu vs. quanto planejou investir no ano).
- [ ] **Exportação CSV** — Botão para baixar as transações do mês atual em `.csv` para conferência externa.
