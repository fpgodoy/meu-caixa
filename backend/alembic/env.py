import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Garante que o diretório do backend está no path para importar models e database
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# -- Importa o Base dos models para que o Alembic conheça todas as tabelas --
from database import Base  # noqa: E402
import models  # noqa: E402, F401  (importar models popula o Base.metadata)

# Objeto de configuração do Alembic — dá acesso a valores em alembic.ini
config = context.config

# Sobrescreve a URL com a variável de ambiente (ignora o valor em alembic.ini)
database_url = os.environ.get(
    "DATABASE_URL",
    "postgresql://contas:contas123@localhost:5432/appcontas",
)
config.set_main_option("sqlalchemy.url", database_url)

# Configura o logging com base nas definições do alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadados dos models: permite autogenerate de migrations
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Executa migrations em modo 'offline' (sem conexão ativa)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Executa migrations em modo 'online' (com conexão ativa)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
