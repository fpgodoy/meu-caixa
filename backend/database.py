"""
database.py — Configuração da conexão com o banco de dados PostgreSQL.

Expõe:
  - engine: conexão SQLAlchemy usada pelo Alembic e pelo prestart.py
  - SessionLocal: fábrica de sessões para as rotas FastAPI
  - Base: classe base dos models ORM (importada em models.py)
  - get_db: dependência FastAPI que abre e fecha sessões automaticamente
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Lê a URL do banco de variável de ambiente.
# O valor padrão é usado apenas em desenvolvimento local.
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://contas:contas123@localhost:5432/appcontas",
)

# Cria o engine principal — reutilizado em toda a aplicação.
#
# Configuração do pool sincronizada com max_connections=10 do PostgreSQL
# (definido no docker-compose.yml). pool_size + max_overflow <= max_connections
# para evitar o erro "FATAL: sorry, too many clients".
# pool_recycle fecha e reabre conexões dormentes após 30 min, prevenindo
# erros de "connection closed" em sessões longas.
engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=2,
    pool_timeout=30,
    pool_recycle=1800,
)

# Fábrica de sessões: autocommit e autoflush desligados para controle explícito.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base ORM: todos os models herdam desta classe para serem mapeados como tabelas.
Base = declarative_base()


def get_db():
    """
    Dependência FastAPI que fornece uma sessão de banco de dados por requisição.

    Usa o padrão 'yield' para garantir que a sessão seja sempre fechada,
    mesmo que ocorra uma exceção durante o processamento da requisição.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
