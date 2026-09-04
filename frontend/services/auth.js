/**
 * auth.js — Autenticación local contra FastAPI (JWT).
 *
 * Script GLOBAL (no módulo) cargado en `login.html` DESPUÉS de `config.js`.
 * Reemplaza por completo la integración de Supabase Auth (público).
 *
 * No usa tokens de Supabase: se conecta al backend **local** FastAPI y usa
 * el token JWT HS256 que este devuelve.
 *
 * Expone en `window`:
 *   - authAPI = { getToken, setToken, clearSession, login, logout, fetchProfile }
 *   - loginEmail(email, password)  (compatibilidad con <form> de login.html)
 *   - logout()
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'token';
  var USER_KEY = 'user';

  function apiBase() {
    return window.API_BASE_URL || 'http://127.0.0.1:8000/api';
  }
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('rol');
  }

  /**
   * Consulta el perfil al backend con el token. Guarda y devuelve el perfil.
   * @returns {Promise<object|null>} { id, email, nombre, rol }
   */
  async function fetchProfile() {
    var token = getToken();
    if (!token) return null;
    try {
      var res = await fetch(apiBase() + '/auth/perfil', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) clearSession();
        return null;
      }
      var perfil = await res.json();
      localStorage.setItem(USER_KEY, JSON.stringify(perfil));
      localStorage.setItem('rol', perfil.rol || 'cajero');
      return perfil;
    } catch (err) {
      console.warn('[auth.js] No se pudo obtener el perfil:', err.message);
      return null;
    }
  }

  /**
   * Login local (formato OAuth2 urlencoded).
   * Guarda el access_token y devuelve el perfil.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<object|null>}
   */
  async function login(email, password) {
    var body = new URLSearchParams();
    body.set('username', email);
    body.set('password', password);

    var res = await fetch(apiBase() + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      var detail = 'Credenciales incorrectas';
      try { var b = await res.json(); if (b && b.detail) detail = b.detail; } catch (_) {}
      var err = new Error(detail);
      err.status = res.status;
      throw err;
    }

    var data = await res.json();
    if (!data || !data.access_token) {
      throw new Error('El servidor no devolvió un token de acceso');
    }
    setToken(data.access_token);
    return await fetchProfile();
  }

  function logout() {
    clearSession();
    if (window.location.pathname.indexOf('login.html') === -1) {
      window.location.replace('login.html');
    }
  }

  // Compatibilidad con `loginEmail` (login.html/register.html)
  async function loginEmail(email, password) {
    return await login(email, password);
  }

  // ---------------- Enlazar formularios ----------------
  function showError(msg) {
    var el = document.getElementById('login-error') || document.getElementById('register-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
    else alert(msg);
  }

  function setBusy(btn, busy, texto) {
    if (!btn) return;
    if (busy) {
      btn.dataset.original = btn.textContent;
      btn.disabled = true;
      btn.textContent = texto || 'Procesando...';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.original || texto;
    }
  }

  function enlazarLogin() {
    var form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var email = (document.getElementById('login-email') || {}).value || '';
      var password = (document.getElementById('login-password') || {}).value || '';

      var errEl = document.getElementById('login-error');
      if (errEl) errEl.classList.add('hidden');
      if (!email || !password) return showError('Ingresa tu correo y contraseña');

      setBusy(btn, true, 'Ingresando...');
      try {
        var perfil = await login(email.trim(), password);
        window.location.href = perfil && perfil.rol === 'admin' ? 'dashboard.html' : 'pos.html';
      } catch (err) {
        showError(err.message || 'No se pudo iniciar sesión');
        setBusy(btn, false, 'Iniciar Sesión');
      }
    });
  }

  function enlazarRegistro() {
    var form = document.getElementById('register-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      showError('El alta de usuarios se gestiona en el backend local (tabla usuarios).');
    });
  }

  // Scripts al final de <body>: DOM listo; enlazar ya (idempotente por elemento).
  function enlazar() { enlazarLogin(); enlazarRegistro(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enlazar);
  else enlazar();

  // API global
  window.authAPI = {
    getToken: getToken,
    setToken: setToken,
    clearSession: clearSession,
    fetchProfile: fetchProfile,
    login: login,
    logout: logout,
  };
  window.loginEmail = loginEmail;
  window.logout = logout;

  // OAuth (Supabase) eliminado: no hay proveedor externo en el build local.
  window.loginGoogle = function () {
    if (typeof alert === 'function') {
      alert('El acceso con Google ya no está disponible. Usa correo y contraseña.');
    }
  };
})();
