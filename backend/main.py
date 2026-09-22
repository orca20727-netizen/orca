"""ORCA INSIGHT FastAPI application entrypoint."""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api.routes import router
from api.fisherman_ai_routes import router as fisherman_ai_router
from api.intel_routes import router as intel_router
from live_scheduler import lifespan

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_frontend_origin = os.getenv("FRONTEND_ORIGIN", "*")
allowed_origins = ["*"] if _frontend_origin.strip() == "*" else [item.strip() for item in _frontend_origin.split(",") if item.strip()]

app = FastAPI(title="ORCA INSIGHT API", version="1.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=allowed_origins != ["*"], allow_methods=["*"], allow_headers=["*"])

# Static assets (index.html/app.js/styles.css/config.js/icons/...) have no
# version-hashed filenames, and browsers heuristically cache any response
# that lacks Cache-Control -- so a redeploy can silently keep serving an
# old cached copy to a returning visitor until they hard-refresh. Force
# revalidation on every static/data request (StaticFiles already sets an
# ETag, so this is a cheap conditional GET, not a full re-download) so a
# new deploy is always picked up on normal reload.
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"
    return response

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Invalid request.", "errors": exc.errors()})

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred. Please try again."})

app.include_router(router)
app.include_router(fisherman_ai_router)
app.include_router(intel_router)

# --- ORCA Defence reverse proxy --------------------------------------------
# ORCA Defence runs as its own Railway service with its own backend,
# database and auth (see the orca-defence repo) -- it stays architecturally
# independent. This proxy only makes it reachable under this same domain,
# at /defence, so it shows up as part of the one ORCA website rather than a
# separate site. DEFENCE_UPSTREAM_URL is a Railway reference variable
# pointing at the orca-defence service's public domain.
_defence_upstream = os.getenv("DEFENCE_UPSTREAM_URL", "").rstrip("/")
_defence_client = httpx.AsyncClient(timeout=30.0) if _defence_upstream else None
_defence_req_exclude = {"host", "content-length", "connection", "transfer-encoding"}
_defence_resp_exclude = {"content-encoding", "content-length", "connection", "transfer-encoding"}
# Defence's frontend HTML references its own assets with root-absolute
# paths (/favicon.ico, /styles.css, /app.js, /theme.js), which is correct
# when it is the only app on its domain but wrong once it's served under
# /defence on this domain (those paths would resolve to *this* site's root
# instead). Its API calls are unaffected -- Defence's own API_BASE is
# "/api/defence", which is proxied below at that exact path regardless of
# page path -- so only these HTML asset references need rewriting.
_defence_html_asset_rewrites = (
    ('href="/favicon.ico"', 'href="/defence/favicon.ico"'),
    ('href="/styles.css"', 'href="/defence/styles.css"'),
    ('src="/app.js"', 'src="/defence/app.js"'),
    ('src="/theme.js"', 'src="/defence/theme.js"'),
    ('src="/intel.js"', 'src="/defence/intel.js"'),
)


async def _proxy_to_defence(upstream_path: str, request: Request) -> Response:
    if not _defence_client:
        return JSONResponse(status_code=503, content={"detail": "ORCA Defence is not configured on this deployment."})
    url = f"{_defence_upstream}/{upstream_path.lstrip('/')}"
    body = await request.body()
    fwd_headers = {k: v for k, v in request.headers.items() if k.lower() not in _defence_req_exclude}
    try:
        upstream_resp = await _defence_client.request(
            request.method, url, params=request.query_params, headers=fwd_headers, content=body,
        )
    except httpx.HTTPError:
        logger.exception("ORCA Defence upstream request failed for %s", url)
        return JSONResponse(status_code=502, content={"detail": "ORCA Defence is temporarily unreachable."})
    content_type = upstream_resp.headers.get("content-type", "")
    content = upstream_resp.content
    if content_type.startswith("text/html"):
        html = content.decode("utf-8", errors="replace")
        for old, new in _defence_html_asset_rewrites:
            html = html.replace(old, new)
        content = html.encode("utf-8")
    resp_headers = {k: v for k, v in upstream_resp.headers.items() if k.lower() not in _defence_resp_exclude}
    return Response(content=content, status_code=upstream_resp.status_code, headers=resp_headers, media_type=content_type or None)


@app.api_route("/api/defence/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_defence_api(path: str, request: Request):
    return await _proxy_to_defence(f"/api/defence/{path}", request)


@app.api_route("/defence", methods=["GET"])
@app.api_route("/defence/", methods=["GET"])
async def proxy_defence_root(request: Request):
    return await _proxy_to_defence("/", request)


@app.api_route("/defence/{path:path}", methods=["GET"])
async def proxy_defence_frontend(path: str, request: Request):
    return await _proxy_to_defence(f"/{path}", request)

root = Path(__file__).resolve().parent.parent
app.mount("/data", StaticFiles(directory=root / "data"), name="data")
app.mount("/", StaticFiles(directory=root / "static", html=True), name="dashboard")
