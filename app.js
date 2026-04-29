// ══════════════════════════════════════════════════════════════
//  PONTO DIGITAL — app.js v8.0 (Arquitetura Sênior Completa)
//  Grupo Carlos Vaz — CRV/LAS
// ══════════════════════════════════════════════════════════════

var API_URL = 'https://script.google.com/macros/s/SUA_NOVA_URL_AQUI/exec';
var SESSION_KEY = 'cv_ponto_sessao';
var RAIO_LIMITE = 50; 
var LAT_EMPRESA = -14.842472;
var LNG_EMPRESA = -39.987250;

var CREDS_OFFLINE = {
  'LUCAS':  'lucas2026', 'TASSIO': 'tassio2026',
  'AMARAL': 'amaral2026', 'ALEX':   'alex2026',
  'ALEF':   'GP.Carlos2026'
};

var sessao = null;
var tipoSelecionado = '';
var selfieData = '';
var geoAtual = { lat: 0, lng: 0, dist: null, dentro: false };
var refreshInterval = null;
var stream = null;
var avisoViagemFeito = false; 

(function () {
  var s = localStorage.getItem(SESSION_KEY);
  if (s) { try { sessao = JSON.parse(s); if (sessao && sessao.nome) { esconderLogin(); iniciarApp(); return; } } catch (e) { } }
})();

function toggleSenha() {
  var input = document.getElementById('loginPass');
  var icon = document.getElementById('eyeIcon');
  if (input.type === 'password') { input.type = 'text'; icon.textContent = '🙈'; } else { input.type = 'password'; icon.textContent = '👁️'; }
}

function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim();
  var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');

  err.textContent = '';
  if (!user || !pass) { err.textContent = 'Preencha todos os campos'; shakeLogin(); return; }
  btn.disabled = true; btn.textContent = 'A verificar...';

  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'login', usuario: user, senha: pass }), redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') { sessao = { nome: d.nome, nivel: d.nivel, senha: pass }; localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)); esconderLogin(); iniciarApp(); } 
      else { err.textContent = d.msg || 'Credenciais inválidas'; shakeLogin(); }
    }).catch(function () {
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === pass) { sessao = { nome: user, nivel: user === 'ALEF' ? 'gestor' : 'funcionario', senha: pass }; localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)); esconderLogin(); iniciarApp(); } 
      else { err.textContent = 'Sem conexão e credenciais inválidas'; shakeLogin(); }
    }).finally(function () { btn.disabled = false; btn.textContent = 'Entrar'; });
}

function shakeLogin() { var c = document.querySelector('.login-card'); c.classList.add('shake'); setTimeout(function () { c.classList.remove('shake'); }, 500); }
function esconderLogin() { document.getElementById('loginScreen').classList.add('hidden'); }

function logout() {
  sessao = null; localStorage.removeItem(SESSION_KEY);
  if (refreshInterval) clearInterval(refreshInterval); stopCamera();
  document.getElementById('badgeGestor').style.display = 'none'; document.getElementById('gestorSection').classList.remove('show');
  document.getElementById('mainApp').style.display = 'none'; document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').value = ''; document.getElementById('loginPass').value = ''; document.getElementById('loginPass').type = 'password'; document.getElementById('eyeIcon').textContent = '👁️'; document.getElementById('loginError').textContent = '';
  avisoViagemFeito = false; 
  if(document.getElementById('viagemCheck')) document.getElementById('viagemCheck').checked = false; toggleViagem();
  if(document.getElementById('areaOperacional')) document.getElementById('areaOperacional').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', function () {
  var passField = document.getElementById('loginPass'); if (passField) passField.addEventListener('keydown', function (e) { if (e.key === 'Enter') fazerLogin(); });
  var destField = document.getElementById('viagemDestino'); if (destField) destField.addEventListener('input', checkSubmit);
});

function iniciarApp() {
  document.getElementById('ldScreen').classList.remove('hidden');
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('userBadge').textContent = sessao.nome;
  var isGestor = sessao.nivel === 'gestor';

  if (isGestor) {
    document.getElementById('badgeGestor').style.display = ''; document.getElementById('gestorSection').classList.add('show');
    if(document.getElementById('areaOperacional')) document.getElementById('areaOperacional').style.display = 'none';
  }

  loadSequence([ { t: 'A autenticar...', p: 20 }, { t: 'A preparar módulo...', p: 50 }, { t: 'A buscar estado...', p: 80 }, { t: 'Pronto!', p: 100 } ], function () {
    document.getElementById('ldScreen').classList.add('hidden');
    if (!isGestor) { initCamera(); initGeo(); }
    syncDados(); refreshInterval = setInterval(function () { syncDados(); if (isGestor) syncGestor(); }, 300000);
    if (isGestor) syncGestor();
  });
}

