/**
 * guard.js — Guardia de rutas y seguridad del frontend (backend local JWT).
 *
 * Script GLOBAL auto-ejecutable. Cargar en cada vista protegida
 * (pos.html, dashboard.html, inventario.html, caja.html) DESPUÉS de:
 *   <script src="./services/config.js"></script>
 *
 * RBAC / control de acceso por rol:
 * El rol autoritativo se extrae del **claim `rol` del JWT** guardado en
 * localStorage (clave "token", la misma que usa auth.js y api.js). Este claim
 * es determinista y no depende de la red. En paralelo se consulta `/auth/perfil`
 * sólo para datos de visualización (nombre/email) y como fuente secundaria de rol.
 *
 * Reglas:
 *   - Sin token        → redirige a login.html.
 *   - Rol 'admin'      → accede a dashboard.html e inventario.html.
 *   - Rol 'cajero'     → se limita a pos.html/caja.html (se redirige desde admin).
 *   - Sin rol resuelto → NO se asume 'cajero' a ciegas: se conserva el rol
 *     cacheado en localStorage, evitando degradar a un admin por un fallo
 *     puntual de red o de decodificación.
 *
 * Expone `window.authGuardReady` (promesa) para que los módulos de las vistas
 * esperen a que la resolución termine antes de inicializarse.
 */
(function () {
  'use strict';

  var ADMIN_ROUTES = /(dashboard|inventario)\.html$/;
  var TOKEN_KEY = 'token';   // clave del JWT (auth.js / api.js)
  var USER_KEY = 'user';
  var ROLE_KEY = 'rol';      // cache local del rol

  function apiBase() {
    return window.API_BASE_URL || 'http://127.0.0.1:8000/api';
  }

  function forceLogout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
    if (window.location.pathname.indexOf('login.html') === -1) {
      window.location.replace('login.html');
    }
  }

  /**
   * Decodifica (sin validar firma) el payload de un JWT almacenado.
   * La parte 2 es base64url del JSON { sub, rol, exp }.
   * Devuelve el objeto de claims, o {} si no puede decodificarse.
   */
  function decodificarToken(token) {
    if (!token) return {};
    try {
      var segmentos = token.split('.');
      if (segmentos.length !== 3) return {};
      var payload = segmentos[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4 !== 0) payload += '='; // padding base64
      var json = decodeURIComponent(
        atob(payload)
          .split('')
          .map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); })
          .join('')
      );
      return JSON.parse(json) || {};
    } catch (e) {
      console.warn('[guard.js] No se pudo decodificar el payload del token:', e.message);
      return {};
    }
  }

  // Inyecta en el Header nombre_completo y rol (badge).
  function injectHeader(perfil) {
    if (!perfil) return;
    var nombre = perfil.nombre_completo || perfil.nombre || 'Usuario';

    var nameEl = document.getElementById('profile-name');
    var initialEl = document.getElementById('profile-initial');
    var rolBadge = document.getElementById('profile-rol');

    if (nameEl) nameEl.textContent = nombre;
    if (initialEl) initialEl.textContent = nombre.charAt(0).toUpperCase();
    if (rolBadge) {
      var esAdmin = perfil.rol === 'admin';
      rolBadge.textContent = esAdmin ? 'Admin' : 'Cajero';
      rolBadge.className =
        'ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ' +
        (esAdmin ? 'bg-pos-primary text-pos-primary-text' : 'bg-pos-secondary text-pos-text-head');
    }
  }

  function bindLogout() {
    var btn = document.getElementById('logout-btn');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      forceLogout();
    });
  }

  // ---------- Boot de la guardia ----------
  var resolveReady;
  window.authGuardReady = new Promise(function (resolve) { resolveReady = resolve; });

  var token = localStorage.getItem(TOKEN_KEY);

  // 1) Sin token → login.
  if (!token) {
    forceLogout();
    return; // la promesa nunca resuelve; la vista no continúa
  }

  // 2) Autoridad de rol: claim del JWT (determinista y sin red).
  var claims = decodificarToken(token);
  var rol = claims.rol;        // 'admin' | 'cajero' | undefined
  var perfil = null;           // perfil servido por /auth/perfil (display)

  (async function boot() {
    // /perfil para datos de visualización y, si el JWT no trajo rol, como
    // fuente secundaria (el backend refleja el rol actual del usuario).
    try {
      var res = await fetch(apiBase() + '/auth/perfil', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
      });
      if (res.status === 401 || res.status === 403) {
        forceLogout();
        return;
      }
      if (res.ok) {
        perfil = await res.json();
        rol = rol || perfil.rol || localStorage.getItem(ROLE_KEY);
      }
    } catch (err) {
      // Backend inalcanzable: conservar el rol del JWT / cache (sin degradar).
      console.warn('[guard.js] No se pudo validar la sesión en el backend:', err.message);
    }

    // Falla total de ambas fuentes: último recurso = rol cacheado.
    if (!rol) rol = localStorage.getItem(ROLE_KEY);

    // Normalización del perfil para visualización.
    if (!perfil) {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (_) {}
      perfil = {
        id: claims.sub || (cached && cached.id) || null,
        nombre: (cached && cached.nombre) || claims.email || 'Usuario',
        rol: rol || 'cajero',
      };
    }

    // Almacenar (norma local) rol + perfil para el resto de la app.
    localStorage.setItem(ROLE_KEY, rol || 'cajero');
    localStorage.setItem(USER_KEY, JSON.stringify(perfil));

    // 3) Control de acceso por rol.
    //    Vista de gerencia (dashboard/inventario) exige rol === 'admin'.
    var esRutaAdmin = ADMIN_ROUTES.test(window.location.pathname);
    if (esRutaAdmin && rol !== 'admin') {
      window.location.replace('pos.html');
      return;
    }

    // 4 & 5) Header + logout.
    injectHeader(perfil);
    bindLogout();

    resolveReady(perfil);
  })();
})();
