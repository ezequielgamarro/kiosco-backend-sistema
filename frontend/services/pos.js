/**
 * pos.js — Lógica del Terminal POS.
 *
 * Carga el catálogo, maneja el carrito y registra la venta contra el backend
 * local FastAPI (`api.registerSale`). Soporta **unidades de venta**:
 *   - 'unidad' / 'porcion': se agregan por pieza entera (cantidad entera).
 *   - 'peso': el cajero ingresa KILOS (cantidad) O IMPORTE ($). El backend
 *     deriva la cantidad física exacta y descuenta la fracción de stock.
 *
 * Payload enviado al backend (esquema venta.VentaItem):
 *   { producto_id, cantidad }   → para piezas o venta por peso (kilos)
 *   { producto_id, importe }    → para venta por peso en pesos ($)
 */
import { api } from './api.js';

const $ = (id) => document.getElementById(id);

const money = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n || 0);

// ---------- Estado del carrito ----------
// Línea: { producto, modo, cantidad?, importe? } según unidad de venta.
//   modo 'unidad'/'porcion'  →  cantidad entera
//   modo 'cantidad' (peso)   →  cantidad en kg
//   modo 'importe'   (peso)  →  importe en $
let carrito = [];
let catalogo = [];
let productoPesoActual = null; // producto que se está cargando en el modal de peso

// ---------- Helpers de producto ----------
function esPorPeso(p) { return (p.tipo_unidad || 'unidad') === 'peso'; }

/**
 * Etiqueta de unidad mostrada junto al precio en el catálogo.
 * Centraliza el texto para impedir duplicados del sufijo "kg" (bug "/kgkg"):
 *  - 'peso'    → "/kg"
 *  - 'porcion' → "/porción"
 *  - 'unidad'  → "/un." (precio por pieza)
 */
function sufijoUnidadPrecio(p) {
  const t = p.tipo_unidad || 'unidad';
  if (t === 'peso') return '/kg';
  if (t === 'porcion') return '/porción';
  return '/un.';
}

/**
 * Formatea la cantidad física (stock) para mostrarla en la tarjeta.
 * El backend entrega el stock como JSON string con ceros (p. ej. "36.000").
 *  - 'unidad' / 'porcion' → entero sin decimales (36, no "36.000").
 *  - 'peso'              → conserva decimales, pero sin ceros sobrantes ("1.5", no "1.500").
 */
function formatearStock(stock, tipo) {
  const n = Number(stock || 0);
  return (tipo || 'unidad') === 'peso'
    ? String(Number(n.toFixed(3)))
    : String(Math.trunc(n));
}

function unidadesDisponibles(linea) {
  const p = linea.producto;
  // Stock se mide en las mismas unidades que la venta (kg para peso, piezas para unidad)
  return Number(p.stock || 0);
}

/** Importe de una línea (para subtotal y envío). */
function importeLinea(linea) {
  if (linea.modo === 'importe') return Number(linea.importe || 0);
  return (Number(linea.cantidad || 0)) * Number(linea.producto.precio || 0);
}

/** Cantidad física de una línea (piezas o kg). */
function cantidadLinea(linea) {
  if (linea.modo === 'importe') {
    // kg = importe / precio (solo informativo; el backend calcula exacto)
    const p = Number(linea.producto.precio || 0);
    return p > 0 ? Number(linea.importe) / p : 0;
  }
  return Number(linea.cantidad || 0);
}

// ---------- Render catálogo ----------
function renderCatalogo(productos) {
  catalogo = productos;
  const grid = $('pos-catalogo');
  grid.innerHTML = '';

  if (!productos.length) {
    grid.innerHTML = '<p class="col-span-full text-center text-pos-text-body/60 py-8">Sin productos. Agrega inventario primero.</p>';
    return;
  }

  productos.forEach((p) => {
    const bajo = Number(p.stock || 0) <= Number(p.stock_minimo || 0);
    const pesos = esPorPeso(p);
    const tipo = p.tipo_unidad || 'unidad';
    // Sufijo único del precio (evita duplicados tipo "/kgkg").
    const sufPrecio = sufijoUnidadPrecio(p);
    // Stock formateado según la unidad: "36" para unidad, "1.5" para peso.
    const stockTxt = formatearStock(p.stock, tipo);
    const card = document.createElement('button');
    card.type = 'button';
    card.className =
      'pos-card p-4 text-left hover:border-pos-primary hover:shadow-pos-primary transition-all disabled:opacity-50';
    card.disabled = Number(p.stock) <= 0;
    card.innerHTML = `
      <div class="flex items-start justify-between mb-2">
        <h5 class="text-sm font-semibold text-pos-text-head">${p.nombre}</h5>
        ${bajo ? '<span class="badge badge-danger">Bajo</span>' : ''}
        ${pesos ? '<span class="badge badge-neutral">por peso</span>' : ''}
      </div>
      <p class="text-pos-text-body/50 text-xs mb-3 truncate">${p.codigo_barras || 'Sin código'}</p>
      <div class="flex items-end justify-between">
        <span class="text-base font-bold text-pos-primary">${money(p.precio)}<span class="text-xs font-normal text-pos-text-body/50">${sufPrecio}</span></span>
        <span class="text-xs text-pos-text-body/50">stock: ${stockTxt}${pesos ? ' kg' : ''}</span>
      </div>`;
    card.addEventListener('click', () => onSelectProducto(p));
    grid.appendChild(card);
  });
}

