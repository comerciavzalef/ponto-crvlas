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
      // Versão compacta — não a UA inteira (que é poluição visual no painel)
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
   * Em caso de falha de rede, loga warning no console e segue a vida.
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
   * Variante que funciona durante `beforeunload`. `fetch` normal é cancelado
   * quando a aba fecha; `sendBeacon` é a única API garantida.
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
      // localStorage bloqueado (modo privado em alguns navegadores)
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
    // Primeiro ping imediato — para a Central já ver "online" sem esperar 30s
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
        // Volta da inatividade — pinga imediato pra a Central marcar online
        if (state.loggedIn) pingHeartbeat();
      }
    };
    events.forEach(ev => global.addEventListener(ev, onActivity, { passive: true }));

    // Verificador de inatividade — checa a cada 30s se passou do threshold
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
      // sendBeacon é a única forma confiável durante unload
      sendBeacon({
        action:    'endSession',
        sessionId: state.sessionId
      });
    };

    // pagehide cobre fechar aba, navegação, mobile background — mais robusto
    global.addEventListener('pagehide', onUnload);
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================
  const api = {
    /**
     * Inicializa o tracker. Chamar UMA vez no boot do app.
     * Não dispara nada ainda — apenas guarda contexto e prepara handlers globais.
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

      // Se o usuário estava logado em sessão anterior (F5 não desloga),
      // recupera o sessionId. Mas só vai virar "online" quando loginSuccess for chamado
      // OU quando o app explicitamente chamar resumeSession (caso queira retomar).
    },

    /**
     * Reporta login bem-sucedido.
     * Chame após o app validar credenciais com sucesso.
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

      // Registra evento de auth
      send({
        action:      'authEvent',
        idCliente:   state.idCliente,
        aplicativo:  state.aplicativo,
        usuario:     state.usuario,
        dispositivo: state.dispositivo,
        tipoEvento:  'LOGIN_SUCESSO',
        detalhes:    'Login bem-sucedido'
      });

      // Inicia heartbeat
      startHeartbeat();
    },

    /**
     * Reporta tentativa de login falhada.
     * Chame quando o usuário errou senha, conta inexistente, etc.
     * NÃO inicia sessão — só registra o evento.
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
     * Encerra a sessão na Central e limpa estado local.
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
     *
     * Exemplo:
     *   GodModeTracker.log({ tipo: 'INFO', mensagem: 'Backup local realizado' });
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
     * Atalho de debug — útil para validar que a configuração está OK
     * sem precisar fazer login. Chame no console do DevTools.
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
    }
  };

  // Expõe globalmente
  global.GodModeTracker = api;

})(window);

// ============================================================================
// WATCHDOG — Detecta travamentos/loops e reporta ao God Mode
// ============================================================================
(function setupWatchdog() {
  const WATCHDOG_TIMEOUT = 8000; // 8 segundos sem "heartbeat" = travado
  const HEARTBEAT_INTERVAL = 2000; // pulso a cada 2s
  let lastHeartbeat = Date.now();
  let alertaJaEnviado = false;

  // 1) Heartbeat: a cada 2s, marca que a thread principal está viva
  setInterval(() => {
    lastHeartbeat = Date.now();
  }, HEARTBEAT_INTERVAL);

  // 2) Detector via Web Worker (thread separada, não trava com a principal)
  const watchdogCode = `
    setInterval(() => {
      self.postMessage('check');
    }, 2000);
  `;
  const blob = new Blob([watchdogCode], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(blob));

  worker.onmessage = () => {
    const tempoSemPulso = Date.now() - lastHeartbeat;
    if (tempoSemPulso > WATCHDOG_TIMEOUT && !alertaJaEnviado) {
      alertaJaEnviado = true;
      console.error('[Watchdog] Thread principal travada há', tempoSemPulso, 'ms');
      // Envia via worker (thread independente) porque a principal está travada
      enviarAlertaWatchdog(tempoSemPulso);
    }
  };

  function enviarAlertaWatchdog(tempoMs) {
    // Usa fetch via Worker se possível, senão tenta na thread principal mesmo
    const payload = {
      apiKey: 'ee91297b-685b-4ae4-b131-8434841c882e',
      action: 'logEvent',
      idCliente: 'crv', // ou pegar do localStorage
      aplicativo: 'Ponto Digital',
      tipoLog: 'ERRO',
      usuario: localStorage.getItem('ponto.usuario') || 'desconhecido',
      dispositivo: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
      mensagemErro: `WATCHDOG: thread principal travada há ${Math.round(tempoMs/1000)}s. Possível loop infinito.`,
      timestamp: new Date().toISOString()
    };
    fetch('https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P1kTaBATNpAV13KV9OgNYPx/exec', {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      keepalive: true // garante envio mesmo se a página fechar
    }).catch(err => console.warn('[Watchdog] Falha ao enviar alerta:', err));
  }
})();
