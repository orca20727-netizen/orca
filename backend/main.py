"""
ORCA INSIGHT FastAPI application entrypoint.

Only responsible for: creating the FastAPI app, configuring middleware
(CORS) and global error handling, and registering the API router. Endpoint
logic lives in backend/api/routes.py; shared app state (loaded datasets,
agent instances, the pipeline runner) lives in backend/core.py.

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

import logging
import os

from dotenv import load_dotenv

# Load .env (if present) before anything else imports/instantiates agents --
# several agents read config (GROQ_API_KEY, OPEN_METEO_TIMEOUT, etc.) via
# os.getenv() at construction time, so this must run before `api.routes`
# (which imports `core`, which builds the agent instances) is imported.
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import router
from live_scheduler import lifespan

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# CORS: comma-separated list of allowed origins via FRONTEND_ORIGIN, e.g.
# "http://localhost:8080,http://192.168.1.10:8080". Defaults to a permissive
# "*" ONLY for local hackathon-demo convenience (there are no authenticated
# endpoints/cookies here) -- set FRONTEND_ORIGIN explicitly for any
# non-local deployment.
_FRONTEND_ORIGIN_ENV = os.getenv("FRONTEND_ORIGIN", "*")
ALLOWED_ORIGINS = (
    ["*"] if _FRONTEND_ORIGIN_ENV.strip() == "*"
    else [o.strip() for o in _FRONTEND_ORIGIN_ENV.split(",") if o.strip()]
)

app = FastAPI(
    title="ORCA INSIGHT API",
    description="Multi-Agent Marine Intelligence Platform for ISRO / SIH 2026 (PS 26176) by Team SavioursX",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOWED_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # FastAPI's default 422 body is already stack-trace-free, but this
    # keeps the shape consistent with our other error responses and gives
    # a single place to tweak it later.
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request.", "errors": exc.errors()},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Last-resort safety net: never let a raw Python traceback reach the
    # client. Individual agents/endpoints already catch what they can
    # (see core.safe_call and the try/except in /api/route) -- this only
    # fires for something genuinely unexpected.
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected server error occurred. Please try again."},
    )


app.include_router(router)
