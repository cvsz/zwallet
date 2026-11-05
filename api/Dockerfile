# api/Dockerfile
# FINAL HARDENED (zero-trust + minimal attack surface)

########################
# Builder stage
########################
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /build

RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends build-essential gcc \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN python -m venv /venv \
 && /venv/bin/pip install --upgrade pip \
 && /venv/bin/pip install --require-hashes -r requirements.txt \
 && find /venv -name "*.pyc" -delete \
 && rm -rf /venv/lib/python*/site-packages/pip* \
           /venv/lib/python*/site-packages/setuptools* \
           /venv/lib/python*/site-packages/wheel*

########################
# Runtime stage
########################
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/venv/bin:$PATH"

WORKDIR /app

# Apply Debian security updates available for the pinned base digest/tag before
# dropping privileges. This keeps Trivy's fixed OS CVEs from surviving merely
# because the upstream slim image was published before the security repository
# update landed.
RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/*

# non-root (no shell)
RUN useradd -m -u 10001 -s /usr/sbin/nologin appuser

COPY --from=builder /venv /venv
COPY app ./app

# strict permissions
RUN chown -R appuser:appuser /app /venv \
 && chmod -R 550 /app \
 && chmod -R 550 /venv

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import socket; s=socket.create_connection(('127.0.0.1',8080),2); s.close()" || exit 1

CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8080","--proxy-headers","--forwarded-allow-ips","*"]
