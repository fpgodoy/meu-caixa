"""
auth.py — Autenticação e autorização da API.

Responsabilidades:
  - Hash e verificação de senhas com bcrypt
  - Geração e decodificação de tokens JWT
  - Dependência FastAPI 'get_current_user' usada em todas as rotas protegidas
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from jwt.exceptions import InvalidTokenError
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

import models
from database import get_db


# ── Configurações JWT ─────────────────────────────────────────────
# SECRET_KEY: chave usada para assinar os tokens. NUNCA pode ficar vazia em produção.
SECRET_KEY   = os.environ.get("JWT_SECRET", "")
ALGORITHM    = "HS256"
# Tempo de expiração do token em horas (padrão: 24h)
EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "24"))

if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET não definido nas variáveis de ambiente")

# Esquema OAuth2: informa ao FastAPI/Swagger onde fica o endpoint de login.
# Usado automaticamente ao injetar get_current_user nas rotas.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ── Helpers de senha ──────────────────────────────────────────────

def get_password_hash(password: str) -> str:
    """
    Gera o hash bcrypt da senha em texto puro.
    O salt é gerado aleatoriamente a cada chamada — senhas iguais
    produzem hashes diferentes, o que é o comportamento esperado.
    """
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verifica se a senha em texto puro corresponde ao hash armazenado.
    Retorna True apenas se a senha estiver correta.
    """
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── Geração e decodificação de JWT ────────────────────────────────

def create_access_token(user_id: int) -> str:
    """
    Cria um token JWT assinado contendo o ID do usuário ('sub').

    O token expira após EXPIRE_HOURS horas a partir da criação.
    Ao decodificá-lo, o PyJWT valida automaticamente a expiração.
    """
    expire = datetime.now(timezone.utc) + timedelta(hours=EXPIRE_HOURS)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


# ── Dependência FastAPI ───────────────────────────────────────────

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """
    Dependência injetada pelo FastAPI em toda rota protegida.

    Fluxo:
      1. Extrai o token Bearer do cabeçalho Authorization
      2. Decodifica e valida a assinatura e a expiração do JWT
      3. Lê o user_id do campo 'sub' e busca o usuário no banco
      4. Rejeita com 401 se o token for inválido, expirado ou o usuário estiver inativo

    O objeto User retornado é injetado diretamente nos parâmetros das rotas.
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido ou expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_error
    except InvalidTokenError:
        raise credentials_error

    # Busca o usuário e já filtra por is_active para bloquear usuários desativados
    user = db.query(models.User).filter(
        models.User.id == int(user_id),
        models.User.is_active == True,
    ).first()

    if user is None:
        raise credentials_error

    return user
