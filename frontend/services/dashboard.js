/**
 * dashboard.js — Carga de KPIs y ventas recientes para la vista Dashboard.
 */
import { api } from './api.js';

const $ = (id) => document.getElementById(id);

/** Formatea números como moneda (CLP/ARS según locale del navegador). */
const money = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n);

/** Formatea fecha ISO como dd/mm/aaaa hh:mm */
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Establecer fecha de hoy para el reporte del día
const today = new Date().toISOString().slice(0, 10);

async function cargarDashboard() {
  try {
    // KPIs generales
    const dash = await api.dashboard();
    $('kpi-ventas').textContent = money(dash.ventas_hoy || 0);
    $('kpi-productos').textContent = dash.total_productos ?? 0;
    $('kpi-bajo-stock').textContent = dash.productos_bajo_stock ?? 0;
    $('kpi-caja').textContent =
      dash.ultimo_arqueo != null ? (dash.ultimo_arqueo.diferencia ?? 'ok') : '—';
  } catch (e) {
    console.error('Error cargando dashboard:', e);
  }

  // Ventas del día (reporte del backend)
  try {
    const rep = await api.salesReport(today, today);
    // Nota: el reporte agrega; para la tabla pedimos el historial (solo admin puede ver reportes, pero historial es cajero)
  } catch (e) {
    console.error('No se pudo cargar el reporte del día:', e);
  }

  // Tabla de ventas recientes desde el historial
  try {
    const ventas = await api.listSales(`?fecha_desde=${today}`);
    const tbody = $('ventas-recientes');
    tbody.innerHTML = '';
    if (!ventas || ventas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-pos-text-body/60 py-6">No hay ventas hoy.</td></tr>';
      return;
    }
    ventas.forEach((v) => {
      const tr = document.createElement('tr');
      const metodo = v.metodo_pago || '—';
      tr.innerHTML = `
        <td class="font-medium">${v.folio || v.id}</td>
        <td>${fmtDate(v.fecha)}</td>
        <td>${v.cliente || 'Mostrador'}</td>
        <td><span class="badge badge-neutral">${metodo}</span></td>
        <td class="text-right font-semibold">${money(v.total)}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('No se pudieron cargar las ventas:', e);
  }
}

async function init() {
  // Esperar a que la guardia de rutas valide la sesión/perfil antes de proceder
  if (window.authGuardReady) {
    await window.authGuardReady;
  }
  await cargarDashboard();
}

init();
