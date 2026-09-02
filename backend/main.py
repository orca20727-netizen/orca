"""ORCA INSIGHT FastAPI application entrypoint."""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api.routes import router
from live_scheduler import lifespan

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_frontend_origin = os.getenv("FRONTEND_ORIGIN", "*")
allowed_origins = ["*"] if _frontend_origin.strip() == "*" else [item.strip() for item in _frontend_origin.split(",") if item.strip()]

app = FastAPI(title="ORCA INSIGHT API", version="1.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=allowed_origins != ["*"], allow_methods=["*"], allow_headers=["*"])

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Invalid request.", "errors": exc.errors()})

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred. Please try again."})

app.include_router(router)

root = Path(__file__).resolve().parent.parent
app.mount("/data", StaticFiles(directory=root / "data"), name="data")
app.mount("/", StaticFiles(directory=root / "static", html=True), name="dashboard")
