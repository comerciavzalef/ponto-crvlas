// ══════════════════════════════════════════════════════════════
//  PONTO DIGITAL — app.js v8.0 (Apple UI + Security)
//  Grupo Carlos Vaz — CRV/LAS
// ══════════════════════════════════════════════════════════════

var API_URL = 'https://script.google.com/macros/s/AKfycbzw_DCKo-0c3EMxWHgajCs8FxVYxtghYXSerldjBaTSu5lKsKqUYr5-vOLTYOuYsUFRUg/exec';
var SESSION_KEY = 'cv_ponto_sessao';
var RAIO_LIMITE = 50; 
var LAT_EMPRESA = -14.842472;
var LNG_EMPRESA = -39.987250;

var CREDS_OFFLINE = {
  'LUCAS':  '1e79f09abad6c8321bf6a1dee19aa4949ce95fa3f962361869c406555ade9062', 'TASSIO': '53c822e4be542a847100324d05458d7c155d9a0a3ee2c8ea6a621c3b426b123d',
  'AMARAL': 'd16bcb871bbfe495833cee0fd592bbf47540fee7801ade3d8ccf7b97372ad042', 'ALEX':   'e3f961a998c170860de4cab5c8f9548522a1938d6599cf40f827333b503d8eed',
  'GESTOR': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157'
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

// ── FUNÇÃO DE LOGIN ATUALIZADA (LGPD + HASH) ─────────────────
async function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim().toUpperCase();
  var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');
  var lgpd = document.getElementById('lgpdCheck');

  err.textContent = '';

  // 1. Trava de Preenchimento
  if (!user || !pass) { err.textContent = 'Preencha todos os campos'; shakeLogin(); return; }
  
  // 2. Trava da LGPD Jurídica
  if (lgpd && !lgpd.checked) { err.textContent = 'Aceite os termos da LGPD para entrar'; shakeLogin(); return; }
  
  btn.disabled = true; btn.textContent = 'Autenticando...';

  try {
    // 3. Criptografa a senha antes de enviar (Nunca viaja em texto limpo)
    var senhaHash = await gerarHash(pass);

    fetch(API_URL, { 
      method: 'POST', 
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
      body: JSON.stringify({ acao: 'login', usuario: user, senha: senhaHash }), // <-- Envia o Hash
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
    }).catch(function () {
      // Modo Offline usando o Hash
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === senhaHash) { 
        sessao = { nome: user, nivel: user === 'GESTOR' ? 'gestor' : 'funcionario', senha: pass }; 
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)); 
        esconderLogin(); iniciarApp(); 
      } else { 
        err.textContent = 'Sem conexão e credenciais inválidas'; shakeLogin(); 
      }
    }).finally(function () { btn.disabled = false; btn.textContent = 'Entrar'; });

  } catch(e) {
    err.textContent = 'Erro no sistema de segurança'; shakeLogin();
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

// ── MOTOR DE CRIPTOGRAFIA SHA-256 ────────────────────────────
async function gerarHash(texto) {
  const msgBuffer = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function shakeLogin() { var c = document.querySelector('.login-card'); c.classList.add('shake'); setTimeout(function () { c.classList.remove('shake'); }, 500); }
function esconderLogin() { document.getElementById('loginScreen').classList.add('hidden'); }

function logout() {
  sessao = null; localStorage.removeItem(SESSION_KEY);
  if (refreshInterval) clearInterval(refreshInterval); stopCamera();
  document.getElementById('badgeGestor').style.display = 'none'; document.getElementById('gestorSection').style.display = 'none';
  document.getElementById('mainApp').style.display = 'none'; document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').value = ''; document.getElementById('loginPass').value = ''; document.getElementById('loginPass').type = 'password'; document.getElementById('eyeIcon').textContent = '👁️'; document.getElementById('loginError').textContent = '';
  avisoViagemFeito = false; 
  document.getElementById('viagemSwitchToggle').classList.remove('on'); toggleViagemLogic(false);
  document.getElementById('areaOperacional').style.display = 'block';
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
    document.getElementById('badgeGestor').style.display = ''; 
    document.getElementById('gestorSection').style.display = 'block';
    document.getElementById('areaOperacional').style.display = 'none';
  } else {
    document.getElementById('badgeGestor').style.display = 'none';
    document.getElementById('gestorSection').style.display = 'none';
  }

  loadSequence([ { t: 'A autenticar...', p: 20 }, { t: 'A preparar módulo...', p: 50 }, { t: 'A calibrar GPS...', p: 80 }, { t: 'Pronto!', p: 100 } ], function () {
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
  if (!navigator.geolocation) { updateGeoUI('GPS indisponível', 'red', 'Não é possível verificar a localização.'); return; }
  navigator.geolocation.watchPosition(function (pos) {
    geoAtual.lat = pos.coords.latitude; geoAtual.lng = pos.coords.longitude; geoAtual.dist = haversine(geoAtual.lat, geoAtual.lng, LAT_EMPRESA, LNG_EMPRESA); geoAtual.dentro = geoAtual.dist <= RAIO_LIMITE;
    var txt = geoAtual.dentro ? 'Ponto Liberado' : 'Registo Bloqueado'; 
    var cls = geoAtual.dentro ? 'green' : 'red'; 
    var sub = geoAtual.dentro ? 'Dentro do perímetro da CRV/LAS.' : 'Fora do alcance (' + Math.round(geoAtual.dist) + 'm).';
    updateGeoUI(txt, cls, sub); checkSubmit();
  }, function () { updateGeoUI('GPS negado', 'red', 'Ative o GPS para registrar.'); }, { enableHighAccuracy: true, maximumAge: 10000 });
}

function updateGeoUI(txt, cor, sub) { 
  var bg = document.getElementById('geoIconBg');
  var icon = document.getElementById('geoIcon');
  if(cor === 'green') { bg.style.background = 'var(--green-soft)'; bg.style.color = 'var(--green)'; icon.textContent = '📍'; }
  else if(cor === 'red') { bg.style.background = 'var(--red-soft)'; bg.style.color = 'var(--red)'; icon.textContent = '🚫'; }
  
  document.getElementById('geoValue').textContent = txt; 
  document.getElementById('geoValue').style.color = 'var(--' + cor + ')';
  document.getElementById('geoDist').textContent = sub; 
}

function haversine(lat1, lon1, lat2, lon2) { var R = 6371000; var dLat = (lat2 - lat1) * Math.PI / 180; var dLon = (lon2 - lon1) * Math.PI / 180; var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2); return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }

function toggleViagem() {
  var sw = document.getElementById('viagemSwitchToggle');
  var isActive = sw.classList.contains('on');
  if(isActive) { sw.classList.remove('on'); toggleViagemLogic(false); }
  else { sw.classList.add('on'); toggleViagemLogic(true); }
}

function toggleViagemLogic(isViagem) {
  var container = document.getElementById('viagemDestinoContainer');
  if(isViagem) { 
    container.classList.remove('hidden'); 
    updateGeoUI('Modo Viagem Ativo', 'orange', 'Bloqueio de GPS ignorado temporariamente.');
  } else { 
    container.classList.add('hidden'); 
    document.getElementById('viagemDestino').value = ''; 
    var txt = geoAtual.dentro ? 'Ponto Liberado' : 'Registo Bloqueado'; 
    var cls = geoAtual.dentro ? 'green' : 'red'; 
    var sub = geoAtual.dentro ? 'Dentro do perímetro da CRV/LAS.' : 'Fora do alcance (' + Math.round(geoAtual.dist) + 'm).';
    updateGeoUI(txt, cls, sub); 
  } 
  checkSubmit();
}

function selectType(labelEl, tipo) { 
  tipoSelecionado = tipo; 
  checkSubmit(); 
}

function checkSubmit() {
  var isGestor = sessao && sessao.nivel === 'gestor'; 
  var isViagem = document.getElementById('viagemSwitchToggle') && document.getElementById('viagemSwitchToggle').classList.contains('on'); 
  var destinoText = document.getElementById('viagemDestino') ? document.getElementById('viagemDestino').value.trim() : ''; 
  var geoOk = false;
  
  if(isGestor) geoOk = true; 
  else if(isViagem) geoOk = destinoText.length > 2; 
  else geoOk = geoAtual.dentro; 
  
  document.getElementById('submitBtn').disabled = !(selfieData && tipoSelecionado && geoOk);
}

function registrarPonto() {
  var btn = document.getElementById('submitBtn'); btn.disabled = true; btn.textContent = 'A enviar...';
  var isViagem = document.getElementById('viagemSwitchToggle').classList.contains('on'); 
  var destinoText = document.getElementById('viagemDestino').value.trim();
  var payload = { nome: sessao.nome, tipo: tipoSelecionado, selfie: selfieData, lat: geoAtual.lat, lng: geoAtual.lng, dispositivo: navigator.userAgent.substring(0, 60), ip: '', viagem: isViagem, destino: destinoText };
  
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) { if (d.status === 'ok') { showSuccess(d); incrementSession(); resetAfterSubmit(); syncDados(); } else { toast(d.msg || 'Erro ao registar'); } }).catch(function () { toast('Sem conexão — tente novamente'); }).finally(function () { btn.disabled = false; btn.textContent = 'Confirmar Registo'; });
}

