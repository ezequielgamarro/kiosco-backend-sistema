/**
 * caja.js — Lógica del Arqueo de Caja.
 * Consulta la caja activa, permite abrir, registrar movimientos y cerrar el turno.
 */
import { api } from './api.js';

const $ = (id) => document.getElementById(id);

const money = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n || 0);

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function modal(id, abrir = true) {
  const m = document.getElementById(id);
  if (!m) return;
  if (abrir) { m.classList.remove('hidden'); m.classList.add('flex'); }
  else { m.classList.add('hidden'); m.classList.remove('flex'); }
}

/** Renderiza el estado de la caja según si está abierta o cerrada. */
function renderEstado(cajaAbierta) {
  const indicador = $('indicador-estado');
  const texto = $('texto-estado');
  const puntos = ['btn-movimiento', 'btn-cerrar'];

  if (cajaAbierta) {
    indicador.className = 'h-3 w-3 rounded-full bg-pos-primary';
    texto.textContent = 'Abierta';
    $('btn-abrir').classList.add('hidden');
    puntos.forEach((id) => document.getElementById(id).classList.remove('hidden'));
  } else {
    indicador.className = 'h-3 w-3 rounded-full bg-pos-secondary';
    texto.textContent = 'Cerrada';
    $('btn-abrir').classList.remove('hidden');
    puntos.forEach((id) => document.getElementById(id).classList.add('hidden'));
  }
}

/** Renderiza los totales financieros y movimientos desde el resumen. */
function renderResumen(resumen) {
  if (!resumen) return;
  $('fin-ventas').textContent = money(resumen.ventas_efectivo);
  $('fin-ingresos').textContent = money(resumen.ingresos_manuales);
  $('fin-egresos').textContent = money(-resumen.egresos_manuales);
  $('fin-esperado').textContent = money(resumen.total_esperado);

  // Movimientos
  const tbody = $('movimientos-tabla');
  tbody.innerHTML = '';
  const movs = resumen.movimientos || [];
  if (!movs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-pos-text-body/60 py-6">Sin movimientos en el turno.</td></tr>';
    return;
  }
  movs.sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).forEach((m) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge ${m.tipo === 'ingreso' ? 'badge-primary' : 'badge-danger'}">${m.tipo}</span></td>
      <td>${m.concepto || '—'}</td>
      <td>${m.metodo_pago || '—'}</td>
      <td>${fmtDate(m.fecha)}</td>
      <td class="text-right font-semibold ${m.tipo === 'ingreso' ? '' : 'text-pos-danger'}">${m.tipo === 'ingreso' ? '+' : '-'}${money(m.monto)}</td>`;
    tbody.appendChild(tr);
  });
}

/** Carga el estado global de la caja. */
async function cargar() {
  try {
    const resumen = await api.cashSummary();
    renderEstado(true);
    renderResumen(resumen);
  } catch (e) {
    // Si no hay caja abierta, el resumen falla con 409 -> caja cerrada
    renderEstado(false);
    $('fin-ventas').textContent = money(0);
    $('fin-ingresos').textContent = money(0);
    $('fin-egresos').textContent = money(0);
    $('fin-esperado').textContent = money(0);
    $('movimientos-tabla').innerHTML = '<tr><td colspan="5" class="text-center text-pos-text-body/60 py-6">La caja está cerrada.</td></tr>';
  }
}

// ---- Acciones ----
async function abrir(e) {
  e.preventDefault();
  const monto = Number($('monto-inicial').value);
  const observaciones = $('obs-apertura').value.trim() || null;
  try {
    await api.openCash({ monto_inicial: monto, observaciones });
    modal('modal-abrir', false);
    $('form-abrir').reset();
    await cargar();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function registrarMovimiento(e) {
  e.preventDefault();
  try {
    const mov = {
      tipo: $('mov-tipo').value,
      monto: Number($('mov-monto').value),
      concepto: $('mov-concepto').value.trim(),
      metodo_pago: $('mov-metodo').value,
    };
    await api.addMovement(mov);
    modal('modal-movimiento', false);
    $('form-movimiento').reset();
    await cargar();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function cerrar(e) {
  e.preventDefault();
  try {
    const monto = Number($('monto-real').value);
    const observaciones = $('obs-cierre').value.trim() || null;
    await api.closeCash({ monto_final: monto, observaciones });
    modal('modal-cerrar', false);
    $('form-cerrar').reset();
    await cargar();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ---- Inicialización bajo guardia de seguridad ----
async function init() {
  if (window.authGuardReady) {
    await window.authGuardReady;
  }

  $('btn-abrir').addEventListener('click', () => modal('modal-abrir'));
  $('form-abrir').addEventListener('submit', abrir);
  $('btn-movimiento').addEventListener('click', () => modal('modal-movimiento'));
  $('form-movimiento').addEventListener('submit', registrarMovimiento);
  $('btn-cerrar').addEventListener('click', () => modal('modal-cerrar'));
  $('form-cerrar').addEventListener('submit', cerrar);

  await cargar();
}

init();
