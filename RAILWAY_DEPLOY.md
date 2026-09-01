# Railway deployment guide

This project uses two Railway services from the same repository: the FastAPI
backend and the static nginx frontend. Deploy the backend first and copy its
public URL before configuring the frontend.

## 1. Backend service

- Create a Railway service using the repository root.
- Set the Dockerfile path to `Dockerfile`.
- Add `FRONTEND_ORIGIN` after the frontend public URL is known.
- Do **not** set `BACKEND_PORT`; Railway supplies `PORT` automatically.
- Configure any required backend-only values such as `GROQ_API_KEY`,
  `TELEMETRY_INGEST_TOKEN`, and external-feed credentials in Railway.

The backend's health endpoint is `/api/health`.

## 2. Frontend service

- Create a second service from the same repository.
- Set the Dockerfile path to `frontend.Dockerfile`.
- Set `ORCA_API_BASE` to the backend public URL, for example
  `https://orca-api.example.up.railway.app`.
- Set `ORCA_WS_BASE` to the same URL using `wss://`, for example
  `wss://orca-api.example.up.railway.app`.

The frontend container generates `config.js` at startup and listens on the
Railway-provided `PORT`; no URLs or ports are baked into the built image.

## 3. Finalize and verify

- Set the backend `FRONTEND_ORIGIN` to the exact frontend URL and redeploy the
  backend.
- Open the frontend and check `/api/health` through the backend URL.
- Confirm browser WebSocket traffic connects using the configured `wss://`
  address, not an `http://…:8000` local fallback.

Do not put secrets in `ORCA_API_BASE`, `ORCA_WS_BASE`, `config.js`, or any
frontend file. These values are visible to every browser visitor.
