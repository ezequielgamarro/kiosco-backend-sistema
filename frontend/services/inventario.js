/**
 * inventario.js — CRUD de Productos.
 * Lista, crea, edita y elimina productos conectándose a /api/productos.
 */
import { api } from './api.js';

const $ = (id) => document.getElementById(id);

const money = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n);

/**
 * Normaliza los campos que el backend Pydantic serializa como JSON string
 * (Decimales: precio, costo, stock, stock_minimo). El render y las
 * comparaciones de stock deben operar con Number para que la lógica de
 * "bajo stock" sea correcta (p. ej. 3.000 <= 10.000 no debe compararse
 * como cadena). `activo`, `id` (UUID) y `tipo_unidad` se mantienen igual.
 */
function normalizarProducto(p) {
  const out = { ...p };
  ['precio', 'costo', 'stock', 'stock_minimo'].forEach((k) => {
    const v = out[k];
    if (v !== undefined && v !== null && v !== '') out[k] = Number(v);
  });
  return out;
}

let productos = [];
let rolActual = 'cajero';

/** Determina si la vista es de admin (para activar edición/creación). */
function esAdmin() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return u?.rol === 'admin';
  } catch {
    return false;
  }
}

function toggleModales() {
  const esAdminFlag = esAdmin();
  const btnNuevo = $('btn-nuevo');
  if (btnNuevo) btnNuevo.style.display = esAdminFlag ? 'inline-flex' : 'none';
  document.getElementById('aviso-admin')?.classList.toggle('hidden', esAdminFlag);
}

/** Renderiza la tabla de productos. */
function renderTabla() {
  const tbody = $('tabla-productos');
  tbody.innerHTML = '';

  if (!productos.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-pos-text-body/60 py-8">No hay productos registrados.</td></tr>';
    return;
  }

  const admin = esAdmin();

  productos.forEach((p) => {
    const bajo = p.stock <= p.stock_minimo;
    const tipo = p.tipo_unidad || 'unidad';
    const etiquetaTipo = tipo === 'peso' ? 'Peso' : (tipo === 'porcion' ? 'Porción' : 'Unidad');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-mono text-xs">${p.codigo_barras || '—'}</td>
      <td class="font-medium">
        ${p.nombre} <span class="badge badge-neutral ml-1 align-middle">${etiquetaTipo}</span>
      </td>
      <td>${p.categoria || '—'}</td>
      <td>${money(p.precio)}</td>
      <td>
        <span class="badge ${bajo ? 'badge-danger' : 'badge-neutral'}">${p.stock}</span>
      </td>
      <td>
        <span class="badge ${p.activo ? 'badge-primary' : 'badge-neutral'}">${p.activo ? 'Activo' : 'Inactivo'}</span>
      </td>
      <td>
        <div class="flex justify-end gap-2">
          ${admin ? `
            <button data-editar="${p.id}" class="btn-secondary !px-3 !py-1.5 text-xs">Editar</button>
            <button data-eliminar="${p.id}" class="btn-danger !px-3 !py-1.5 text-xs">Eliminar</button>
          ` : ''}
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  // Enlazar acciones si es admin
  if (admin) {
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', () => abrirEdicion(b.dataset.editar))
    );
    tbody.querySelectorAll('[data-eliminar]').forEach((b) =>
      b.addEventListener('click', () => confirmarEliminar(b.dataset.eliminar))
    );
  }
}

// ---- Crear / Editar ----
function abrirModal(titulo = 'Nuevo producto', prod = null) {
  $('modal-producto-titulo').textContent = titulo;
  $('prod-id').value = prod?.id || '';
  $('prod-nombre').value = prod?.nombre || '';
  $('prod-codigo').value = prod?.codigo_barras || '';
  $('prod-categoria').value = prod?.categoria || '';
  $('prod-precio').value = prod?.precio ?? '';
  $('prod-costo').value = prod?.costo ?? '';
  $('prod-stock').value = prod?.stock ?? '';
  $('prod-stock-min').value = prod?.stock_minimo ?? '';
  $('prod-descripcion').value = prod?.descripcion || '';
  $('prod-tipo').value = prod?.tipo_unidad || 'unidad';
  $('prod-activo').checked = prod ? !!prod.activo : true;

  $('modal-producto').classList.remove('hidden');
  $('modal-producto').classList.add('flex');
}

function abrirEdicion(id) {
  const p = productos.find((x) => x.id === id);
  if (p) abrirModal('Editar producto', p);
}

// ---- Eliminar ----
let idAEliminar = null;
function confirmarEliminar(id) {
  idAEliminar = id;
  $('modal-eliminar').classList.remove('hidden');
  $('modal-eliminar').classList.add('flex');
}

// ---- Guardar (create/update) ----
async function guardar(e) {
  e.preventDefault();
  const id = $('prod-id').value;
  const payload = {
    nombre: $('prod-nombre').value.trim(),
    codigo_barras: $('prod-codigo').value.trim() || null,
    categoria: $('prod-categoria').value.trim() || null,
    tipo_unidad: $('prod-tipo').value || 'unidad',
    precio: Number($('prod-precio').value),
    costo: Number($('prod-costo').value || 0),
    stock: Number($('prod-stock').value || 0),
    stock_minimo: Number($('prod-stock-min').value || 0),
    descripcion: $('prod-descripcion').value.trim() || null,
    activo: $('prod-activo').checked,
  };

  try {
    if (id) {
      await api.updateProduct(id, payload);
    } else {
      await api.createProduct(payload);
    }
    cerrarModal('modal-producto');
    await cargar();
  } catch (err) {
    alert(`Error al guardar: ${err.message}`);
  }
}

// ---- Eliminar confirmado ----
async function eliminar() {
  if (!idAEliminar) return;
  try {
    await api.deleteProduct(idAEliminar);
    cerrarModal('modal-eliminar');
    idAEliminar = null;
    await cargar();
  } catch (err) {
    alert(`Error al eliminar: ${err.message}`);
  }
}

function cerrarModal(id) {
  const m = document.getElementById(id);
  m.classList.add('hidden');
  m.classList.remove('flex');
}

/** Carga productos desde el backend. */
async function cargar() {
  try {
    const arr = await api.getProducts();
    // El backend Pydantic envía Decimales como JSON string → normalizar.
    productos = (Array.isArray(arr) ? arr : []).map(normalizarProducto);
    renderTabla();
  } catch (e) {
    $('tabla-productos').innerHTML =
      `<tr><td colspan="7" class="text-center text-pos-danger py-8">No se pudieron cargar los productos: ${e.message}</td></tr>`;
  }
}

// ---- Inicialización bajo guardia de seguridad ----
async function init() {
  if (window.authGuardReady) {
    await window.authGuardReady;
  }

  $('btn-nuevo').addEventListener('click', () => abrirModal());
  $('form-producto').addEventListener('submit', guardar);
  $('btn-confirmar-eliminar').addEventListener('click', eliminar);

  toggleModales();
  await cargar();
}

init();
