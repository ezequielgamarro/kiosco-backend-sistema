/**
 * config.js — Configuración del frontend del Punto de Venta.
 *
 * Cargado como SCRIPT GLOBAL (no módulo) ANTES que `auth.js` y `guard.js`.
 * Ya NO depende de Supabase: la aplicación se conecta al backend **local**
 * FastAPI + SQLite (servido en http://127.0.0.1:8000).
 *
 * Expone en `window`:
 *   - window.API_BASE_URL  : base de la REST API (prefijo /api).
 */
(function () {
  'use strict';

  // ============================================================
  // URL BASE DE LA API LOCAL
  // El backend FastAPI corre en el host local de la aplicación de
  // escritorio (empacada con PyInstaller). `http://127.0.0.1:8000/api`
  // apunta a la API respetando el `API_PREFIX` configurado en el backend.
  //
  // En un entorno empaquetado, este host:puerto debe coincidir con el
  // puerto que escucha el ejecutable.
  // ============================================================
  const API_BASE_URL = 'http://127.0.0.1:8000/api';

  window.API_BASE_URL = API_BASE_URL;
})();
