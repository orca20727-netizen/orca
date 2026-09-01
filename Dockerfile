# Backend API image only. Serves FastAPI on port 8000 -- it does NOT serve
# the static frontend (index.html/app.js/styles.css), which previously made
# the single EXPOSE 8000 3000 in this Dockerfile ambiguous: nothing in the
# container ever listened on 3000. The frontend now has its own image
# (frontend.Dockerfile); see docker-compose.yml, which runs both as
# separate services.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Only the backend code and the data/ directory it reads from
# (backend/agents/*.py resolve paths as ../../data relative to themselves,
# i.e. <app>/data) are needed to run the API.
COPY backend/ backend/
COPY data/ data/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=3)" || exit 1

WORKDIR /app/backend
CMD ["python", "run_server.py"]
