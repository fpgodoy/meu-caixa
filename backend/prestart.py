"""
prestart.py — Inicialização inteligente do banco de dados.

Executado pelo start.sh antes de iniciar o uvicorn.

Detecta automaticamente o estado do banco e age de forma apropriada:

  Caso 1 — Banco zerado / nova instalação:
    → Tabela 'users' não existe
    → Roda 'alembic upgrade head' para criar toda a estrutura do zero

  Caso 2 — Banco de produção existente (sem controle Alembic):
    → Tabela 'users' existe, mas 'alembic_version' não existe
    → Roda 'alembic stamp head' para registrar o estado atual como baseline
      sem executar nenhuma migration (o banco já está no estado correto)
    → Em seguida roda 'alembic upgrade head' normalmente (noop neste caso)

  Caso 3 — Banco já gerenciado pelo Alembic:
    → Tabela 'alembic_version' existe
    → Apenas verifica e aplica migrations pendentes com 'alembic upgrade head'

Após as migrations, chama seed_admin para garantir que o usuário
admin inicial exista (não faz nada se já houver usuários).
"""
import os
import subprocess
import sys

from sqlalchemy import create_engine, inspect


def get_engine():
    """Cria um engine SQLAlchemy a partir da DATABASE_URL do ambiente."""
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://contas:contas123@localhost:5432/appcontas",
    )
    return create_engine(database_url)


def table_exists(engine, table_name: str) -> bool:
    """Retorna True se a tabela existir no banco de dados atual."""
    inspector = inspect(engine)
    return table_name in inspector.get_table_names()


def run_alembic(command: list) -> None:
    """
    Executa um subcomando do Alembic como subprocesso.

    Usa check=True para lançar exceção automaticamente se o
    comando falhar (código de saída diferente de zero), o que
    impede o container de subir com o banco em estado inconsistente.
    """
    subprocess.run(["alembic"] + command, check=True)


def main():
    print("🚀 [prestart] Iniciando verificação do banco de dados...")

    engine = get_engine()
    try:
        transactions_exists   = table_exists(engine, "transactions")
        users_exists          = table_exists(engine, "users")
        alembic_version_exists = table_exists(engine, "alembic_version")
    finally:
        # Libera a conexão de inspeção — o Alembic abrirá a sua própria
        engine.dispose()

    if not transactions_exists:
        # ── Caso 1: Banco zerado / nova instalação ────────────────
        print("📦 [prestart] Banco vazio detectado. Criando estrutura via Alembic...")
        run_alembic(["upgrade", "head"])
        print("✅ [prestart] Estrutura criada com sucesso.")

    elif not alembic_version_exists:
        # ── Caso 2: Banco existente sem controle do Alembic ───────
        # Isso ocorre no primeiro deploy após a adição do Alembic ao projeto.
        if not users_exists:
            # A tabela 'users' não foi encontrada no banco legado.
            # Precisamos criá-la pois o banco tem dados mas ainda não tem usuários.
            import models
            print("👤 [prestart] Tabela de 'users' não encontrada em banco legado. Criando...")
            models.Base.metadata.create_all(engine, tables=[models.User.__table__])
            
        # O 'stamp head' registra a migration baseline como já aplicada
        # sem executar o SQL de criação das tabelas (que já existem).
        print("🏷️  [prestart] Banco existente detectado (sem controle Alembic).")
        print("   Registrando estado atual como baseline (stamp)...")
        run_alembic(["stamp", "head"])
        print("✅ [prestart] Stamp aplicado. Verificando migrations pendentes...")
        run_alembic(["upgrade", "head"])

    else:
        # ── Caso 3: Banco já gerenciado pelo Alembic ──────────────
        # Aplica apenas as migrations que ainda não foram executadas.
        # Se não houver migrations novas, o comando termina sem alterar nada.
        print("🔄 [prestart] Banco gerenciado pelo Alembic. Aplicando migrations pendentes...")
        run_alembic(["upgrade", "head"])
        print("✅ [prestart] Migrations verificadas.")

    # ── Seed: garante que o usuário admin inicial existe ──────────
    # É seguro chamar a qualquer momento: o seed verifica se há usuários
    # antes de criar, então nunca sobrescreve dados existentes.
    print("👤 [prestart] Verificando usuário admin inicial...")
    import seed_admin
    seed_admin.main()

    print("✅ [prestart] Inicialização concluída. Iniciando aplicação...")


if __name__ == "__main__":
    main()
