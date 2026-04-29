// ══════════════════════════════════════════════════════════════
//  PONTO DIGITAL — app.js v5.1
//  Grupo Carlos Vaz — CRV/LAS
//  Login · Câmera · GPS · Registro · Painel Gestor · Relatório
// ══════════════════════════════════════════════════════════════

// ── Config ───────────────────────────────────────────────────
var API_URL = 'https://script.google.com/macros/s/AKfycbzXuhmVkTDsMGotRuG3-i-YYnx0_nLFWDWjb7hNsTZ2HUg5SzWKDK6jbad_HqOEsnxt/exec';
var SESSION_KEY = 'cv_ponto_sessao';
var RAIO_LIMITE = 50;
var LAT_EMPRESA = -14.842472;
var LNG_EMPRESA = -39.987250;

var CREDS_OFFLINE = {
  'LUCAS':  'lucas2026',
  'TASSIO': 'tassio2026',
  'AMARAL': 'amaral2026',
  'ALEX':   'alex2026',
  'ALEF':   'GP.Carlos2026'
};

// ── State ────────────────────────────────────────────────────
var sessao = null;
var tipoSelecionado = '';
var selfieData = '';
var geoAtual = { lat: 0, lng: 0, dist: null, dentro: false };
var refreshInterval = null;
var stream = null;

// ══════════════════════════════════════════════════════════════
//  INIT — verifica sessão salva
// ══════════════════════════════════════════════════════════════
(function () {
  var s = localStorage.getItem(SESSION_KEY);
  if (s) {
    try {
      sessao = JSON.parse(s);
      if (sessao && sessao.nome) {
        esconderLogin();
        iniciarApp();
        return;
      }
    } catch (e) { /* ignora */ }
  }
})();

// ══════════════════════════════════════════════════════════════
//  TOGGLE SENHA (olhinho)
// ══════════════════════════════════════════════════════════════
function toggleSenha() {
  var input = document.getElementById('loginPass');
  var icon = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = '🙈';
  } else {
    input.type = 'password';
    icon.textContent = '👁️';
  }
}

// ══════════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════════
function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim();
  var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');

  err.textContent = '';
  if (!user || !pass) {
    err.textContent = 'Preencha todos os campos';
    shakeLogin();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verificando...';

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ acao: 'login', usuario: user, senha: pass }),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        sessao = { nome: d.nome, nivel: d.nivel, senha: pass };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
        esconderLogin();
        iniciarApp();
      } else {
        err.textContent = d.msg || 'Credenciais inválidas';
        shakeLogin();
      }
    })
    .catch(function () {
      // Fallback offline
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === pass) {
        sessao = {
          nome: user,
          nivel: user === 'ALEF' ? 'gestor' : 'funcionario',
          senha: pass
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
        esconderLogin();
        iniciarApp();
      } else {
        err.textContent = 'Sem conexão e credenciais inválidas';
        shakeLogin();
      }
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
}

function shakeLogin() {
  var c = document.querySelector('.login-card');
  c.classList.add('shake');
  setTimeout(function () { c.classList.remove('shake'); }, 500);
}

function esconderLogin() {
  document.getElementById('loginScreen').classList.add('hidden');
}

function logout() {
  sessao = null;
  localStorage.removeItem(SESSION_KEY);
  if (refreshInterval) clearInterval(refreshInterval);
  stopCamera();
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginPass').type = 'password';
  document.getElementById('eyeIcon').textContent = '👁️';
  document.getElementById('loginError').textContent = '';
}

// Enter no campo de senha
document.addEventListener('DOMContentLoaded', function () {
  var passField = document.getElementById('loginPass');
  if (passField) {
    passField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') fazerLogin();
    });
  }
});

// ══════════════════════════════════════════════════════════════
//  APP INIT
// ══════════════════════════════════════════════════════════════
function iniciarApp() {
  document.getElementById('ldScreen').classList.remove('hidden');
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('userBadge').textContent = sessao.nome;

  var isGestor = sessao.nivel === 'gestor';

  if (isGestor) {
    document.getElementById('badgeGestor').style.display = '';
    document.getElementById('gestorSection').classList.add('show');
    document.getElementById('cardPresentes').style.display = '';
    document.getElementById('cardAlertas').style.display = '';
  }

  loadSequence([
    { t: 'Autenticando...', p: 20 },
    { t: 'Iniciando câmera...', p: 50 },
    { t: 'Buscando GPS...', p: 80 },
    { t: 'Pronto!', p: 100 }
  ], function () {
    document.getElementById('ldScreen').classList.add('hidden');
    initCamera();
    initGeo();
    syncDados();
    // Auto-refresh 5 min
    refreshInterval = setInterval(function () {
      syncDados();
      if (isGestor) syncGestor();
    }, 300000);
    if (isGestor) syncGestor();
  });
}

