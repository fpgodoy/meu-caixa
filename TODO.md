# TODO & Ideias Futuras
Este documento serve como um mapa de funcionalidades e melhorias mapeadas para o **App Contas**. 

## 🔒 Segurança e Acesso
- [ ] **Adicionar Autenticação:** Criar sistema de login com usuário e senha para proteger o acesso remoto (especialmente agora que pode ser acessado em rede local). O backend (FastAPI) precisará gerenciar JWT tokens e o Frontend mostrar um modal ou tela de login.

## 💾 Banco de Dados & Estrutura
- [x] **Ajustar mapeamento do Banco de Dados no Docker:** Bind mount `./data` configurado. Dados físicos visíveis na pasta do projeto.
- [x] **Criar Ferramenta de Backup (Manual e Automatizado):** Backup automático diário via cron (container `backup`) + página de Configurações com botão para disparo manual. Dumps salvos em `./backups/`, mantendo os 7 mais recentes.

## 📊 Novas Funcionalidades (Features)
- [ ] **Módulo de Controle de Investimentos (Grande Atualização):** Criar ecossistema paralelo ao das contas correntes. Deve conter tabelas próprias no banco de dados para rastrear aplicações, rendimentos, resgates, rentabilidade e ter um Dashboard exclusivo. 
- [ ] **Exportação para CSV / Excel:** Criar botão no Frontend (e endpoint no Backend) permitindo baixar as tabelas mensais (com todas transações filtradas do mês atual) em formato `.csv` para conferência externa.
