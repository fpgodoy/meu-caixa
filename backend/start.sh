#!/bin/bash
set -e

echo "▶  Executando inicialização do banco de dados..."
python prestart.py

echo "▶  Iniciando servidor uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