function loadSequence(steps, cb) {
  var i = 0;
  function next() {
    if (i >= steps.length) { setTimeout(cb, 400); return; }
    document.getElementById('ldText').textContent = steps[i].t;
    document.getElementById('ldBarTop').style.width = steps[i].p + '%';
    i++;
    setTimeout(next, 500);
  }
  next();
}

// ══════════════════════════════════════════════════════════════
//  CÂMERA
// ══════════════════════════════════════════════════════════════
function initCamera() {
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: 480, height: 480 }
  })
    .then(function (s) {
      stream = s;
      document.getElementById('videoEl').srcObject = s;
    })
    .catch(function () { toast('Câmera não disponível'); });
}

function capturePhoto() {
  var v = document.getElementById('videoEl');
  var c = document.getElementById('canvasEl');
  c.width = 480; c.height = 480;
  c.getContext('2d').drawImage(v, 0, 0, 480, 480);
  selfieData = c.toDataURL('image/jpeg', 0.7);
  v.style.display = 'none';
  c.style.display = 'block';
  document.getElementById('btnCapture').style.display = 'none';
  document.getElementById('btnReset').style.display = '';
  document.getElementById('selfieOk').style.display = 'block';
  checkSubmit();
}

function resetCamera() {
  document.getElementById('videoEl').style.display = 'block';
  document.getElementById('canvasEl').style.display = 'none';
  document.getElementById('btnCapture').style.display = '';
  document.getElementById('btnReset').style.display = 'none';
  document.getElementById('selfieOk').style.display = 'none';
  selfieData = '';
  checkSubmit();
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
  }
}

// ══════════════════════════════════════════════════════════════
//  GEOLOCALIZAÇÃO
// ══════════════════════════════════════════════════════════════
function initGeo() {
  if (!navigator.geolocation) {
    updateGeoUI('GPS indisponível', 'buscando', '');
    return;
  }

  navigator.geolocation.watchPosition(
    function (pos) {
      geoAtual.lat = pos.coords.latitude;
      geoAtual.lng = pos.coords.longitude;
      geoAtual.dist = haversine(geoAtual.lat, geoAtual.lng, LAT_EMPRESA, LNG_EMPRESA);
      geoAtual.dentro = geoAtual.dist <= RAIO_LIMITE;

      var status = geoAtual.dentro ? 'Dentro do raio' : 'Fora do raio permitido';
      var cls = geoAtual.dentro ? 'ok' : 'fora';
      var dist = 'Distância: ' + Math.round(geoAtual.dist) + ' m (limite: ' + RAIO_LIMITE + ' m)';

      updateGeoUI(status, cls, dist);
      checkSubmit();
    },
    function () {
      updateGeoUI('GPS negado', 'fora', '');
    },
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

function updateGeoUI(txt, cls, dist) {
  document.getElementById('geoIndicator').className = 'geo-indicator ' + cls;
  document.getElementById('geoValue').textContent = txt;
  document.getElementById('geoDist').textContent = dist;
}

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ══════════════════════════════════════════════════════════════
//  SELEÇÃO DE TIPO
// ══════════════════════════════════════════════════════════════
function selectType(el, tipo) {
  document.querySelectorAll('.type-btn').forEach(function (b) {
    b.classList.remove('selected');
  });
  el.classList.add('selected');
  tipoSelecionado = tipo;
  checkSubmit();
}

function checkSubmit() {
  var isGestor = sessao && sessao.nivel === 'gestor';
  var geoOk = isGestor ? true : geoAtual.dentro;
  document.getElementById('submitBtn').disabled = !(selfieData && tipoSelecionado && geoOk);
}

// ══════════════════════════════════════════════════════════════
//  REGISTRAR PONTO
// ══════════════════════════════════════════════════════════════
function registrarPonto() {
  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  var payload = {
    nome: sessao.nome,
    tipo: tipoSelecionado,
    selfie: selfieData,
    lat: geoAtual.lat,
    lng: geoAtual.lng,
    dispositivo: navigator.userAgent.substring(0, 60),
    ip: ''
  };

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') {
        showSuccess(d);
        incrementSession();
        resetAfterSubmit();
        syncDados();
      } else {
        toast(d.msg || 'Erro ao registrar');
      }
    })
    .catch(function () { toast('Sem conexão — tente novamente'); })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'Registrar Ponto';
    });
}

