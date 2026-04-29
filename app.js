// ══════════════════════════════════════════════════════════════
//  PONTO DIGITAL — app.js v6.0 (Arquitetura Sênior)
//  Grupo Carlos Vaz — CRV/LAS
// ══════════════════════════════════════════════════════════════

// ── Config ───────────────────────────────────────────────────
// Cole aqui a sua nova URL gerada pelo Google Apps Script
var API_URL = 'https://script.google.com/macros/s/AKfycbzw_DCKo-0c3EMxWHgajCs8FxVYxtghYXSerldjBaTSu5lKsKqUYr5-vOLTYOuYsUFRUg/exec';
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
//  INIT — Verifica sessão salva
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

function toggleSenha() {
  var input = document.getElementById('loginPass');
  var icon = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text'; icon.textContent = '🙈';
  } else {
    input.type = 'password'; icon.textContent = '👁️';
  }
}

// ══════════════════════════════════════════════════════════════
//  LOGIN E LOGOUT (Corrigido Bug do Gestor)
// ══════════════════════════════════════════════════════════════
function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim();
  var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');

  err.textContent = '';
  if (!user || !pass) {
    err.textContent = 'Preencha todos os campos';
    shakeLogin(); return;
  }

  btn.disabled = true; btn.textContent = 'Verificando...';

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
        esconderLogin(); iniciarApp();
      } else {
        err.textContent = d.msg || 'Credenciais inválidas'; shakeLogin();
      }
    })
    .catch(function () {
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === pass) {
        sessao = { nome: user, nivel: user === 'ALEF' ? 'gestor' : 'funcionario', senha: pass };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
        esconderLogin(); iniciarApp();
      } else {
        err.textContent = 'Sem conexão e credenciais inválidas'; shakeLogin();
      }
    })
    .finally(function () {
      btn.disabled = false; btn.textContent = 'Entrar';
    });
}

function shakeLogin() {
  var c = document.querySelector('.login-card');
  c.classList.add('shake');
  setTimeout(function () { c.classList.remove('shake'); }, 500);
}

function esconderLogin() { document.getElementById('loginScreen').classList.add('hidden'); }

// MENTORIA: A função logout agora esconde tudo do gestor pro próximo usuário
function logout() {
  sessao = null;
  localStorage.removeItem(SESSION_KEY);
  if (refreshInterval) clearInterval(refreshInterval);
  stopCamera();
  
  // Limpa telas do gestor
  document.getElementById('badgeGestor').style.display = 'none';
  document.getElementById('gestorSection').classList.remove('show');
  
  // Reseta app e volta pro login
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginPass').type = 'password';
  document.getElementById('eyeIcon').textContent = '👁️';
  document.getElementById('loginError').textContent = '';
  
  // Limpa o modo viagem se tiver ativo
  if(document.getElementById('viagemCheck')) document.getElementById('viagemCheck').checked = false;
  toggleViagem();
}

document.addEventListener('DOMContentLoaded', function () {
  var passField = document.getElementById('loginPass');
  if (passField) passField.addEventListener('keydown', function (e) { if (e.key === 'Enter') fazerLogin(); });
  
  // Listener do Modo Viagem para validar ao digitar
  var destField = document.getElementById('viagemDestino');
  if (destField) destField.addEventListener('input', checkSubmit);
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
  }

  loadSequence([
    { t: 'Autenticando...', p: 20 },
    { t: 'Iniciando câmera...', p: 50 },
    { t: 'Buscando GPS...', p: 80 },
    { t: 'Pronto!', p: 100 }
  ], function () {
    document.getElementById('ldScreen').classList.add('hidden');
    initCamera(); initGeo(); syncDados();
    refreshInterval = setInterval(function () {
      syncDados(); if (isGestor) syncGestor();
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
    i++; setTimeout(next, 500);
  }
  next();
}

// ══════════════════════════════════════════════════════════════
//  CÂMERA (Compressão Nível Sênior para envio rápido)
// ══════════════════════════════════════════════════════════════
function initCamera() {
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 320 } })
    .then(function (s) { stream = s; document.getElementById('videoEl').srcObject = s; })
    .catch(function () { toast('Câmera indisponível'); });
}

function capturePhoto() {
  var v = document.getElementById('videoEl');
  var c = document.getElementById('canvasEl');
  
  // Imagem redimensionada para 320x320 para economizar megabytes
  c.width = 320; c.height = 320;
  c.getContext('2d').drawImage(v, 0, 0, 320, 320);
  
  // Compressão em 0.5 (Qualidade ótima pro Drive, envio instantâneo)
  selfieData = c.toDataURL('image/jpeg', 0.5);
  
  v.style.display = 'none'; c.style.display = 'block';
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
  selfieData = ''; checkSubmit();
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
}

