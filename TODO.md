# TODO & Ideias Futuras
Este documento serve como um mapa de funcionalidades e melhorias mapeadas para o **App Contas**. 

## 🔒 Segurança e Acesso
- [ ] **Adicionar Autenticação:** Criar sistema de login com usuário e senha para proteger o acesso remoto (especialmente agora que pode ser acessado em rede local). O backend (FastAPI) precisará gerenciar JWT tokens e o Frontend mostrar um modal ou tela de login.

## 💾 Banco de Dados & Estrutura
- [ ] **Ajustar mapeamento do Banco de Dados no Docker:** Atualmente, o `docker-compose.yml` utiliza um "Named Volume" do docker (`pgdata`). O ideal é alterar para um "Bind Mount" (mapear uma pasta física local como `./data`) para que fique mais fácil e transparente fazer o backup dos arquivos físicos do banco de dados direto na pasta do seu projeto.
- [ ] **Criar Ferramenta de Backup (Manual e Automatizado):** Implementar funcionalidade (via interface ou script em background) para gerar dumps diários ou baixar um arquivo `.sql`/`.bak` do estado atual do PostgreSQL.

## 📊 Novas Funcionalidades (Features)
- [ ] **Módulo de Controle de Investimentos (Grande Atualização):** Criar ecossistema paralelo ao das contas correntes. Deve conter tabelas próprias no banco de dados para rastrear aplicações, rendimentos, resgates, rentabilidade e ter um Dashboard exclusivo. 
- [ ] **Exportação para CSV / Excel:** Criar botão no Frontend (e endpoint no Backend) permitindo baixar as tabelas mensais (com todas transações filtradas do mês atual) em formato `.csv` para conferência externa.