function showSuccess(d) { document.getElementById('successIcon').textContent = d.dentroDoRaio ? '✅' : '⚠️'; document.getElementById('successMsg').textContent = d.mensagem || 'Registo Guardado!'; document.getElementById('successDetail').textContent = d.hora + ' • ' + d.statusGeo; var ov = document.getElementById('successOverlay'); ov.classList.add('show'); setTimeout(function () { ov.classList.remove('show'); }, 3000); }
function resetAfterSubmit() { 
  resetCamera(); 
  tipoSelecionado = ''; 
  document.querySelectorAll('input[name="pontoType"]').forEach(function(r){ r.checked = false; });
  if(document.getElementById('viagemSwitchToggle').classList.contains('on')) { toggleViagem(); } 
  checkSubmit(); 
}
function incrementSession() { var key = 'p_' + sessao.nome + '_sc'; var c = parseInt(localStorage.getItem(key) || '0'); localStorage.setItem(key, c + 1); }

function syncDados() { fetch(API_URL + '?sync=1').then(function (r) { return r.json(); }).then(function (d) { setBadge(true); if (d.timeline) renderTimeline(d.timeline); }).catch(function () { setBadge(false); }); }

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

function renderTimeline(items) {
  var el = document.getElementById('timelineList'); if (!items || items.length === 0) { el.innerHTML = '<p style="color:var(--text-tertiary);font-size:.82rem;text-align:center;padding:20px 0;">Nenhum registo feito hoje.</p>'; return; }
  var html = ''; items.forEach(function (it) { var cls = 'tl-' + it.tipo.replace(/\s/g, '_'); html += '<div class="timeline-item"><span class="tl-hora">' + it.hora + '</span><span class="tl-nome">' + it.nome + '</span><span class="tl-tipo ' + cls + '">' + it.tipo + '</span></div>'; }); el.innerHTML = html;
}

