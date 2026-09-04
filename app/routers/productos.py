"""Router de operaciones CRUD para Productos y consulta de stock bajo.

Persistencia local vía SQLAlchemy + SQLite. El `db` se inyecta con
`Depends(get_db)` y las operaciones usan los modelos ORM (`app.models.Producto`).
"""

from decimal import Decimal
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, requiere_rol, UsuarioActual

from app.models import Producto, now_utc
from app.schemas.producto import ProductoCreate, ProductoUpdate, ProductoOut

router = APIRouter(prefix="/productos", tags=["Productos"])

# NOTA: SQLAlchemy devuelve las columnas Numeric como `Decimal` de forma nativa;
# ya no hace falta normalizar manualmente como ocurría con Supabase.


@router.get("", response_model=List[ProductoOut], summary="Listar productos")
def listar_productos(
    categoria: str | None = None,
    activo: bool | None = None,
    usuario: UsuarioActual = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Devuelve el catálogo de productos, opcionalmente filtrado por categoría/activo."""
    try:
        query = db.query(Producto).order_by(Producto.nombre)
        if categoria:
            query = query.filter(Producto.categoria == categoria)
        if activo is not None:
            query = query.filter(Producto.activo == activo)
        return query.all()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al listar productos: {str(exc)}",
        )


@router.get(
    "/bajo-stock",
    response_model=List[ProductoOut],
    summary="Consultar alerta de bajo stock",
)
def productos_bajo_stock(
    usuario: UsuarioActual = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Devuelve los productos cuyo stock actual es menor o igual al stock mínimo."""
    try:
        return (
            db.query(Producto)
            .filter(Producto.activo.is_(True), Producto.stock <= Producto.stock_minimo)
            .all()
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al consultar bajo stock: {str(exc)}",
        )


@router.get(
    "/codigo/{codigo_barras}",
    response_model=ProductoOut,
    summary="Buscar producto por código de barras",
)
def buscar_por_codigo(
    codigo_barras: str,
    usuario: UsuarioActual = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Busca un producto activo por su código de barras/SKU.

    Especialmente útil en el punto de venta con lector de código de barras.
    """
    try:
        producto = (
            db.query(Producto)
            .filter(
                Producto.codigo_barras == codigo_barras,
                Producto.activo.is_(True),
            )
            .first()
        )
        if producto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Producto no encontrado para ese código de barras",
            )
        return producto
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al buscar por código de barras: {str(exc)}",
        )


@router.patch(
    "/{producto_id}/stock",
    response_model=ProductoOut,
    summary="Reponer / ajustar stock",
)
def ajustar_stock(
    producto_id: UUID,
    cantidad: Decimal,
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
    db: Session = Depends(get_db),
):
    """Ajusta el stock de un producto (reposición de inventario).

    Envía `cantidad`, que puede ser positiva (reponer) o negativa (baja/ajuste).
    Para productos por peso admite fracciones (Decimal); el stock nunca puede
    quedar negativo.
    """
    try:
        producto = db.query(Producto).filter(Producto.id == producto_id).first()
        if producto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Producto no encontrado",
            )
        nuevo_stock = Decimal(producto.stock) + cantidad
        if nuevo_stock < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"No puede quedar stock negativo para '{producto.nombre}' "
                    f"(stock actual: {producto.stock}, ajuste: {cantidad:+})"
                ),
            )
        producto.stock = nuevo_stock
        producto.actualizado_en = now_utc()
        db.commit()
        db.refresh(producto)
        return producto
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al ajustar stock: {str(exc)}",
        )


@router.get("/{producto_id}", response_model=ProductoOut, summary="Obtener un producto")
def obtener_producto(
    producto_id: UUID,
    usuario: UsuarioActual = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Devuelve el detalle de un producto específico por su ID."""
    try:
        producto = db.query(Producto).filter(Producto.id == producto_id).first()
        if producto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Producto no encontrado",
            )
        return producto
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al obtener el producto: {str(exc)}",
        )


@router.post(
    "",
    response_model=ProductoOut,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un producto",
)
def crear_producto(
    producto: ProductoCreate,
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
    db: Session = Depends(get_db),
):
    """Registra un nuevo producto en el catálogo."""
    try:
        nuevo = Producto(**producto.model_dump())
        db.add(nuevo)
        db.commit()
        db.refresh(nuevo)
        return nuevo
    except Exception as exc:  # pragma: no cover
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al crear el producto: {str(exc)} (posible duplicado de código de barras)",
        )


@router.patch(
    "/{producto_id}", response_model=ProductoOut, summary="Editar un producto"
)
def editar_producto(
    producto_id: UUID,
    producto: ProductoUpdate,
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
    db: Session = Depends(get_db),
):
    """Actualiza uno o más campos de un producto existente."""
    try:
        target = db.query(Producto).filter(Producto.id == producto_id).first()
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Producto no encontrado",
            )
        datos = {k: v for k, v in producto.model_dump().items() if v is not None}
        if not datos:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No se enviaron campos para actualizar",
            )
        for campo, valor in datos.items():
            setattr(target, campo, valor)
        target.actualizado_en = now_utc()
        db.commit()
        db.refresh(target)
        return target
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al editar el producto: {str(exc)}",
        )


@router.delete(
    "/{producto_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar un producto",
)
def eliminar_producto(
    producto_id: UUID,
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
    db: Session = Depends(get_db),
):
    """Elimina un producto del catálogo de forma definitiva."""
    try:
        target = db.query(Producto).filter(Producto.id == producto_id).first()
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Producto no encontrado",
            )
        db.delete(target)
        db.commit()
        return None
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al eliminar el producto: {str(exc)}",
        )
