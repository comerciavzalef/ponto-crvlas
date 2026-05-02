/**
 * ============================================================================
 *  GOD MODE TRACKER — Cliente de Telemetria para PWAs
 *  Vanilla JS | Zero dependências | Fire-and-forget
 *  ----------------------------------------------------------------------------
 *  Responsabilidades:
 *    - Reportar login/logout/falha de auth
 *    - Manter heartbeat de sessão ativa (30s, com pausa por inatividade)
 *    - Capturar erros não tratados e enviar como log
 *    - Encerrar sessão graciosamente no fechamento da aba
 *    - WATCHDOG: detectar travamentos da thread principal (loops infinitos)
 *
 *  Princípios:
 *    - Nunca quebrar o app de produção
 *    - Nunca bloquear UI
 *    - Sempre falhar silenciosamente
 *    - Persistir sessionId entre reloads (localStorage)
 * ============================================================================
 */

(function (global) {
  'use strict';

  // ==========================================================================
  // CONFIGURAÇÃO INTERNA
  // ==========================================================================
  const CONFIG = {
    URL_CENTRAL: 'https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P1kTaBATNpAV13KV9OgNYPx/exec',
    API_KEY:     'ee91297b-685b-4ae4-b131-8434841c882e',

    // Heartbeat: enviar ping a cada N ms enquanto o usuário estiver ativo
    HEARTBEAT_INTERVAL_MS: 30000,

    // Inatividade: se o usuário não interagir por N ms, pausa o heartbeat
    IDLE_THRESHOLD_MS: 5 * 60 * 1000,  // 5 minutos

    // Storage key do sessionId (sobrevive F5)
    SESSION_KEY: '__godmode_session_id',

    // Prefix dos logs internos do tracker (filtrável no DevTools)
    LOG_PREFIX: '[GodMode]'
  };

  // ==========================================================================
  // ESTADO INTERNO
  // ==========================================================================
  const state = {
    initialized:  false,
    loggedIn:     false,

    // Contexto do tenant (vem do init)
    idCliente:    null,
    aplicativo:   null,

    // Contexto do usuário (vem do loginSuccess)
    usuario:      null,
    dispositivo:  null,
    sessionId:    null,

    // Controle de heartbeat
    heartbeatTimer: null,
    lastActivity:   Date.now(),
    isIdle:         false
  };

  // ==========================================================================
  // UTILS
  // ==========================================================================
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // Fallback: pseudo-UUID v4 (suficiente como sessionId, não é criptográfico)
    return 'sid-xxxxxxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  function detectDevice() {
    try {
      const ua = navigator.userAgent || '';
      const platform = navigator.platform || '';
      const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
      let browser = 'Browser';
      if (/Edg\//.test(ua))      browser = 'Edge';
      else if (/Chrome\//.test(ua)) browser = 'Chrome';
      else if (/Firefox\//.test(ua)) browser = 'Firefox';
      else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

      let os = platform;
      if (/Android/.test(ua)) os = 'Android';
      else if (/iPhone|iPad/.test(ua)) os = 'iOS';
      else if (/Win/.test(platform)) os = 'Windows';
      else if (/Mac/.test(platform)) os = 'macOS';
      else if (/Linux/.test(platform)) os = 'Linux';

      return `${os} · ${browser}${mobile ? ' (mobile)' : ''}`;
    } catch (e) {
      return 'unknown';
    }
  }

  function warn(...args) {
    try { console.warn(CONFIG.LOG_PREFIX, ...args); } catch (e) {}
  }

  /**
   * POST fire-and-forget — nunca rejeita, nunca bloqueia o app.
   */
  function send(payload) {
    if (!CONFIG.URL_CENTRAL || CONFIG.URL_CENTRAL.startsWith('COLE_')) {
      warn('URL_CENTRAL não configurada. Telemetria desabilitada.');
      return Promise.resolve();
    }
    return fetch(CONFIG.URL_CENTRAL, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        apiKey: CONFIG.API_KEY,
        ...payload
      })
    }).catch(err => {
      warn('Falha ao enviar telemetria:', err.message);
    });
  }

  /**
   * Variante para `beforeunload` — usa sendBeacon.
   */
  function sendBeacon(payload) {
    try {
      if (!navigator.sendBeacon) return false;
      const blob = new Blob([JSON.stringify({
        apiKey: CONFIG.API_KEY,
        ...payload
      })], { type: 'text/plain;charset=utf-8' });
      return navigator.sendBeacon(CONFIG.URL_CENTRAL, blob);
    } catch (e) {
      return false;
    }
  }

  // ==========================================================================
  // SESSION ID (persistente entre reloads)
  // ==========================================================================
  function getOrCreateSessionId() {
    try {
      let id = localStorage.getItem(CONFIG.SESSION_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(CONFIG.SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      return uuid();
    }
  }

  function clearSessionId() {
    try { localStorage.removeItem(CONFIG.SESSION_KEY); } catch (e) {}
  }

  // ==========================================================================
  // HEARTBEAT
  // ==========================================================================
  function startHeartbeat() {
    if (state.heartbeatTimer) return;
    pingHeartbeat();
    state.heartbeatTimer = setInterval(() => {
      if (state.isIdle) return;
      pingHeartbeat();
    }, CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  function pingHeartbeat() {
    if (!state.loggedIn || !state.sessionId) return;
    send({
      action:      'heartbeat',
      sessionId:   state.sessionId,
      idCliente:   state.idCliente,
      aplicativo:  state.aplicativo,
      usuario:     state.usuario,
      dispositivo: state.dispositivo
    });
  }

  // ==========================================================================
  // DETECÇÃO DE INATIVIDADE
  // ==========================================================================
  function bindActivityListeners() {
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    const onActivity = () => {
      state.lastActivity = Date.now();
      if (state.isIdle) {
        state.isIdle = false;
        if (state.loggedIn) pingHeartbeat();
      }
    };
    events.forEach(ev => global.addEventListener(ev, onActivity, { passive: true }));

    setInterval(() => {
      const idleFor = Date.now() - state.lastActivity;
      if (idleFor > CONFIG.IDLE_THRESHOLD_MS && !state.isIdle) {
        state.isIdle = true;
      }
    }, CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  // ==========================================================================
  // CAPTURA AUTOMÁTICA DE ERROS NÃO TRATADOS
  // ==========================================================================
  function bindGlobalErrorHandlers() {
    global.addEventListener('error', (ev) => {
      const msg = ev.error
        ? `${ev.error.message || ev.message}\n${ev.error.stack || ''}`
        : `${ev.message || 'Erro desconhecido'} (${ev.filename}:${ev.lineno}:${ev.colno})`;
      api.log({ tipo: 'ERRO', mensagem: msg });
    });

    global.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason;
      const msg = reason
        ? (reason.stack || reason.message || String(reason))
        : 'Promise rejeitada sem motivo';
      api.log({ tipo: 'ERRO', mensagem: `[unhandledrejection] ${msg}` });
    });
  }

  // ==========================================================================
  // ENCERRAMENTO GRACIOSO NO UNLOAD
  // ==========================================================================
  function bindUnloadHandlers() {
    const onUnload = () => {
      if (!state.loggedIn || !state.sessionId) return;
      sendBeacon({
        action:    'endSession',
        sessionId: state.sessionId
      });
    };
    global.addEventListener('pagehide', onUnload);
  }

  // ==========================================================================
  // WATCHDOG — Detecta travamentos da thread principal
  // ----------------------------------------------------------------------------
  // Como funciona:
  //   1. Thread principal "pulsa" a cada 2s (atualiza wdLastPulse).
  //   2. Um Web Worker em thread SEPARADA verifica a cada 2s.
  //   3. Se a thread principal ficar 8s sem pulsar, está travada (loop infinito,
  //      cálculo síncrono pesado, etc).
  //   4. O worker dispara um api.log() de ERRO pra Central via fetch interno.
  //   5. Cooldown de 5min para evitar flood se o app destravar e travar de novo.
  //
  // Limitação: NÃO detecta loops assíncronos (Promise.then() infinito, p.ex.).
  //            Para esses casos, o erro vem do bindGlobalErrorHandlers ou de
  //            timeout na própria função.
  // ==========================================================================
  const WATCHDOG = {
    HEARTBEAT_INTERVAL_MS: 2000,
    CHECK_INTERVAL_MS:     2000,
    TIMEOUT_MS:            8000,
    COOLDOWN_MS:           5 * 60 * 1000
  };

  let wdLastPulse  = Date.now();
  let wdAlertSent  = false;
  let wdWorker     = null;
  let wdPulseTimer = null;

  function startWatchdog() {
    if (wdWorker) return;

    // 1) Pulso da thread principal — se travar, esse setInterval para de rodar
    wdPulseTimer = setInterval(() => {
      wdLastPulse = Date.now();
    }, WATCHDOG.HEARTBEAT_INTERVAL_MS);

    // 2) Worker em thread separada — verifica se a principal continua pulsando
    try {
      const workerCode = `
        setInterval(() => self.postMessage('check'), ${WATCHDOG.CHECK_INTERVAL_MS});
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      wdWorker = new Worker(URL.createObjectURL(blob));

      wdWorker.onmessage = () => {
        const silentFor = Date.now() - wdLastPulse;
        if (silentFor > WATCHDOG.TIMEOUT_MS && !wdAlertSent) {
          wdAlertSent = true;
          warn(`Watchdog detectou travamento de ${Math.round(silentFor / 1000)}s`);

          api.log({
            tipo: 'ERRO',
            mensagem:
              `[WATCHDOG] Thread principal travada por ${Math.round(silentFor / 1000)}s. ` +
              `Possível loop infinito ou bloqueio síncrono. ` +
              `URL: ${global.location.href}`
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
    if (wdWorker)     { wdWorker.terminate();        wdWorker     = null; }
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================
  const api = {
    /**
     * Inicializa o tracker. Chamar UMA vez no boot do app.
     */
    init({ idCliente, aplicativo }) {
      if (state.initialized) {
        warn('Tracker já inicializado — ignorando init duplicado.');
        return;
      }
      if (!idCliente || !aplicativo) {
        warn('init() exige { idCliente, aplicativo }.');
        return;
      }

      state.idCliente   = String(idCliente).trim();
      state.aplicativo  = String(aplicativo).trim();
      state.dispositivo = detectDevice();
      state.initialized = true;

      bindActivityListeners();
      bindGlobalErrorHandlers();
      bindUnloadHandlers();
      startWatchdog();   // ← Watchdog ligado já no boot
    },

    /**
     * Reporta login bem-sucedido.
     */
    loginSuccess({ usuario, dispositivo }) {
      if (!state.initialized) {
        warn('Chame init() antes de loginSuccess().');
        return;
      }
      state.usuario     = String(usuario || 'desconhecido').trim();
      state.dispositivo = dispositivo ? String(dispositivo).trim() : state.dispositivo;
      state.sessionId   = getOrCreateSessionId();
      state.loggedIn    = true;
      state.lastActivity = Date.now();
      state.isIdle      = false;

      send({
        action:      'authEvent',
        idCliente:   state.idCliente,
        aplicativo:  state.aplicativo,
        usuario:     state.usuario,
        dispositivo: state.dispositivo,
        tipoEvento:  'LOGIN_SUCESSO',
        detalhes:    'Login bem-sucedido'
      });

      startHeartbeat();
    },

    /**
     * Reporta tentativa de login falhada.
     */
    loginFailure({ usuario, motivo, dispositivo }) {
      if (!state.initialized) {
        warn('Chame init() antes de loginFailure().');
        return;
      }
      send({
        action:      'authEvent',
        idCliente:   state.idCliente,
        aplicativo:  state.aplicativo,
        usuario:     String(usuario || 'desconhecido').trim(),
        dispositivo: dispositivo ? String(dispositivo).trim() : state.dispositivo,
        tipoEvento:  'LOGIN_FALHA',
        detalhes:    String(motivo || 'Credenciais inválidas')
      });
    },

    /**
     * Logout explícito.
     * Nota: o Watchdog NÃO é parado — continua útil mesmo na tela de login.
     */
    logout() {
      if (!state.loggedIn || !state.sessionId) return;

      send({
        action:    'endSession',
        sessionId: state.sessionId
      });

      stopHeartbeat();
      clearSessionId();

      state.loggedIn  = false;
      state.usuario   = null;
      state.sessionId = null;
    },

    /**
     * Log manual (opcional).
     * Use para INFO/ALERTA específicos ou para registrar erros tratados
     * que você quer visibilidade na Central.
     */
    log({ tipo, mensagem }) {
      if (!state.initialized) {
        warn('Chame init() antes de log().');
        return;
      }
      send({
        action:       'log',
        idCliente:    state.idCliente,
        aplicativo:   state.aplicativo,
        usuario:      state.usuario || 'anônimo',
        dispositivo:  state.dispositivo,
        tipoLog:      String(tipo || 'INFO').toUpperCase(),
        mensagemErro: String(mensagem || '')
      });
    },

    /**
     * Atalho de debug — útil para validar que a configuração está OK.
     */
    _debugPing() {
      send({
        action:       'log',
        idCliente:    state.idCliente || 'debug',
        aplicativo:   state.aplicativo || 'debug',
        usuario:      'debug-tracker',
        dispositivo:  state.dispositivo || detectDevice(),
        tipoLog:      'INFO',
        mensagemErro: 'Ping de debug do tracker'
      }).then(() => warn('Debug ping enviado.'));
    },

    /**
     * Atalho para forçar disparo do watchdog em ambiente de teste.
     * Use no console do DevTools: GodModeTracker._debugWatchdogTest()
     * (ATENÇÃO: trava o navegador por 9s.)
     */
    _debugWatchdogTest() {
      warn('Travando thread principal por 9s para testar watchdog...');
      const start = Date.now();
      while (Date.now() - start < 9000) { /* trava de propósito */ }
      warn('Thread liberada. Confira o God Mode em ~10s.');
    }
  };

  // Expõe globalmente
  global.GodModeTracker = api;

})(window);
