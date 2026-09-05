# Single-service ORCA image. FastAPI serves both the API and the static
# dashboard, allowing a deployment to use one Railway service and one domain.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY ais_gateway.py backend/ais_gateway.py
COPY data/data/ data/
COPY index.html app.js styles.css sw.js manifest.json config.js live-overrides.js beyond-horizon-bg.js react-components.js static/
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=3)" || exit 1

WORKDIR /app/backend
CMD ["python", "run_server.py"]