function loadSequence(steps, cb) {
  var i = 0; function next() { if (i >= steps.length) { setTimeout(cb, 400); return; } document.getElementById('ldText').textContent = steps[i].t; document.getElementById('ldBarTop').style.width = steps[i].p + '%'; i++; setTimeout(next, 500); } next();
}

function initCamera() { navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 240, height: 240 } }).then(function (s) { stream = s; document.getElementById('videoEl').srcObject = s; }).catch(function () { toast('Câmera indisponível'); }); }
function capturePhoto() { var v = document.getElementById('videoEl'); var c = document.getElementById('canvasEl'); c.width = 240; c.height = 240; c.getContext('2d').drawImage(v, 0, 0, 240, 240); selfieData = c.toDataURL('image/jpeg', 0.4); v.style.display = 'none'; c.style.display = 'block'; document.getElementById('btnCapture').style.display = 'none'; document.getElementById('btnReset').style.display = ''; document.getElementById('selfieOk').style.display = 'block'; checkSubmit(); }
function resetCamera() { document.getElementById('videoEl').style.display = 'block'; document.getElementById('canvasEl').style.display = 'none'; document.getElementById('btnCapture').style.display = ''; document.getElementById('btnReset').style.display = 'none'; document.getElementById('selfieOk').style.display = 'none'; selfieData = ''; checkSubmit(); }
function stopCamera() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }

function initGeo() {
  if (!navigator.geolocation) { updateGeoUI('GPS indisponível', 'buscando', ''); return; }
  navigator.geolocation.watchPosition(function (pos) {
    geoAtual.lat = pos.coords.latitude; geoAtual.lng = pos.coords.longitude; geoAtual.dist = haversine(geoAtual.lat, geoAtual.lng, LAT_EMPRESA, LNG_EMPRESA); geoAtual.dentro = geoAtual.dist <= RAIO_LIMITE;
    var status = geoAtual.dentro ? 'Dentro do raio permitido' : 'Fora do raio'; var cls = geoAtual.dentro ? 'ok' : 'fora'; var dist = 'Distância: ' + Math.round(geoAtual.dist) + 'm (limite: ' + RAIO_LIMITE + 'm)';
    updateGeoUI(status, cls, dist); checkSubmit();
  }, function () { updateGeoUI('GPS negado', 'fora', ''); }, { enableHighAccuracy: true, maximumAge: 10000 });
}

function updateGeoUI(txt, cls, dist) { document.getElementById('geoIndicator').className = 'geo-indicator ' + cls; document.getElementById('geoValue').textContent = txt; document.getElementById('geoDist').textContent = dist; }
function haversine(lat1, lon1, lat2, lon2) { var R = 6371000; var dLat = (lat2 - lat1) * Math.PI / 180; var dLon = (lon2 - lon1) * Math.PI / 180; var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2); return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }

function toggleViagem() {
  var check = document.getElementById('viagemCheck').checked; var container = document.getElementById('viagemDestinoContainer');
  if(check) { container.classList.remove('hidden'); document.getElementById('geoIndicator').className = 'geo-indicator ok'; document.getElementById('geoValue').textContent = 'Modo Viagem Ativo'; } 
  else { container.classList.add('hidden'); document.getElementById('viagemDestino').value = ''; var cls = geoAtual.dentro ? 'ok' : 'fora'; var txt = geoAtual.dentro ? 'Dentro do raio permitido' : 'Fora do raio'; updateGeoUI(txt, cls, 'Distância: ' + Math.round(geoAtual.dist) + 'm'); } checkSubmit();
}

function selectType(el, tipo) { document.querySelectorAll('.type-btn').forEach(function (b) { b.classList.remove('selected'); }); el.classList.add('selected'); tipoSelecionado = tipo; checkSubmit(); }

function checkSubmit() {
  var isGestor = sessao && sessao.nivel === 'gestor'; var isViagem = document.getElementById('viagemCheck') && document.getElementById('viagemCheck').checked; var destinoText = document.getElementById('viagemDestino') ? document.getElementById('viagemDestino').value.trim() : ''; var geoOk = false;
  if(isGestor) geoOk = true; else if(isViagem) geoOk = destinoText.length > 2; else geoOk = geoAtual.dentro; document.getElementById('submitBtn').disabled = !(selfieData && tipoSelecionado && geoOk);
}

function registrarPonto() {
  var btn = document.getElementById('submitBtn'); btn.disabled = true; btn.textContent = 'A enviar...';
  var isViagem = document.getElementById('viagemCheck').checked; var destinoText = document.getElementById('viagemDestino').value.trim();
  var payload = { nome: sessao.nome, tipo: tipoSelecionado, selfie: selfieData, lat: geoAtual.lat, lng: geoAtual.lng, dispositivo: navigator.userAgent.substring(0, 60), ip: '', viagem: isViagem, destino: destinoText };
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) { if (d.status === 'ok') { showSuccess(d); incrementSession(); resetAfterSubmit(); syncDados(); } else { toast(d.msg || 'Erro ao registar'); } }).catch(function () { toast('Sem conexão — tente novamente'); }).finally(function () { btn.disabled = false; btn.textContent = 'Confirmar Registo'; });
}