function abrirPainel() { document.getElementById('painelModal').classList.add('show'); carregarPainel(); }
function fecharPainel() { document.getElementById('painelModal').classList.remove('show'); }

function carregarPainel(isPrinting) {
  var body = document.getElementById('painelBody');
  body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto; border-top-color:var(--blue);"></div><p style="color:var(--text-tertiary);margin-top:16px;font-size:.85rem;">A sincronizar dados...</p></div>';
  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha)).then(function (r) { return r.json(); }).then(function (d) { if (d.erro) { body.innerHTML = '<p style="color:var(--red);padding:20px;">' + d.erro + '</p>'; return; } renderPainel(d); }).catch(function () { body.innerHTML = '<p style="color:var(--red);padding:20px;">Erro de conexão</p>'; });
}

function renderPainel(d) {
  var h = '<div class="stats-grid"><div class="stat-card blue"><div class="s-value">' + d.presentes + '</div><div class="s-label">Presentes</div></div><div class="stat-card red"><div class="s-value">' + d.ausentes + '</div><div class="s-label">Ausentes</div></div><div class="stat-card orange"><div class="s-value">' + d.totalFuncionarios + '</div><div class="s-label">Total</div></div></div>';
  var rotas = {}; var nomes = Object.keys(d.colaboradores);
  nomes.forEach(function (n) {
    var c = d.colaboradores[n]; var pres = !!c.entrada; var st = '';
    c.registros.forEach(function(r) { if(r.statusGeo.indexOf('VIAGEM') > -1) { var match = r.obs.match(/DESTINO:\s([^|]+)/); var dest = match ? match[1].trim() : 'Rota Indefinida'; if(!rotas[dest]) rotas[dest] = []; if(rotas[dest].indexOf(n) === -1) rotas[dest].push(n); } });
    if (c.saida) st = 'Saiu às ' + c.saida; else if (c.retornoAlmoco) st = 'Retornou ' + c.retornoAlmoco; else if (c.saidaAlmoco) st = 'Almoço desde ' + c.saidaAlmoco; else if (c.entrada) st = 'Entrou às ' + c.entrada; else st = 'Pendente';
    if (c.justificativa) { pres = true; st = 'Justificado: ' + c.justificativa; }
    h += '<div class="ios-card-row" style="background:var(--surface-1); border-radius:12px; margin-bottom:8px; border:1px solid var(--border);"><div class="ios-icon-bg ' + (pres?'green':'red') + '" style="background:var(--'+(pres?'green':'red')+'-soft); color:var(--'+(pres?'green':'red')+');">' + n.substring(0, 2) + '</div><div class="ios-row-content"><div class="ios-row-title">' + n + '</div><div class="ios-row-sub">' + st + '</div></div>';
    if(!pres && !c.justificativa) { h += '<button onclick="abrirJustificativa(\''+n+'\')" class="cam-btn" style="background:var(--orange-soft); color:var(--orange);">Justificar</button>'; } else { h += '<div style="font-weight:700; font-family:var(--font-rounded);">' + (c.entrada || '—') + '</div>'; }
    h += '</div>';
  });
  document.getElementById('painelBody').innerHTML = h;
}

