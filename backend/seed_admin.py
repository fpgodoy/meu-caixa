"""Script one-shot para criar o usuário admin inicial.

Uso:
    docker compose exec backend python seed_admin.py
"""
import sys
import os

# Garante que o diretório da app está no path
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, engine
import models
from auth import get_password_hash

def main():
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.username == "admin").first()
        if existing:
            print("⚠️  Usuário 'admin' já existe. Nenhuma alteração feita.")
            return

        admin = models.User(
            username="admin",
            display_name="Administrador",
            hashed_password=get_password_hash("admin123"),
            is_active=True,
            must_change_password=True,   # força troca no primeiro acesso
        )
        db.add(admin)
        db.commit()
        print("✅ Usuário 'admin' criado com senha 'admin123'.")
        print("   Você será solicitado a trocar usuário e senha no primeiro acesso.")
    finally:
        db.close()

if __name__ == "__main__":
    main()
