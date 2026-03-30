"""Script one-shot para criar o usuário admin inicial.

É chamado automaticamente pelo backend no startup.
Não cria nada se já existir qualquer usuário no banco.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, engine
import models
from auth import get_password_hash


def main():
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        total = db.query(models.User).count()
        if total > 0:
            # Já existem usuários — não faz nada, independente dos nomes
            return

        admin = models.User(
            username="admin",
            hashed_password=get_password_hash("admin123"),
            is_active=True,
            must_change_password=True,
        )
        db.add(admin)
        db.commit()
        print("✅ Usuário 'admin' criado com senha 'admin123'.")
        print("   Você será solicitado a trocar usuário e senha no primeiro acesso.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
