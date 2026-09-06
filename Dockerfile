FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY ais_gateway.py backend/ais_gateway.py
COPY data/data/ data/
COPY alert_service.py core.py data_source_registry.py eta_agent.py \
        fleet_agent.py geo_utils.py geofence_alerts.py geofencing_agent.py \
        language.py live_scheduler.py pfz_agent.py requests.py responses.py \
        route_planner.py satellite_agent.py synthesis_agent.py weather_agent.py \
        backend/
COPY index.html app.js styles.css sw.js manifest.json config.js live-overrides.js neon-border.js beyond-horizon-bg.js react-components.js static/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \

WORKDIR /app/backend
CMD ["python", "run_server.py"]