function showSuccess(d) { document.getElementById('successIcon').textContent = d.dentroDoRaio ? '✅' : '⚠️'; document.getElementById('successMsg').textContent = d.mensagem || 'Registo Guardado!'; document.getElementById('successDetail').textContent = d.hora + ' • ' + d.statusGeo; var ov = document.getElementById('successOverlay'); ov.classList.add('show'); setTimeout(function () { ov.classList.remove('show'); }, 3000); }
function resetAfterSubmit() { resetCamera(); tipoSelecionado = ''; document.querySelectorAll('.type-btn').forEach(function (b) { b.classList.remove('selected'); }); if(document.getElementById('viagemCheck').checked) { document.getElementById('viagemCheck').checked = false; toggleViagem(); } checkSubmit(); }
function incrementSession() { var key = 'p_' + sessao.nome + '_sc'; var c = parseInt(localStorage.getItem(key) || '0'); localStorage.setItem(key, c + 1); }

function syncDados() { fetch(API_URL + '?sync=1').then(function (r) { return r.json(); }).then(function (d) { document.getElementById('statHoje').textContent = d.hoje || 0; document.getElementById('statMes').textContent = d.mes || 0; setBadge(true); if (d.timeline) renderTimeline(d.timeline); }).catch(function () { setBadge(false); }); }

function syncGestor() {
  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha)).then(function (r) { return r.json(); }).then(function (d) {
    if (d.erro) return;
    document.getElementById('statPresentes').textContent = d.presentes || 0;
    document.getElementById('statAlertas').textContent = (d.alertas ? d.alertas.length : 0);
    var emViagem = [];
    var nomes = Object.keys(d.colaboradores);
    nomes.forEach(function(n) { if (d.colaboradores[n].registros.some(r => r.statusGeo.indexOf('VIAGEM') > -1)) { emViagem.push(n); } });
    document.getElementById('statViagem').textContent = emViagem.length;
    if (!avisoViagemFeito && emViagem.length > 0) { toast("📍 Atenção: " + emViagem.join(", ") + " na estrada hoje."); avisoViagemFeito = true; }
  }).catch(function () { });
}

function setBadge(on) { var b = document.getElementById('badgeStatus'); b.textContent = on ? 'Online' : 'Offline'; b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline'); }

function renderTimeline(items) {
  var el = document.getElementById('timelineList'); if (!items || items.length === 0) { el.innerHTML = '<p style="color:var(--text-tertiary);font-size:.82rem;text-align:center;">Nenhum registo hoje</p>'; return; }
  var html = ''; items.forEach(function (it) { var cls = 'tl-' + it.tipo.replace(/\s/g, '_'); html += '<div class="timeline-item"><span class="tl-hora">' + it.hora + '</span><span class="tl-nome">' + it.nome + '</span><span class="tl-tipo ' + cls + '">' + it.tipo + '</span></div>'; }); el.innerHTML = html;
}

function abrirPainel() { document.getElementById('painelModal').classList.add('show'); carregarPainel(); }
function fecharPainel() { document.getElementById('painelModal').classList.remove('show'); }

function carregarPainel() {
  var body = document.getElementById('painelBody');
  body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto;"></div><p style="color:var(--text-tertiary);margin-top:16px;font-size:.85rem;">A sincronizar painel...</p></div>';
  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha)).then(function (r) { return r.json(); }).then(function (d) { if (d.erro) { body.innerHTML = '<p style="color:var(--red);padding:20px;">' + d.erro + '</p>'; return; } renderPainel(d); }).catch(function () { body.innerHTML = '<p style="color:var(--red);padding:20px;">Erro de conexão</p>'; });
}