function showSuccess(d) {
  document.getElementById('successIcon').textContent = d.dentroDoRaio ? '✅' : '⚠️';
  document.getElementById('successMsg').textContent = d.mensagem || 'Ponto registrado!';
  document.getElementById('successDetail').textContent =
    d.hora + ' • ' + Math.round(d.distancia) + 'm • ' + d.statusGeo;
  var ov = document.getElementById('successOverlay');
  ov.classList.add('show');
  setTimeout(function () { ov.classList.remove('show'); }, 3000);
}

function resetAfterSubmit() {
  resetCamera();
  tipoSelecionado = '';
  document.querySelectorAll('.type-btn').forEach(function (b) {
    b.classList.remove('selected');
  });
  checkSubmit();
}

function incrementSession() {
  var key = 'p_' + sessao.nome + '_sc';
  var c = parseInt(localStorage.getItem(key) || '0');
  localStorage.setItem(key, c + 1);
}

// ══════════════════════════════════════════════════════════════
//  SYNC — dados gerais
// ══════════════════════════════════════════════════════════════
function syncDados() {
  fetch(API_URL + '?sync=1')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      document.getElementById('statHoje').textContent = d.hoje || 0;
      document.getElementById('statMes').textContent = d.mes || 0;
      setBadge(true);
      if (d.timeline) renderTimeline(d.timeline);
    })
    .catch(function () { setBadge(false); });
}

function syncGestor() {
  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.erro) return;
      document.getElementById('statPresentes').textContent = d.presentes || 0;
      document.getElementById('statAlertas').textContent = (d.alertas ? d.alertas.length : 0);
    })
    .catch(function () { /* silencioso */ });
}

function setBadge(on) {
  var b = document.getElementById('badgeStatus');
  b.textContent = on ? 'Online' : 'Offline';
  b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline');
}

// ══════════════════════════════════════════════════════════════
//  TIMELINE
// ══════════════════════════════════════════════════════════════
function renderTimeline(items) {
  var el = document.getElementById('timelineList');

  if (!items || items.length === 0) {
    el.innerHTML = '<p style="color:var(--text-dim);font-size:.82rem;">Nenhum registro hoje</p>';
    return;
  }

  var html = '';
  items.forEach(function (it) {
    var cls = 'tl-' + it.tipo.replace(/\s/g, '_');
    html += '<div class="timeline-item">';
    html += '<span class="tl-hora">' + it.hora + '</span>';
    html += '<span class="tl-nome">' + it.nome + '</span>';
    html += '<span class="tl-tipo ' + cls + '">' + it.tipo + '</span>';
    html += '</div>';
  });

  el.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
//  PAINEL TEMPO REAL
// ══════════════════════════════════════════════════════════════
function abrirPainel() {
  document.getElementById('painelModal').classList.add('show');
  carregarPainel();
}

function fecharPainel() {
  document.getElementById('painelModal').classList.remove('show');
}

function carregarPainel() {
  var body = document.getElementById('painelBody');
  body.innerHTML =
    '<div style="text-align:center;padding:60px 20px;">' +
    '<div class="ld-spinner" style="margin:0 auto;"></div>' +
    '<p style="color:var(--text-dim);margin-top:16px;font-size:.85rem;">Carregando painel...</p>' +
    '</div>';

  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.erro) {
        body.innerHTML = '<p style="color:var(--red);padding:20px;">' + d.erro + '</p>';
        return;
      }
      renderPainel(d);
    })
    .catch(function () {
      body.innerHTML = '<p style="color:var(--red);padding:20px;">Erro de conexão</p>';
    });
}

