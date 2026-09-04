"""Router de reportes agregaciones y KPIs para el dashboard.

Persistencia local vía SQLAlchemy + SQLite con `db: Session = Depends(get_db)`.
Genera: ventas por periodo, productos más vendidos y resumen de KPIs.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import requiere_rol, UsuarioActual
from app.models import Venta, VentaItem, Producto, Arqueo

router = APIRouter(prefix="/reportes", tags=["Reportes"])


def _desde_dt(desde: date) -> datetime:
    """Límite inferior (inicio del día) de un rango de fechas."""
    return datetime.combine(desde, datetime.min.time())


def _hasta_dt(hasta: date) -> datetime:
    """Límite superior (fin del día) de un rango de fechas."""
    return datetime.combine(hasta, datetime.max.time())


@router.get("/ventas", summary="Resumen de ventas por periodo")
def resumen_ventas(
    fecha_desde: date,
    fecha_hasta: date,
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
    db: Session = Depends(get_db),
):
    """Devuelve total, cantidad de ventas y desglose por método de pago del periodo."""
    try:
        ventas = (
            db.query(Venta)
            .filter(Venta.fecha >= _desde_dt(fecha_desde))
            .filter(Venta.fecha <= _hasta_dt(fecha_hasta))
            .all()
        )

        total = sum((Decimal(v.total) for v in ventas), Decimal("0"))
        por_metodo: dict[str, Decimal] = {}
        for v in ventas:
            por_metodo[v.metodo_pago] = por_metodo.get(
                v.metodo_pago, Decimal("0")
            ) + Decimal(v.total)

        return {
            "fecha_desde": fecha_desde,
            "fecha_hasta": fecha_hasta,
            "total_vendido": total,
            "cantidad_ventas": len(ventas),
            "por_metodo_pago": {k: v for k, v in por_metodo.items()},
        }
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al consultar resumen de ventas: {str(exc)}",
        )


@router.get("/mas-vendidos", summary="Productos más vendidos del periodo")
def productos_mas_vendidos(
    fecha_desde: date,
    fecha_hasta: date,
    limite: int = 10,
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
    db: Session = Depends(get_db),
):
    """Devuelve el ranking de productos más vendidos por cantidad en el periodo.

    La agregación (SUM cantidad e importe por producto, dentro de las ventas del
    rango) se resuelve en SQL vía una subconsulta contra `venta_items`, evitando
    traer filas innecesarias a Python.
    """
    try:
        limite = max(1, min(limite, 50))

        # Subconsulta: ids de ventas dentro del periodo.
        ventas_subq = (
            db.query(Venta.id)
            .filter(Venta.fecha >= _desde_dt(fecha_desde))
            .filter(Venta.fecha <= _hasta_dt(fecha_hasta))
            .subquery()
        )

        ranking_rows = (
            db.query(
                VentaItem.producto_id,
                func.sum(VentaItem.cantidad).label("cantidad_total"),
                func.sum(
                    VentaItem.cantidad * VentaItem.precio_unitario - VentaItem.descuento
                ).label("importe_total"),
            )
            .filter(VentaItem.venta_id.in_(db.query(ventas_subq.c.id)))
            .group_by(VentaItem.producto_id)
            .order_by(func.sum(VentaItem.cantidad).desc())
            .limit(limite)
            .all()
        )

        resultado = []
        for pid, cantidad_total, importe_total in ranking_rows:
            nombre = "Producto eliminado"
            prod = db.query(Producto).filter(Producto.id == pid).first()
            if prod is not None:
                nombre = prod.nombre
            resultado.append(
                {
                    "producto_id": pid,
                    "nombre": nombre,
                    # Decimal: la suma puede incluir fracciones (venta por peso).
                    "cantidad_total": Decimal(cantidad_total),
                    "importe_total": Decimal(importe_total),
                }
            )
        return resultado
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al consultar más vendidos: {str(exc)}",
        )


@router.get("/dashboard", summary="KPIs generales para el dashboard")
def dashboard(
    usuario: UsuarioActual = Depends(requiere_rol("admin")),
    db: Session = Depends(get_db),
):
    """Devuelve métricas globales: total de productos, bajo stock, última caja."""
    try:
        # Productos activos y su bajo stock (leídos de una sola vez).
        productos = db.query(Producto).filter(Producto.activo.is_(True)).all()
        total_productos = len(productos)
        bajo_stock = sum(
            1 for p in productos if Decimal(p.stock) <= Decimal(p.stock_minimo)
        )

        # Ventas de hoy
        hoy = date.today()
        ventas_hoy = (
            db.query(Venta)
            .filter(Venta.fecha >= _desde_dt(hoy))
            .filter(Venta.fecha <= _hasta_dt(hoy))
            .all()
        )
        total_ventas_hoy = sum((Decimal(v.total) for v in ventas_hoy), Decimal("0"))

        # Última caja cerrada
        ultimo = (
            db.query(Arqueo)
            .filter(Arqueo.estado == "cerrado")
            .order_by(Arqueo.fecha_cierre.desc())
            .first()
        )
        ultimo_arqueo = (
            {
                "id": ultimo.id,
                "diferencia": (
                    Decimal(ultimo.diferencia)
                    if ultimo.diferencia is not None
                    else None
                ),
            }
            if ultimo is not None
            else None
        )

        return {
            "total_productos": total_productos,
            "productos_bajo_stock": bajo_stock,
            "ventas_hoy": total_ventas_hoy,
            "ultimo_arqueo": ultimo_arqueo,
        }
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al consultar dashboard: {str(exc)}",
        )