function renderPainel(d) {
  var h = '<div id="printHeader" style="display:none; text-align:center; margin-bottom:20px;"><h1 style="color:#000;">Relatório Diário — CRV/LAS</h1><p style="color:#333;">Data: ' + d.data + ' às ' + d.timestamp + '</p></div>';
  h += '<div class="painel-stats"><div class="p-stat"><div class="p-val green">' + d.presentes + '</div><div class="p-lbl">Presentes</div></div><div class="p-stat"><div class="p-val red">' + d.ausentes + '</div><div class="p-lbl">Ausentes</div></div><div class="p-stat"><div class="p-val cyan">' + d.totalFuncionarios + '</div><div class="p-lbl">Total</div></div></div>';

  var rotas = {};
  var nomes = Object.keys(d.colaboradores);
  nomes.forEach(function (n) {
    var c = d.colaboradores[n]; var pres = !!c.entrada; var st = '';
    
    // Agrupa Rotas
    c.registros.forEach(function(r) {
      if(r.statusGeo.indexOf('VIAGEM') > -1) {
        var match = r.obs.match(/DESTINO:\s([^|]+)/); var dest = match ? match[1].trim() : 'Rota Indefinida';
        if(!rotas[dest]) rotas[dest] = []; if(rotas[dest].indexOf(n) === -1) rotas[dest].push(n);
      }
    });

    if (c.saida) st = 'Saiu às ' + c.saida; else if (c.retornoAlmoco) st = 'Retornou ' + c.retornoAlmoco; else if (c.saidaAlmoco) st = 'Almoço desde ' + c.saidaAlmoco; else if (c.entrada) st = 'Entrou às ' + c.entrada; else st = 'Pendente';
    
    if (c.justificativa) { pres = true; st = 'Justificado: ' + c.justificativa; }

    h += '<div class="colab-card"><div class="c-avatar ' + (pres ? 'presente' : 'ausente') + '">' + n.substring(0, 2) + '</div>';
    h += '<div class="c-info"><div class="c-nome">' + n + '</div><div class="c-status">' + st + '</div></div>';
    
    if(!pres && !c.justificativa) { h += '<button onclick="abrirJustificativa(\''+n+'\')" style="background:var(--orange-soft); color:var(--orange); border:none; padding:6px 12px; border-radius:12px; font-weight:bold; font-size:0.7rem; cursor:pointer;">Justificar</button>'; } 
    else { h += '<div class="c-hora">' + (c.entrada || '—') + '</div>'; }
    h += '</div>';
  });

  // Mostra as Rotas Agrupadas
  var dests = Object.keys(rotas);
  if(dests.length > 0) {
    h += '<div class="alerta-section"><div class="alerta-title" style="color:var(--blue);">🗺️ Viagens em Andamento</div>';
    dests.forEach(function(destino) { h += '<div class="alerta-item" style="background:var(--blue-soft); border-color:transparent;"><span class="a-icon">📍</span><span class="a-text"><strong>' + destino + '</strong>: ' + rotas[destino].join(', ') + '</span></div>'; });
    h += '</div>';
  }

  if (d.alertas && d.alertas.length > 0) {
    h += '<div class="alerta-section"><div class="alerta-title">⚠️ Fora do Raio</div>';
    d.alertas.forEach(function (a) { h += '<div class="alerta-item"><span class="a-icon">⚠️</span><span class="a-text">' + a.nome + ' — ' + a.tipo + '</span><span class="a-time">' + a.hora + '</span></div>'; });
    h += '</div>';
  }
  document.getElementById('painelBody').innerHTML = h;
}

// ── Funções de Justificativa ──
function abrirJustificativa(nome) { document.getElementById('justNome').textContent = nome; document.getElementById('justNomeInput').value = nome; document.getElementById('justMotivo').value = ''; document.getElementById('justModal').classList.add('show'); }
function fecharJustificativa() { document.getElementById('justModal').classList.remove('show'); }

function salvarJustificativa() {
  var motivo = document.getElementById('justMotivo').value.trim(); var nomeColab = document.getElementById('justNomeInput').value;
  if(motivo.length < 3) { toast('Escreva um motivo válido'); return; }
  var btn = document.getElementById('btnSalvarJust'); btn.disabled = true; btn.textContent = 'A guardar...';
  
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'justificar', nomeColab: nomeColab, motivo: motivo, gestor: sessao.nome }), redirect: 'follow' })
    .then(function (r) { return r.json(); }).then(function (d) { if (d.status === 'ok') { fecharJustificativa(); toast(d.msg); carregarPainel(); } else { toast('Erro ao justificar'); } }).catch(function () { toast('Sem conexão'); }).finally(function () { btn.disabled = false; btn.textContent = 'Gravar Justificativa'; });
}

// ── Exportação PDF ──
function exportarPDF() {
  abrirPainel(); // Garante que o painel está atualizado e visível na memória
  setTimeout(function() { document.body.classList.add('print-mode'); window.print(); document.body.classList.remove('print-mode'); }, 800);
}

function abrirRelatorio() { document.getElementById('relModal').classList.add('show'); carregarRelatorio(); }
function fecharRelatorio() { document.getElementById('relModal').classList.remove('show'); }
function carregarRelatorio() { var body = document.getElementById('relBody'); body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto;"></div></div>'; fetch(API_URL + '?relatorio=1&senha=' + encodeURIComponent(sessao.senha)).then(function(r){return r.json();}).then(function(d){ renderRelatorio(d); }); }

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

function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 3500); }
