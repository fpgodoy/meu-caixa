FROM python:3.12-slim

WORKDIR /app

# Instala o cliente PostgreSQL para ter pg_dump disponível
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Garante permissão de execução no entrypoint
RUN chmod +x start.sh

CMD ["./start.sh"]