// ══════════════════════════════════════════════════════════════
//  GEOLOCALIZAÇÃO E MODO VIAGEM
// ══════════════════════════════════════════════════════════════
function initGeo() {
  if (!navigator.geolocation) { updateGeoUI('GPS indisponível', 'buscando', ''); return; }

  navigator.geolocation.watchPosition(
    function (pos) {
      geoAtual.lat = pos.coords.latitude;
      geoAtual.lng = pos.coords.longitude;
      geoAtual.dist = haversine(geoAtual.lat, geoAtual.lng, LAT_EMPRESA, LNG_EMPRESA);
      geoAtual.dentro = geoAtual.dist <= RAIO_LIMITE;

      var status = geoAtual.dentro ? 'Dentro do raio permitido' : 'Fora do raio';
      var cls = geoAtual.dentro ? 'ok' : 'fora';
      var dist = 'Distância: ' + Math.round(geoAtual.dist) + 'm (limite: ' + RAIO_LIMITE + 'm)';

      updateGeoUI(status, cls, dist); checkSubmit();
    },
    function () { updateGeoUI('GPS negado', 'fora', ''); },
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
  var dLat = (lat2 - lat1) * Math.PI / 180; var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ARQUITETURA "EM VIAGEM" — Lógica de Toggle
function toggleViagem() {
  var check = document.getElementById('viagemCheck').checked;
  var container = document.getElementById('viagemDestinoContainer');
  
  if(check) {
    container.classList.remove('hidden');
    document.getElementById('geoIndicator').className = 'geo-indicator ok'; // Muda GPS pra OK visualmente
    document.getElementById('geoValue').textContent = 'Modo Viagem Ativo';
  } else {
    container.classList.add('hidden');
    document.getElementById('viagemDestino').value = ''; // Limpa o campo
    // Restaura GPS visual
    var cls = geoAtual.dentro ? 'ok' : 'fora';
    var txt = geoAtual.dentro ? 'Dentro do raio permitido' : 'Fora do raio';
    updateGeoUI(txt, cls, 'Distância: ' + Math.round(geoAtual.dist) + 'm');
  }
  checkSubmit();
}

function selectType(el, tipo) {
  document.querySelectorAll('.type-btn').forEach(function (b) { b.classList.remove('selected'); });
  el.classList.add('selected'); tipoSelecionado = tipo; checkSubmit();
}

// VALIDADOR INTELIGENTE: Pesa Gestor, Viagem ou GPS Normal
function checkSubmit() {
  var isGestor = sessao && sessao.nivel === 'gestor';
  var isViagem = document.getElementById('viagemCheck') && document.getElementById('viagemCheck').checked;
  var destinoText = document.getElementById('viagemDestino') ? document.getElementById('viagemDestino').value.trim() : '';
  
  var geoOk = false;
  if(isGestor) {
    geoOk = true; // Gestor sempre pode
  } else if(isViagem) {
    geoOk = destinoText.length > 2; // Viagem precisa de no mínimo 3 letras no destino
  } else {
    geoOk = geoAtual.dentro; // Operação normal trava no raio
  }

  document.getElementById('submitBtn').disabled = !(selfieData && tipoSelecionado && geoOk);
}

// ══════════════════════════════════════════════════════════════
//  REGISTRAR PONTO (Enviando dados da Viagem)
// ══════════════════════════════════════════════════════════════
function registrarPonto() {
  var btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Enviando...';
  
  var isViagem = document.getElementById('viagemCheck').checked;
  var destinoText = document.getElementById('viagemDestino').value.trim();

  var payload = {
    nome: sessao.nome,
    tipo: tipoSelecionado,
    selfie: selfieData,
    lat: geoAtual.lat,
    lng: geoAtual.lng,
    dispositivo: navigator.userAgent.substring(0, 60),
    ip: '',
    viagem: isViagem, // Backend espera isso
    destino: destinoText // E isso
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
        showSuccess(d); incrementSession(); resetAfterSubmit(); syncDados();
      } else { toast(d.msg || 'Erro ao registrar'); }
    })
    .catch(function () { toast('Sem conexão — tente novamente'); })
    .finally(function () { btn.disabled = false; btn.textContent = 'Confirmar Registro'; });
}

function showSuccess(d) {
  document.getElementById('successIcon').textContent = d.dentroDoRaio ? '✅' : '⚠️';
  document.getElementById('successMsg').textContent = d.mensagem || 'Ponto registrado!';
  document.getElementById('successDetail').textContent = d.hora + ' • ' + d.statusGeo;
  var ov = document.getElementById('successOverlay');
  ov.classList.add('show'); setTimeout(function () { ov.classList.remove('show'); }, 3000);
}

function resetAfterSubmit() {
  resetCamera(); tipoSelecionado = '';
  document.querySelectorAll('.type-btn').forEach(function (b) { b.classList.remove('selected'); });
  if(document.getElementById('viagemCheck').checked) {
    document.getElementById('viagemCheck').checked = false;
    toggleViagem();
  }
  checkSubmit();
}

function incrementSession() {
  var key = 'p_' + sessao.nome + '_sc';
  var c = parseInt(localStorage.getItem(key) || '0'); localStorage.setItem(key, c + 1);
}