/** Acción al tocar una tarjeta de producto. */
function onSelectProducto(p) {
  if (esPorPeso(p)) {
    abrirModalPeso(p);
    return;
  }
  // Unidad / porción: +1
  agregarUnidad(p, 1);
}

// ---- ELEMENTOS UNITARIOS (unidad/porción) ----
function agregarUnidad(p, delta) {
  const idx = carrito.findIndex((l) => l.producto.id === p.id);
  const disponible = Number(p.stock || 0);

  if (idx >= 0) {
    carrito[idx].cantidad = (Number(carrito[idx].cantidad) || 0) + delta;
    if (carrito[idx].cantidad > disponible) {
      alert(`Stock máximo disponible: ${disponible}`);
      carrito[idx].cantidad = disponible;
    }
    if (carrito[idx].cantidad <= 0) carrito.splice(idx, 1);
  } else {
    if (delta <= 0) return;
    carrito.push({ producto: p, modo: p.tipo_unidad || 'unidad', cantidad: delta });
  }
  renderCarrito();
}

// ---- PRODUCTOS POR PESO (modal kg / importe) ----
function abrirModalPeso(p) {
  productoPesoActual = p;
  $('peso-modal-titulo').textContent = p.nombre;
  $('peso-modal-precio').textContent = money(p.precio) + ' / kg   ·   stock: ' + p.stock + ' kg';
  $('peso-modo-cantidad').checked = true;
  $('peso-modo-importe').checked = false;
  $('peso-valor').value = '';
  actualizarPlaceholder();

  const m = $('modal-peso');
  m.classList.remove('hidden');
  m.classList.add('flex');
  $('peso-valor').focus();
}

function actualizarPlaceholder() {
  const input = $('peso-valor');
  const esPorCantidad = $('peso-modo-cantidad').checked;
  const lbl = $('peso-valor-label');
  if (esPorCantidad) {
    lbl.textContent = 'Cantidad (kg)';
    input.placeholder = 'Ej: 1.500';
    input.step = '0.001';
  } else {
    lbl.textContent = 'Importe ($)';
    input.placeholder = 'Ej: 2000';
    input.step = '0.01';
  }
}

function cerrarModalPeso() {
  const m = $('modal-peso');
  m.classList.add('hidden');
  m.classList.remove('flex');
  productoPesoActual = null;
}

/** Agrega (o acumula) una línea de producto por peso usando el modo elegido. */
function agregarPeso(mode) {
  if (!productoPesoActual) return;
  const p = productoPesoActual;
  const valor = Number(($('peso-valor').value || '').replace(',', '.'));
  if (!valor || valor <= 0) {
    alert('Ingresa un valor mayor a cero.');
    return;
  }

  // stock disponible en kg (peso) — aprox. al derivar importe (kg = imp/precio)
  const disponible = Number(p.stock || 0);
  const modoModo = mode; // 'cantidad' (kg) | 'importe' ($)
  if (modoModo === 'cantidad' && valor > disponible) {
    alert(`Stock máximo disponible: ${disponible} kg`);
    return;
  }
  // validación de alcance: importe no puede superar valor unitario del stock disponible
  if (modoModo === 'importe') {
    const maxImporte = disponible * Number(p.precio || 0);
    if (valor > maxImporte) {
      alert(`El importe excede el valor del stock disponible (≈ ${money(maxImporte)}).`);
      return;
    }
  }

  // Reutilizar línea existente del producto SOLO si el modo coincide (backend
  // rechaza productos repetidos en una misma venta → una línea por producto).
  const idx = carrito.findIndex((l) => l.producto.id === p.id);
  if (idx >= 0) {
    const act = carrito[idx];
    if (act.modo !== modoModo) {
      alert(`Este producto ya tiene una línea por ${act.modo === 'importe' ? 'importe ($)' : 'kilos (kg)'}. Quita la línea para cambiar el modo.`);
      cerrarModalPeso();
      return;
    }
    if (modoModo === 'cantidad') {
      act.cantidad = Number(act.cantidad) + valor;
    } else {
      act.importe = Number(act.importe || 0) + valor;
    }
  } else {
    const linea = { producto: p, modo: modoModo };
    if (modoModo === 'cantidad') linea.cantidad = valor;
    else linea.importe = valor;
    carrito.push(linea);
  }

  cerrarModalPeso();
  renderCarrito();
}

