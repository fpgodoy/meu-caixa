# 💰 App Contas (Web Finance Tracker)

Um sistema completo de controle de orçamento e finanças pessoais projetado para organização de receitas e despesas mensais, automatização de contas e uma experiência de usuário visualmente moderna e ágil.

![app-contas](https://img.shields.io/badge/Status-Ativo-success)

## 🚀 Funcionalidades Principais
- 📅 **Controle Mensal Descomplicado:** Controle facilmente as entradas bancárias do mês, contas a pagar e saídas efetivadas.
- 🔁 **Automação de Recorrentes:** Crie e gerencie contas e fontes de renda (Mensais, Semestrais ou Anuais). Defina registros infinitos com facilidade e os edite de forma não-destrutiva (gerando histórico futuro).
- 🔗 **Vínculo Flexível de Pagamentos:** Marque contas para serem lançadas no mês seguinte mantendo a data original. Ideal para salários que caem perto da virada do mês, mas fecham orçamentos do mês adiantado!
- ⚡ **Lançamentos em Lote:** Precise faturar o estacionamento de vários dias? Selecione rapidamente vários dias num calendário visual e crie todos simultaneamente.
- 🎯 **Ordenação Inteligente de Receitas:** O Dashboard detecta o fluxo das suas contas e pode ordenar cronologicamente, exibindo de forma clara **Receitas Primeiro**, ajudando a visualizar se a conta vai fechar!
- 🧮 **Saldo Rotativo ("Rolagem" Mensal):** Ao virar o mês, veja um rastro contínuo gerado automaticamente entre o "Saldo do Mês Passado" e a previsão para o "Mês Que Vem".

## 🛠️ Tecnologias Utilizadas
O App Contas foi construído focando em uma arquitetura leve, conteinerizada e fullstack clássica sem overhead:

- **Frontend:** Vanilla JavaScript, HTML5, CSS3 Custom Properties (Design Responsivo e Dark Theme nativo)
- **Backend API:** Python com FastAPI (Rápido, tipado e com validações Pydantic)
- **Banco de Dados:** PostgreSQL 16 com engine SQLAlchemy (ORM)
- **Infraestrutura:** Docker e Docker Compose (Nginx para servir os arquivos e rede interna)

## 💻 Como rodar o projeto localmente (Self-hosted)

Pré-requisitos: Ter o [Docker](https://docs.docker.com/get-docker/) e o [Docker Compose](https://docs.docker.com/compose/install/) instalados.

1. Clone o repositório na sua máquina:
   ```bash
   git clone https://github.com/SEU_USUARIO/app-contas.git
   cd app-contas
   ```

2. Suba o ambiente via Docker Compose (este comando criará o PGBanco de dados, instalará o Python, levantará a API no FastAPI e servirá o Frontend no Nginx):
   ```bash
   docker-compose up --build -d
   ```

3. Pronto! Acesse o sistema através do seu navegador em:
   **http://localhost:3000** 
   *(Ou usando o IP local da sua máquina em outros dispositivos da rede, ex: http://192.168.0.x:3000)*

---

## 🗺️ Roadmap Atual
Confira o arquivo [`TODO.md`](TODO.md) incluído na base para verificar os próximos updates mapeados para a ferramenta (Autenticação, Extrator JSON, Painel de Investimentos e Bind Mounts de Backup)! 

Feito com dedicação para uma vida financeira mais tranquila! 📈
