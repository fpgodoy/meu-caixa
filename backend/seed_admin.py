"""
seed_admin.py — Cria o usuário administrador inicial da aplicação.

Chamado pelo prestart.py durante a inicialização do container.
Aplica a lógica "idempotente": não faz nada se já existir qualquer
usuário no banco, evitando duplicação em restarts ou redeploys.

Credenciais padrão:
  - Usuário: admin
  - Senha:   admin123
  - O campo must_change_password=True força a troca no primeiro acesso.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
import models
from auth import get_password_hash


def main():
    """
    Garante que existe pelo menos um usuário administrador no banco.

    Comportamento:
      - Se a tabela 'users' tiver qualquer registro → encerra sem fazer nada.
      - Se estiver vazia → cria o usuário 'admin' com senha temporária.

    ATENÇÃO: esta função pressupõe que as tabelas já existem.
    Ela é chamada APÓS 'alembic upgrade head' no prestart.py.
    """
    db = SessionLocal()
    try:
        total = db.query(models.User).count()
        if total > 0:
            # Já existem usuários — não interfere, independente dos nomes
            return

        admin = models.User(
            username="admin",
            hashed_password=get_password_hash("admin123"),
            is_active=True,
            must_change_password=True,  # Força troca de senha no primeiro login
        )
        db.add(admin)
        db.commit()
        print("✅ Usuário 'admin' criado com senha 'admin123'.")
        print("   Você será solicitado a trocar usuário e senha no primeiro acesso.")

    except Exception:
        # Reverte a transação em caso de falha para não deixar a sessão suja
        db.rollback()
        raise
    finally:
        # Garante que a sessão é sempre fechada, mesmo em caso de erro
        db.close()


if __name__ == "__main__":
    main()