// ---- Carrito ----
function quitarDelCarrito(id) {
  carrito = carrito.filter((i) => i.producto.id !== id);
  renderCarrito();
}

function renderCarrito() {
  const cont = $('carrito-items');
  cont.innerHTML = '';

  if (!carrito.length) {
    cont.innerHTML = '<p class="text-center text-pos-text-body/60 text-sm py-8">El carrito está vacío</p>';
    $('carrito-subtotal').textContent = money(0);
    $('carrito-descuentos').textContent = '-$0.00';
    $('carrito-total').textContent = money(0);
    return;
  }

  let subtotal = 0;
  carrito.forEach((linea) => {
    const { producto } = linea;
    const importe = importeLinea(linea);
    subtotal += importe;

    const detalle = detalleLinea(linea);

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3 py-2 border-b border-pos-secondary/30 last:border-0';
    row.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm font-medium text-pos-text-head truncate">${producto.nombre}</p>
        <p class="text-xs text-pos-text-body/60">${detalle}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-sm font-semibold">${money(importe)}</span>
        <button data-quitar="${producto.id}" class="text-pos-danger hover:text-pos-danger/80" aria-label="Quitar">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
    cont.appendChild(row);
  });

  $('carrito-subtotal').textContent = money(subtotal);
  $('carrito-descuentos').textContent = '-$0.00';
  $('carrito-total').textContent = money(subtotal);

  cont.querySelectorAll('[data-quitar]').forEach((btn) =>
    btn.addEventListener('click', () => quitarDelCarrito(btn.dataset.quitar))
  );
}

/** Texto descriptivo de la línea según su modo. */
function detalleLinea(linea) {
  const p = linea.producto;
  const precioU = money(p.precio);
  if (linea.modo === 'importe') {
    const kg = cantidadLinea(linea).toFixed(3).replace(/\.?0+$/, '');
    return `${precioU}/kg · por importe → ≈ ${kg} kg`;
  }
  if (esPorPeso(p)) {
    return `${precioU}/kg × ${linea.cantidad} kg`;
  }
  return `${precioU} × ${linea.cantidad} ${p.tipo_unidad === 'porcion' ? 'porción(es)' : 'un.'}`;
}

// ---- Cobro contra el backend local ----
async function cobrar() {
  if (!carrito.length) {
    alert('El carrito está vacío');
    return;
  }

  const metodoPago = $('metodo-pago').value;
  const cliente = $('cliente-venta').value.trim() || 'Mostrador';

  // Construir items según esquema VentaItem: EXACTAMENTE cantidad O importe
  const items = carrito.map((linea) => {
    const base = { producto_id: linea.producto.id, descuento: 0 };
    if (linea.modo === 'importe') {
      return { ...base, importe: Number(linea.importe).toFixed(2) };
    }
    return { ...base, cantidad: Number(linea.cantidad).toFixed(3) };
  });

  const btn = $('btn-cobrar');
  btn.disabled = true;
  btn.textContent = 'Procesando...';

  try {
    const venta = await api.registerSale({ items, metodo_pago: metodoPago, cliente });
    alert(`Venta registrada correctamente. Folio: ${venta.folio}`);
    carrito = [];
    renderCarrito();
  } catch (e) {
    alert(`Error al registrar la venta: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cobrar venta';
  }
}

// ---- Inicialización bajo guardia ----
async function init() {
  if (window.authGuardReady) {
    await window.authGuardReady;
  }

  $('btn-cobrar').addEventListener('click', cobrar);

  // Modal de peso
  $('peso-modo-cantidad').addEventListener('change', () => { actualizarPlaceholder(); });
  $('peso-modo-importe').addEventListener('change', () => { actualizarPlaceholder(); });
  $('btn-peso-agregar').addEventListener('click', () => {
    const mode = $('peso-modo-importe').checked ? 'importe' : 'cantidad';
    agregarPeso(mode);
  });
  $('btn-peso-cancelar').addEventListener('click', cerrarModalPeso);
  const btnCancel2 = $('btn-peso-cancelar-2');
  if (btnCancel2) btnCancel2.addEventListener('click', cerrarModalPeso);

  $('pos-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtrados = catalogo.filter(
      (p) =>
        (p.nombre && p.nombre.toLowerCase().includes(q)) ||
        (p.codigo_barras && p.codigo_barras.toLowerCase().includes(q))
    );
    renderCatalogo(filtrados);
  });

  try {
    const productos = await api.getProducts();
    renderCatalogo(productos);
  } catch (e) {
    $('pos-catalogo').innerHTML = `<p class="col-span-full text-center text-pos-danger py-8">No se pudieron cargar los productos: ${e.message}</p>`;
  }
}

init();