// ══════════════════════════════════════════════════════════════
//  SYNC E PAINÉIS 
// ══════════════════════════════════════════════════════════════
function syncDados() {
  fetch(API_URL + '?sync=1')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      document.getElementById('statHoje').textContent = d.hoje || 0;
      document.getElementById('statMes').textContent = d.mes || 0;
      setBadge(true); if (d.timeline) renderTimeline(d.timeline);
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

function renderTimeline(items) {
  var el = document.getElementById('timelineList');
  if (!items || items.length === 0) { el.innerHTML = '<p style="color:var(--text-tertiary);font-size:.82rem;text-align:center;">Nenhum registro hoje</p>'; return; }

  var html = '';
  items.forEach(function (it) {
    var cls = 'tl-' + it.tipo.replace(/\s/g, '_');
    html += '<div class="timeline-item"><span class="tl-hora">' + it.hora + '</span><span class="tl-nome">' + it.nome + '</span><span class="tl-tipo ' + cls + '">' + it.tipo + '</span></div>';
  });
  el.innerHTML = html;
}

// MANTENHO OS CÓDIGOS ORIGINAIS DO PAINEL E RELATÓRIO AQUI PARA O POST NÃO FICAR GIGANTE
// (Pode colar exatamente o mesmo bloco 'abrirPainel', 'renderPainel', 'abrirRelatorio', etc. do seu app.js antigo abaixo desta linha)

function abrirPainel() {
  document.getElementById('painelModal').classList.add('show');
  carregarPainel();
}

function fecharPainel() {
  document.getElementById('painelModal').classList.remove('show');
}

function carregarPainel() {
  var body = document.getElementById('painelBody');
  body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto;"></div><p style="color:var(--text-tertiary);margin-top:16px;font-size:.85rem;">Sincronizando painel...</p></div>';

  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.erro) { body.innerHTML = '<p style="color:var(--red);padding:20px;">' + d.erro + '</p>'; return; } renderPainel(d); })
    .catch(function () { body.innerHTML = '<p style="color:var(--red);padding:20px;">Erro de conexão</p>'; });
}

function renderPainel(d) {
  // Mesmo código que você já tinha...
  var h = '<div class="painel-stats"><div class="p-stat"><div class="p-val green">' + d.presentes + '</div><div class="p-lbl">Presentes</div></div>';
  h += '<div class="p-stat"><div class="p-val red">' + d.ausentes + '</div><div class="p-lbl">Ausentes</div></div>';
  h += '<div class="p-stat"><div class="p-val cyan">' + d.totalFuncionarios + '</div><div class="p-lbl">Total</div></div></div>';

  var nomes = Object.keys(d.colaboradores);
  nomes.forEach(function (n) {
    var c = d.colaboradores[n]; var pres = !!c.entrada; var st = '';
    if (c.saida) st = 'Saiu às ' + c.saida; else if (c.retornoAlmoco) st = 'Retornou ' + c.retornoAlmoco; else if (c.saidaAlmoco) st = 'Almoço desde ' + c.saidaAlmoco; else if (c.entrada) st = 'Entrou às ' + c.entrada; else st = 'Pendente';
    h += '<div class="colab-card"><div class="c-avatar ' + (pres ? 'presente' : 'ausente') + '">' + n.substring(0, 2) + '</div>';
    h += '<div class="c-info"><div class="c-nome">' + n + '</div><div class="c-status">' + st + '</div></div><div class="c-hora">' + (c.entrada || '—') + '</div></div>';
  });

  if (d.alertas && d.alertas.length > 0) {
    h += '<div class="alerta-section"><div class="alerta-title">⚠️ Fora do Raio</div>';
    d.alertas.forEach(function (a) { h += '<div class="alerta-item"><span class="a-icon">⚠️</span><span class="a-text">' + a.nome + ' — ' + a.tipo + '</span><span class="a-time">' + a.hora + '</span></div>'; });
    h += '</div>';
  }
  document.getElementById('painelBody').innerHTML = h;
}

function abrirRelatorio() { document.getElementById('relModal').classList.add('show'); carregarRelatorio(); }
function fecharRelatorio() { document.getElementById('relModal').classList.remove('show'); }

function carregarRelatorio() {
  var body = document.getElementById('relBody');
  body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto;"></div></div>';
  fetch(API_URL + '?relatorio=1&senha=' + encodeURIComponent(sessao.senha)).then(function(r){return r.json();}).then(function(d){ renderRelatorio(d); });
}

function renderRelatorio(d) {
  var h = '<p style="color:var(--text-tertiary);font-size:.82rem;margin-bottom:24px;">Gerado: ' + d.geradoEm + '</p>';
  d.colaboradores.forEach(function (c) {
    h += '<div class="rel-card"><div class="rel-nome">' + c.nome + '</div><div class="rel-grid">';
    h += '<div class="rel-item"><div class="ri-val">' + c.diasTrabalhados + '</div><div class="ri-lbl">Dias</div></div>';
    h += '<div class="rel-item"><div class="ri-val">' + c.horasTotais + '</div><div class="ri-lbl">Horas</div></div>';
    h += '<div class="rel-item"><div class="ri-val" style="color:var(--green);">' + c.horasExtras + '</div><div class="ri-lbl">Extras</div></div>';
    h += '</div></div>';
  });
  document.getElementById('relBody').innerHTML = h;
}

function toast(msg) {
  var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 3500);
}
