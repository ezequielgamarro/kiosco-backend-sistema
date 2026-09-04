"""Punto de entrada principal de la API de Punto de Venta."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# Modelos ORM: importarlos ANTES de create_all para que las tablas de
# cada modelo queden registradas en Base.metadata.
import app.models  # noqa: F401  (efecto secundario intencional: registrar tablas)

from app.config import settings
from app.database import Base, engine
from app.dependencies import AuthError
from app.routers import productos, ventas, arqueo, reportes, auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ciclo de vida de la aplicación.

    En el arranque: crea el archivo `pos_local.db` (si no existe) y genera
    todas las tablas definidas en los modelos, en un arranque idempotente
    (no falla si ya existen).
    """
    import logging

    logger = logging.getLogger("uvicorn.error")
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Base de datos SQLite verificada y tablas sincronizadas.")
    except Exception:
        # No detener el arranque si la BD falla transitoriamente; el log
        # permite diagnosticar. En producción, revisar el log.
        logger.exception("Error al inicializar la base de datos.")
    yield
    engine.dispose()


# Instancia de la aplicación
app = FastAPI(
    title=settings.APP_NAME,
    description="Backend para sistema de punto de venta de quiosco/drugstore.",
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Configuración de CORS (orígenes desde settings, evita cáscara dura)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Manejador de errores de autenticación/autorización
@app.exception_handler(AuthError)
async def auth_error_handler(request: Request, exc: AuthError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detalle},
    )


# Manejador global de excepciones no controladas
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Devuelve un error 500 genérico sin filtrar detalles internos."""
    return JSONResponse(
        status_code=500,
        content={"detail": "Error interno del servidor. Contacta al administrador."},
    )


# ============================================================
# REGISTRO DE ROUTERS DE LA API
# IMPORTANTE: deben registrarse ANTES del app.mount("/", StaticFiles...)
# para que el prefijo /api (y demás rutas) se resuelvan correctamente.
# Si el mount estático se registra primero, captura TODAS las rutas
# (incluido /api/*) y solo sirve GET/HEAD → POST/otros devuelven
# "Method Not Allowed" / 404 en la API.
# ============================================================
app.include_router(productos.router, prefix=settings.API_PREFIX)
app.include_router(ventas.router, prefix=settings.API_PREFIX)
app.include_router(arqueo.router, prefix=settings.API_PREFIX)
app.include_router(reportes.router, prefix=settings.API_PREFIX)
app.include_router(auth.router, prefix=settings.API_PREFIX)

# Servir el frontend estático SIEMPRE EN ÚLTIMO LUGAR (catch-all)
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


@app.get("/", tags=["Health"])
def root() -> dict:
    """Endpoint de verificación de vida del servicio."""
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
def health() -> dict:
    """Endpoint de healthcheck para orquestadores / Docker."""
    return {"status": "healthy", "env": settings.ENV}
