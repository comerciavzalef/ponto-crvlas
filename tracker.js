/**
 * ============================================================================
 * GOD MODE TRACKER — Telemetria/Observabilidade para PWAs
 * ============================================================================
 * Responsabilidades:
 *  - Reportar login/logout/falha de auth
 *  - Heartbeat de sessão a cada 30s (com pausa em idle)
 *  - Capturar erros não tratados (window.onerror + unhandledrejection)
 *  - Watchdog: detecta travamento real da thread principal
 *  - Encerra sessão graciosamente ao fechar aba
 *
 * Princípios:
 *  - NUNCA quebra produção (fail silently)
 *  - NUNCA bloqueia UI
 *  - Persiste sessionId no localStorage
 *  - Ignora falsos positivos (aba oculta, throttle do Chrome)
 * ============================================================================
 */
(function (global) {
  'use strict';

  // ============================================================================
  // CONFIG
  // ============================================================================
  const URL_CENTRAL = 'https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P1kTaBATNpAV13KV9OgNYPx/exec';
  const API_KEY = 'ee91297b-685b-4ae4-b131-8434841c882e';
  const HEARTBEAT_INTERVAL_MS = 30000;
  const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
  const SESSION_KEY = '__godmode_session_id';
  const LOG_PREFIX = '[GodMode]';

  // Watchdog config
  const WATCHDOG = {
    HEARTBEAT_INTERVAL_MS: 2000,   // pulso a cada 2s
    CHECK_INTERVAL_MS: 2000,       // worker checa a cada 2s
    TIMEOUT_MS: 8000,              // 8s sem pulso = travado
    MAX_TIMEOUT_MS: 30000,         // >30s = throttle do Chrome, ignora
    COOLDOWN_MS: 5 * 60 * 1000     // 5 min entre alertas
  };

  // ============================================================================
  // ESTADO INTERNO
  // ============================================================================
  let initialized = false;
  let isLoggedIn = false;
  let idCliente = null;
  let aplicativo = null;
  let usuario = null;
  let dispositivo = null;
  let sessionId = null;
  let heartbeatTimer = null;
  let heartbeatPaused = false;
  let lastActivity = Date.now();
  let isIdle = false;

  // Estado do Watchdog
  let wdLastPulse = Date.now();
  let wdAlertSent = false;
  let wdWorker = null;
  let wdPulseTimer = null;

  // ============================================================================
  // UTILS
  // ============================================================================
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function detectDevice() {
    const ua = navigator.userAgent;
    let os = 'Desconhecido';
    let browser = 'Desconhecido';

    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Mac/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    if (/Edg/i.test(ua)) browser = 'Edge';
    else if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Safari/i.test(ua)) browser = 'Safari';

    return os + ' · ' + browser;
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function send(payload) {
    try {
      fetch(URL_CENTRAL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(err => warn('Falha ao enviar payload:', err.message));
    } catch (e) {
      warn('Erro ao enviar:', e.message);
    }
  }

  function sendBeacon(payload) {
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'text/plain;charset=utf-8' });
      navigator.sendBeacon(URL_CENTRAL, blob);
    } catch (e) {
      warn('Erro no beacon:', e.message);
    }
  }

  // ============================================================================
  // SESSÃO
  // ============================================================================
  function getOrCreateSessionId() {
    try {
      let id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (_) {
      return uuid();
    }
  }

  function clearSessionId() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  // ============================================================================
  // HEARTBEAT
  // ============================================================================
  function startHeartbeat() {
    stopHeartbeat();
    pingHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!heartbeatPaused && !isIdle) pingHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function pingHeartbeat() {
    if (!isLoggedIn || !sessionId) return;
    send({
      apiKey: API_KEY,
      action: 'heartbeat',
      idCliente: idCliente,
      aplicativo: aplicativo,
      usuario: usuario,
      dispositivo: dispositivo,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });
  }

  // ============================================================================
  // IDLE DETECTION
  // ============================================================================
  function bindActivityListeners() {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(ev => {
      global.addEventListener(ev, () => {
        lastActivity = Date.now();
        if (isIdle) {
          isIdle = false;
          if (isLoggedIn) startHeartbeat();
        }
      }, { passive: true });
    });

    setInterval(() => {
      if (Date.now() - lastActivity > IDLE_THRESHOLD_MS) {
        isIdle = true;
      }
    }, 60000);
  }

  // ============================================================================
  // ERROR CAPTURE
  // ============================================================================
  function bindGlobalErrorHandlers() {
    global.addEventListener('error', (ev) => {
      api.log({
        tipo: 'ERRO',
        mensagem: '[JS Error] ' + (ev.message || 'sem mensagem') +
                  ' @ ' + (ev.filename || '?') + ':' + (ev.lineno || '?')
      });
    });

    global.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason);
      api.log({
        tipo: 'ERRO',
        mensagem: '[Promise Rejection] ' + reason
      });
    });
  }

  // ============================================================================
  // UNLOAD HANDLER
  // ============================================================================
  function bindUnloadHandlers() {
    global.addEventListener('pagehide', () => {
      if (isLoggedIn && sessionId) {
        sendBeacon({
          apiKey: API_KEY,
          action: 'endSession',
          idCliente: idCliente,
          aplicativo: aplicativo,
          usuario: usuario,
          sessionId: sessionId,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  // ============================================================================
  // VISIBILITY HANDLER (pausa heartbeat e watchdog quando aba some)
  // ============================================================================
  function bindVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Aba oculta: pausa heartbeat e reseta pulso do watchdog
        heartbeatPaused = true;
        wdLastPulse = Date.now();
      } else {
        // Aba voltou: retoma heartbeat e reseta pulso
        heartbeatPaused = false;
        wdLastPulse = Date.now();
        if (isLoggedIn) pingHeartbeat();
      }
    });
  }

  // ============================================================================
  // WATCHDOG — Detecta travamento REAL da thread principal
  // ============================================================================
  function startWatchdog() {
    if (wdWorker) return;

    // Pulso na thread principal
    wdPulseTimer = setInterval(() => {
      wdLastPulse = Date.now();
    }, WATCHDOG.HEARTBEAT_INTERVAL_MS);

    try {
      const workerCode = `
        setInterval(() => self.postMessage('check'), ${WATCHDOG.CHECK_INTERVAL_MS});
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      wdWorker = new Worker(URL.createObjectURL(blob));

      wdWorker.onmessage = () => {
        // 🛡️ PROTEÇÃO 1: Se aba está oculta, ignora (Chrome throttla timers)
        if (document.hidden) {
          wdLastPulse = Date.now();
          return;
        }

        const silentFor = Date.now() - wdLastPulse;

        // 🛡️ PROTEÇÃO 2: Se passou MUITO tempo (>30s), foi throttle do navegador,
        // não travamento real. Reseta sem alertar.
        if (silentFor > WATCHDOG.MAX_TIMEOUT_MS) {
          wdLastPulse = Date.now();
          return;
        }

        // 🚨 Travamento real: 8s a 30s sem pulso COM aba visível
        if (silentFor > WATCHDOG.TIMEOUT_MS && !wdAlertSent) {
          wdAlertSent = true;
          warn(`Watchdog detectou travamento de ${Math.round(silentFor/1000)}s`);
          api.log({
            tipo: 'ERRO',
            mensagem: `[WATCHDOG] Thread principal travada por ${Math.round(silentFor/1000)}s. URL: ${global.location.href}`
          });
          setTimeout(() => { wdAlertSent = false; }, WATCHDOG.COOLDOWN_MS);
        }
      };
    } catch (e) {
      warn('Watchdog não pôde iniciar Worker:', e.message);
    }
  }

  function stopWatchdog() {
    if (wdPulseTimer) { clearInterval(wdPulseTimer); wdPulseTimer = null; }
    if (wdWorker) { wdWorker.terminate(); wdWorker = null; }
  }

  // ============================================================================
  // API PÚBLICA
  // ============================================================================
  const api = {
    init: function (cfg) {
      if (initialized) return;
      initialized = true;
      idCliente = (cfg && cfg.idCliente) || 'desconhecido';
      aplicativo = (cfg && cfg.aplicativo) || 'desconhecido';
      dispositivo = detectDevice();

      bindActivityListeners();
      bindGlobalErrorHandlers();
      bindUnloadHandlers();
      bindVisibilityHandler();
      startWatchdog();

      console.log(LOG_PREFIX, 'Tracker iniciado:', { idCliente, aplicativo, dispositivo });
    },

    loginSuccess: function (data) {
      if (!initialized) { warn('init() não foi chamado'); return; }
      usuario = (data && data.usuario) || 'anônimo';
      if (data && data.dispositivo) dispositivo = data.dispositivo;
      sessionId = getOrCreateSessionId();
      isLoggedIn = true;

      send({
        apiKey: API_KEY,
        action: 'authEvent',
        idCliente: idCliente,
        aplicativo: aplicativo,
        usuario: usuario,
        dispositivo: dispositivo,
        sessionId: sessionId,
        evento: 'LOGIN_SUCESSO',
        timestamp: new Date().toISOString()
      });

      startHeartbeat();
    },

    loginFailure: function (data) {
      if (!initialized) { warn('init() não foi chamado'); return; }
      send({
        apiKey: API_KEY,
        action: 'authEvent',
        idCliente: idCliente,
        aplicativo: aplicativo,
        usuario: (data && data.usuario) || 'anônimo',
        dispositivo: (data && data.dispositivo) || dispositivo,
        evento: 'LOGIN_FALHA',
        motivo: (data && data.motivo) || 'desconhecido',
        timestamp: new Date().toISOString()
      });
    },

    logout: function () {
      if (!isLoggedIn) return;
      send({
        apiKey: API_KEY,
        action: 'endSession',
        idCliente: idCliente,
        aplicativo: aplicativo,
        usuario: usuario,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      });
      stopHeartbeat();
      clearSessionId();
      isLoggedIn = false;
      sessionId = null;
      usuario = null;
    },

    log: function (data) {
      if (!initialized) { warn('init() não foi chamado'); return; }
      send({
        apiKey: API_KEY,
        action: 'logEvent',
        idCliente: idCliente,
        aplicativo: aplicativo,
        usuario: usuario || 'anônimo',
        dispositivo: dispositivo,
        tipoLog: (data && data.tipo) || 'INFO',
        mensagemErro: (data && data.mensagem) || '',
        timestamp: new Date().toISOString()
      });
    },

    // Utilitários de debug
    _debugPing: function () {
      pingHeartbeat();
      console.log(LOG_PREFIX, 'Ping de debug enviado');
    },

    _debugWatchdogTest: function () {
      console.warn(LOG_PREFIX, 'Travando thread principal por 9s...');
      const start = Date.now();
      while (Date.now() - start < 9000) { /* trava de propósito */ }
      console.warn(LOG_PREFIX, 'Thread liberada. Aguarde alerta em ~5s.');
    },

    _pauseHeartbeat: function () { heartbeatPaused = true; },
    _resumeHeartbeat: function () { heartbeatPaused = false; }
  };

  global.GodModeTracker = api;
})(window);