function abrirJustificativa(nome) { document.getElementById('justNome').textContent = nome; document.getElementById('justNomeInput').value = nome; document.getElementById('justMotivo').value = ''; document.getElementById('justModal').classList.add('show'); }
function fecharJustificativa() { document.getElementById('justModal').classList.remove('show'); }
function salvarJustificativa() {
  var motivo = document.getElementById('justMotivo').value.trim(); var nomeColab = document.getElementById('justNomeInput').value;
  if(motivo.length < 3) { toast('Escreva um motivo válido'); return; }
  var btn = document.getElementById('btnSalvarJust'); btn.disabled = true; btn.textContent = 'A guardar...';
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'justificar', nomeColab: nomeColab, motivo: motivo, gestor: sessao.nome }), redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) { if (d.status === 'ok') { fecharJustificativa(); toast(d.msg); carregarPainel(); } else { toast('Erro ao justificar'); } }).catch(function () { toast('Sem conexão'); }).finally(function () { btn.disabled = false; btn.textContent = 'Gravar Justificativa'; });
}

function abrirRelatorio() { document.getElementById('relModal').classList.add('show'); carregarRelatorio(); }
function fecharRelatorio() { document.getElementById('relModal').classList.remove('show'); }
function carregarRelatorio() {
  var body = document.getElementById('relBody');
  body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto; border-top-color:var(--blue);"></div><p style="color:var(--text-tertiary);margin-top:16px;font-size:.85rem;">A calcular horas do mês inteiro...</p></div>';
  fetch(API_URL + '?relatorio=1&senha=' + encodeURIComponent(sessao.senha)).then(function(r){ return r.json(); }).then(function(d){ if (d.erro) { body.innerHTML = '<p style="color:var(--red);padding:20px;">' + d.erro + '</p>'; return; } renderRelatorio(d); }).catch(function() { body.innerHTML = '<p style="color:var(--red);padding:20px;">Erro de conexão</p>'; });
}

function renderRelatorio(d) {
  var h = '<p style="color:var(--text-tertiary);font-size:.82rem;margin-bottom:24px; text-align:center;">Folha Gerada: ' + d.geradoEm + '</p>';
  d.colaboradores.forEach(function (c) {
    h += '<div class="ios-card" style="padding:16px;">';
    h += '<h3 style="font-size:1.1rem; margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:8px;">' + c.nome + '</h3>';
    h += '<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span style="color:var(--text-secondary);">Dias Trabalhados</span><strong>' + c.diasTrabalhados + '</strong></div>';
    h += '<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span style="color:var(--text-secondary);">Total de Horas</span><strong>' + c.horasTotais + '</strong></div>';
    h += '<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span style="color:var(--green);">Horas Extras</span><strong style="color:var(--green);">' + c.horasExtras + '</strong></div>';
    h += '<div style="display:flex; justify-content:space-between;"><span style="color:var(--red);">Atrasos</span><strong style="color:var(--red);">' + c.atrasoTotal + '</strong></div>';
    h += '</div>';
  });
  document.getElementById('relBody').innerHTML = h;
}

function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 3500); }

// ══════════════ ATUALIZAÇÃO DA ETIQUETA ONLINE/OFFLINE ══════════════
function setBadge(on) {
  var b = document.getElementById('badgeStatus');
  if (!b) return;
  b.textContent = on ? 'Online' : 'Offline';
  b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline');
}

// ══════════════════════════════════════════════════════════════
//  TOOLTIPS — Balões de Dúvida (?)
// ══════════════════════════════════════════════════════════════
(function() {
  var tooltipAtivo = null;

  document.addEventListener('click', function(e) {
    var icon = e.target.closest('.help-icon');

    if (!icon) {
      if (tooltipAtivo) { tooltipAtivo.remove(); tooltipAtivo = null; }
      return;
    }

    if (tooltipAtivo) { tooltipAtivo.remove(); tooltipAtivo = null; }

    var texto = icon.getAttribute('data-tooltip');
    if (!texto) return;

    var tip = document.createElement('div');
    tip.className = 'tooltip-balloon';
    tip.textContent = texto;
    document.body.appendChild(tip);

    var rect = icon.getBoundingClientRect();
    var tipHeight = 80;

    // Tenta abrir por CIMA; se não couber, abre por baixo
    if (rect.top > tipHeight + 20) {
      tip.style.bottom = (window.innerHeight - rect.top + 10 + window.scrollY) + 'px';
      tip.style.top = 'auto';
    } else {
      tip.style.top = (rect.bottom + 10 + window.scrollY) + 'px';
      tip.style.bottom = 'auto';
    }

    tip.style.left = Math.max(12, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 292)) + 'px';

    tooltipAtivo = tip;

    setTimeout(function() {
      if (tooltipAtivo === tip) { tip.remove(); tooltipAtivo =<span class="cursor">█</span>
