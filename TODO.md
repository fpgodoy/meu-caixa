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
- [ ] **Busca por Discriminação** — Campo de texto para pesquisar e filtrar transações cadastradas pelo nome/descrição.
- [x] **Layout Mobile Friendly** — Adaptar interface para ficar 100% responsiva e de fácil leitura na tela de celulares.
  - Quebrar "Painel Resumo" em formato de grade (2x2) ou lista (1x4) via media query.
  - Transformar as linhas da tabela de lançamentos em formato de "Data Cards" em telas estreitas (ocultar colunas tradicionais e empilhar a informação).
  - Ajustar grades e preenchimentos em Modais e Popovers para que obedeçam a tela sem vazar do viewport.

- [ ] **Integração Home Assistant (Webhook / Alertas)** — Criar endpoint para que o Home Assistant capture automaticamente transações marcadas como "pendentes" (PEN) que possuam o prazo de vencimento para o "dia atual". Objetivo: Home Assistant despachar uma notificação PUSH/Alerta aos moradores ("A conta de Luz vence hoje e ainda não foi paga!").
- [ ] **Extração Automática de Faturas (Água/Energia)** — Construir ferramenta para raspar/consultar diretamente os sites (ou APIs) de concessionárias, extraindo automaticamente os valores mensais e as respectivas datas de vencimento com base na Unidade Consumidora.
  - Criar um painel de configuração para informar a URL da requisição, payload necessário e Códigos de Usuário.
  - Priorizar simular/replicar a *própria requisição HTTP* que os portais originais costumam disparar pelo navegador, invés de UI scrapping complexo (ou o uso de uma API pública local caso exista).
