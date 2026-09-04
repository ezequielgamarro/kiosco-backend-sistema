"""Admnistración automática de la base de datos para arranque en producción.

Responsabilidades:
  1. `crear_admin_si_hace_falta()`: se invoca en el `lifespan` de la aplicación
     tras `Base.metadata.create_all(...)`. Si la tabla `usuarios` está VACÍA
     (base recién creada o reseteada para producción), crea de forma automática
     el usuario administrador por defecto, de modo que en una PC nueva el
     responsable pueda iniciar sesión de inmediato sin registro manual.

Reglas de idempotencia y seguridad:
  * SÓLO siembra el admin cuando NO existe NINGÚN usuario en la tabla.
    Así nunca pisa una base que ya tiene administradores gestionados a mano,
    ni "reinicia" contraseñas en cada arranque.
  * La contraseña se lee de entorno/settings (`ADMIN_PASSWORD`). Si no se
    configuró ninguna:
       - En desarrollo se usa una contraseña de conveniencia y se advierte.
       - En producción se GENERA una contraseña aleatoria sólida, se persiste
         su hash (nunca el plano) y se imprime el valor plano UNA sola vez en
         el log del arranque para que el responsable la copie. En arranques
         posteriores ya existe el usuario y ya no se vuelve a mostrar.
"""

import logging
import secrets
import sys

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import hash_password
from app.models import Usuario

logger = logging.getLogger("uvicorn.error")
# Valores por defecto (una instalación puede personalizarlos vía entorno):
FALLBACK_EMAIL = "admin@pos.local"
FALLBACK_NOMBRE = "Administrador"


def _email_default() -> str:
    return (settings.ADMIN_EMAIL or FALLBACK_EMAIL).strip().lower()


def _nombre_default() -> str:
    return (settings.ADMIN_NOMBRE_COMPLETO or FALLBACK_NOMBRE).strip()


def _resolver_password_plano() -> tuple[str, str]:
    """Devuelve (password_hash, password_plano_a_loggear_o_None).

    Prioridad:
      1. Valor explícito en settings.ADMIN_PASSWORD (recomendado en prod).
      2. Entorno de producción sin admin: contraseña aleatoria única (segura).
      3. Desarrollo: contraseña fija de conveniencia (con advertencia).
    """
    plano = (settings.ADMIN_PASSWORD or "").strip()
    if plano:
        return hash_password(plano), None  # parte plana NO se loguea jamás

    # Sin contraseña configurada. Un ejecutable compilado (PyInstaller) es una
    # instalación de despliegue: aunque ENV siguiera en "development", NO debe
    # quedar un admin con contraseña fija universal. En ese caso se genera una
    # contraseña aleatoria que se muestra una única vez en el primer arranque.
    es_compilado = bool(getattr(sys, "frozen", False))
    if es_compilado or settings.ENV.lower() != "development":
        planes_fuente = "ejecutable compilado" if es_compilado else "entorno productivo"
        logger.warning(
            "[seed] ADMIN_PASSWORD no definido para %s. Se generó una "
            "contraseña aleatoria de un solo arranque para el nuevo admin.",
            planes_fuente,
        )
        plano = secrets.token_urlsafe(16)
        return hash_password(plano), plano

    # Sólo para modo desarrollo (código fuente, no empaquetado) comodidad:
    plano = "admin123"
    logger.warning(
        "[seed] ADMIN_PASSWORD no definido. Usando contraseña de desarrollo '%s' "
        "para %s. Configura ADMIN_PASSWORD en .env para un entorno productivo.",
        plano,
        _email_default(),
    )
    return hash_password(plano), None


def crear_admin_si_hace_falta(db: Session) -> tuple[bool, str | None]:
    """Siembra el admin por defecto SOLO si la tabla de usuarios está vacía.

    Returns:
        (creado: bool, password_plano: Optional[str])
        - Si password_plano es str, acabamos de crearla aleatoriamente en un
          entorno de producción y hay que loguearla una única vez.
    """
    total_usuarios = db.query(func.count(Usuario.id)).scalar() or 0
    if total_usuarios:
        # No es una base "virgen": no pisamos lo que haya.
        return False, None

    email = _email_default()
    nombre = _nombre_default()
    password_hash, plano_a_loggear = _resolver_password_plano()

    admin = Usuario(
        email=email,
        nombre_completo=nombre,
        password_hash=password_hash,
        rol="admin",
        activo=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    logger.info(
        "[seed] Base de datos vacía. Usuario administrador creado "
        "-> id=%s email=%s rol=%s",
        admin.id,
        admin.email,
        admin.rol,
    )
    if plano_a_loggear:
        # La contraseña aleatoria se muestra una única vez (primer arranque).
        logger.warning(
            "[seed] ADMIN_PASSWORD no definido y entorno de producción. "
            "Contraseña temporal de %s (cambiar tras el primer acceso): %s",
            email,
            plano_a_loggear,
        )
    return True, plano_a_loggear


def verificar_estado(db: Session) -> None:
    """Helper de diagnóstico para desarrollo / reset (no requerido por prod)."""
    logger.info(
        "[seed] Usuarios en BD: %d",
        db.query(func.count(Usuario.id)).scalar() or 0,
    )