function renderPainel(d) {
  var h = '';

  // Stats
  h += '<div class="painel-stats">';
  h += '<div class="p-stat"><div class="p-val green">' + d.presentes + '</div><div class="p-lbl">Presentes</div></div>';
  h += '<div class="p-stat"><div class="p-val red">' + d.ausentes + '</div><div class="p-lbl">Ausentes</div></div>';
  h += '<div class="p-stat"><div class="p-val cyan">' + d.totalFuncionarios + '</div><div class="p-lbl">Total</div></div>';
  h += '</div>';

  // Colaboradores
  var nomes = Object.keys(d.colaboradores);
  nomes.forEach(function (n) {
    var c = d.colaboradores[n];
    var pres = !!c.entrada;
    var st = '';

    if (c.saida) st = 'Saiu às ' + c.saida;
    else if (c.retornoAlmoco) st = 'Retornou do almoço ' + c.retornoAlmoco;
    else if (c.saidaAlmoco) st = 'Almoço desde ' + c.saidaAlmoco;
    else if (c.entrada) st = 'Entrou às ' + c.entrada;
    else st = 'Ainda não registrou';

    h += '<div class="colab-card">';
    h += '<div class="c-avatar ' + (pres ? 'presente' : 'ausente') + '">' + n.substring(0, 2) + '</div>';
    h += '<div class="c-info"><div class="c-nome">' + n + '</div><div class="c-status">' + st + '</div></div>';
    h += '<div class="c-hora">' + (c.entrada || '—') + '</div>';
    h += '</div>';
  });

  // Alertas fora do raio
  if (d.alertas && d.alertas.length > 0) {
    h += '<div class="alerta-section">';
    h += '<div class="alerta-title">⚠️ Alertas — Fora do Raio</div>';
    d.alertas.forEach(function (a) {
      h += '<div class="alerta-item">';
      h += '<span class="a-icon">⚠️</span>';
      h += '<span class="a-text">' + a.nome + ' — ' + a.tipo + ' (' + a.distancia + 'm)</span>';
      h += '<span class="a-time">' + a.hora + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  h += '<p style="text-align:center;color:var(--text-dim);font-size:.72rem;margin-top:24px;">Atualizado: ' + d.data + ' ' + d.timestamp + '</p>';

  document.getElementById('painelBody').innerHTML = h;
}

// ══════════════════════════════════════════════════════════════
//  RELATÓRIO DE HORAS
// ══════════════════════════════════════════════════════════════
function abrirRelatorio() {
  document.getElementById('relModal').classList.add('show');
  carregarRelatorio();
}

function fecharRelatorio() {
  document.getElementById('relModal').classList.remove('show');
}

function carregarRelatorio() {
  var body = document.getElementById('relBody');
  body.innerHTML =
    '<div style="text-align:center;padding:60px 20px;">' +
    '<div class="ld-spinner" style="margin:0 auto;"></div>' +
    '<p style="color:var(--text-dim);margin-top:16px;font-size:.85rem;">Carregando relatório...</p>' +
    '</div>';

  fetch(API_URL + '?relatorio=1&senha=' + encodeURIComponent(sessao.senha))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.erro) {
        body.innerHTML = '<p style="color:var(--red);padding:20px;">' + d.erro + '</p>';
        return;
      }
      renderRelatorio(d);
    })
    .catch(function () {
      body.innerHTML = '<p style="color:var(--red);padding:20px;">Erro de conexão</p>';
    });
}

function renderRelatorio(d) {
  var h = '<p style="color:var(--text-dim);font-size:.82rem;margin-bottom:24px;">';
  h += 'Mês: ' + d.mes + ' • Jornada: ' + d.jornada + ' • Gerado: ' + d.geradoEm;
  h += '</p>';

  d.colaboradores.forEach(function (c) {
    h += '<div class="rel-card">';
    h += '<div class="rel-nome">' + c.nome + '</div>';
    h += '<div class="rel-grid">';
    h += '<div class="rel-item"><div class="ri-val">' + c.diasTrabalhados + '</div><div class="ri-lbl">Dias Trab.</div></div>';
    h += '<div class="rel-item"><div class="ri-val">' + c.diasCompletos + '</div><div class="ri-lbl">Completos</div></div>';
    h += '<div class="rel-item"><div class="ri-val">' + c.horasTotais + '</div><div class="ri-lbl">Horas</div></div>';
    h += '<div class="rel-item"><div class="ri-val" style="color:var(--green);">' + c.horasExtras + '</div><div class="ri-lbl">Extras</div></div>';
    h += '<div class="rel-item"><div class="ri-val" style="color:var(--red);">' + c.deficit + '</div><div class="ri-lbl">Déficit</div></div>';
    h += '<div class="rel-item"><div class="ri-val" style="color:var(--amber);">' + c.atrasoTotal + '</div><div class="ri-lbl">Atrasos</div></div>';
    h += '<div class="rel-item"><div class="ri-val">' + c.mediaPorDia + '</div><div class="ri-lbl">Média/Dia</div></div>';
    h += '</div></div>';
  });

  document.getElementById('relBody').innerHTML = h;
}

// ══════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 3500);
}
