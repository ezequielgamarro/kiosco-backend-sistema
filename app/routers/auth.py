"""Router de autenticación y gestión de perfiles.

Autenticación 100% local:
- POST /auth/login: emite el JWT local tras validar credenciales.
- Verificación de token/selección de usuario delegada a `app.dependencies`.

Usuarios persistidos en SQLite (tabla `usuarios`).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import (
    crear_token_acceso,
    hash_password,
    verificar_password,
    get_current_user,
    requiere_rol,
    UsuarioActual,
)
from app.models import Usuario

router = APIRouter(prefix="/auth", tags=["Autenticación"])


class TokenRespuesta(BaseModel):
    """Estructura de respuesta del login."""

    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenRespuesta, summary="Iniciar sesión")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Autentica un usuario local y devuelve un token JWT.

    El body esperado es `application/x-www-form-urlencoded` con los campos
    `username` y `password` (formato OAuth2 estándar).
    """
    usuario = db.query(Usuario).filter(Usuario.email == form_data.username).first()
    if usuario is None or not verificar_password(
        form_data.password, usuario.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not usuario.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario desactivado",
        )

    token = crear_token_acceso(subject=usuario.id, rol=usuario.rol)
    return TokenRespuesta(access_token=token)


@router.get("/perfil", summary="Perfil del usuario actual")
def obtener_perfil(
    usuario: UsuarioActual = Depends(get_current_user),
):
    """Devuelve la información del usuario autenticado (id, email, nombre, rol).

    Útil para que el frontend conozca el rol y adapte la interfaz.
    """
    return {
        "id": usuario.id,
        "email": usuario.email,
        "nombre": usuario.nombre,
        "rol": usuario.rol,
    }


@router.get("/usuarios", summary="Listar usuarios del sistema (solo admin)")
def listar_usuarios(
    db: Session = Depends(get_db),
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
):
    """Devuelve todos los usuarios registrados. Solo accesible para administradores."""
    usuarios = db.query(Usuario).order_by(Usuario.nombre_completo).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "nombre_completo": u.nombre_completo,
            "rol": u.rol,
            "activo": u.activo,
            "creado_en": u.creado_en,
        }
        for u in usuarios
    ]


@router.patch(
    "/usuarios/{user_id}/rol", summary="Cambiar rol de un usuario (solo admin)"
)
def cambiar_rol(
    user_id: int,
    rol: str,
    db: Session = Depends(get_db),
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
):
    """Actualiza el rol de un usuario. Solo accesible para administradores.

    `rol` debe ser 'admin' o 'cajero'.
    """
    if rol not in ("admin", "cajero"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rol inválido. Debe ser 'admin' o 'cajero'.",
        )
    target = db.query(Usuario).filter(Usuario.id == user_id).first()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado",
        )
    target.rol = rol
    db.commit()
    db.refresh(target)
    return {
        "id": target.id,
        "email": target.email,
        "rol": target.rol,
    }
