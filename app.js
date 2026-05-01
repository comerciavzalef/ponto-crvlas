// ══════════════════════════════════════════════════════════════
//  PONTO DIGITAL — app.js v11.0 (Top Horas, WhatsApp & Zero Latency)
//  Grupo Carlos Vaz — CRV/LAS
// ══════════════════════════════════════════════════════════════

// =====================================================================
// 🛡️ MÓDULO DE TELEMETRIA: CONEXÃO COM A CENTRAL DO DESENVOLVEDOR (SAAS)
// =====================================================================

// 1. IDENTIDADE DO CLIENTE (Altere apenas isto para cada empresa nova)
const APP_CONFIG = {
    idCliente: "CRV_BAHIA",        // O "RG" da empresa na sua planilha mestra
    aplicativo: "PONTO_APP",     // Identifica qual app está rodando (Estoque ou Ponto)
    urlCentral: "COLE_AQUI_A_URL_DO_SEU_NOVO_APPS_SCRIPT" // A URL que a outra IA vai gerar na Fase 1
};

// 2. O "ESPIÃO" (Não precisa alterar nada daqui para baixo)
window.addEventListener('error', function(event) {
    // 2.1 - Descobre quem está usando (Ajuste se o seu select de usuário tiver outro ID)
    let usuarioLogado = "Não identificado";
    try {
        const campoUsuario = document.getElementById("usuarioSelect"); // ID do campo do Luiz, Tassio, etc.
        if (campoUsuario) usuarioLogado = campoUsuario.value;
    } catch(e) {}

    // 2.2 - Empacota o erro
    const fofoca = {
        idCliente: APP_CONFIG.idCliente,
        aplicativo: APP_CONFIG.aplicativo,
        usuario: usuarioLogado,
        dispositivo: navigator.userAgent, // Pega o modelo do celular (Ex: Poco X7, iPhone)
        tipoLog: "ERRO CRÍTICO",
        mensagemErro: event.message + " | Linha: " + event.lineno
    };

    // 2.3 - Envia silenciosamente para a sua Planilha Mestra
    fetch(APP_CONFIG.urlCentral, {
        method: 'POST',
        mode: 'no-cors', // O 'no-cors' é essencial para o envio ser invisível e não travar o celular
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(fofoca)
    }).catch(err => console.log("A Central está offline, erro não enviado."));
});
// =====================================================================

var API_URL = 'https://script.google.com/macros/s/AKfycbzw_DCKo-0c3EMxWHgajCs8FxVYxtghYXSerldjBaTSu5lKsKqUYr5-vOLTYOuYsUFRUg/exec';
var SESSION_KEY = 'cv_ponto_sessao';
var RAIO_LIMITE = 50; 
var LAT_EMPRESA = -14.842472;
var LNG_EMPRESA = -39.987250;

var CREDS_OFFLINE = {
  'LUCAS':  '1e79f09abad6c8321bf6a1dee19aa4949ce95fa3f962361869c406555ade9062', 
  'TASSIO': '53c822e4be542a847100324d05458d7c155d9a0a3ee2c8ea6a621c3b426b123d',
  'AMARAL': 'd16bcb871bbfe495833cee0fd592bbf47540fee7801ade3d8ccf7b97372ad042', 
  'ALEX':   'e3f961a998c170860de4cab5c8f9548522a1938d6599cf40f827333b503d8eed',
  'GESTOR': '704bd714166d21ac85ed8a26fbde6b9be2d94981934305be4a7915a8bbd0c157'
};

var sessao = null;
var tipoSelecionado = '';
var selfieData = '';
var geoAtual = { lat: 0, lng: 0, dist: null, dentro: false };
var refreshInterval = null;
var stream = null;
var avisoViagemFeito = false; 
var dadosGestorCache = null; 

(function () {
  var s = localStorage.getItem(SESSION_KEY);
  if (s) { try { sessao = JSON.parse(s); if (sessao && sessao.nome) { esconderLogin(); iniciarApp(); return; } } catch (e) { } }
})();

function toggleSenha() {
  var input = document.getElementById('loginPass');
  var icon = document.getElementById('eyeIcon');
  if (input.type === 'password') { input.type = 'text'; icon.textContent = '🙈'; } else { input.type = 'password'; icon.textContent = '👁️'; }
}

async function fazerLogin() {
  var user = document.getElementById('loginUser').value.trim().toUpperCase();
  var pass = document.getElementById('loginPass').value.trim();
  var err = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');
  var lgpd = document.getElementById('lgpdCheck');

  err.textContent = '';
  if (!user || !pass) { err.textContent = 'Preencha todos os campos'; shakeLogin(); return; }
  if (lgpd && !lgpd.checked) { err.textContent = 'Aceite os termos da LGPD para entrar'; shakeLogin(); return; }
  
  btn.disabled = true; btn.textContent = 'Autenticando...';

  try {
    var senhaHash = await gerarHash(pass);
    fetch(API_URL, { 
      method: 'POST', 
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
      body: JSON.stringify({ acao: 'login', usuario: user, senha: senhaHash }), 
      redirect: 'follow' 
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status === 'ok') { 
        sessao = { nome: d.nome, nivel: d.nivel, senha: senhaHash }; 
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)); 
        esconderLogin(); iniciarApp(); 
      } else { 
        err.textContent = d.msg || 'Credenciais inválidas'; shakeLogin(); 
      }
    }).catch(function () {
      if (CREDS_OFFLINE[user] && CREDS_OFFLINE[user] === senhaHash) { 
        sessao = { nome: user, nivel: user === 'GESTOR' ? 'gestor' : 'funcionario', senha: senhaHash }; 
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)); 
        esconderLogin(); iniciarApp(); 
      } else { 
        err.textContent = 'Sem conexão e credenciais inválidas'; shakeLogin(); 
      }
    }).finally(function () { btn.disabled = false; btn.textContent = 'Entrar'; });

  } catch(e) {
    err.textContent = 'Erro de segurança'; shakeLogin();
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

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
  avisoViagemFeito = false; dadosGestorCache = null;
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

  loadSequence([ { t: 'Autenticando...', p: 20 }, { t: 'Preparando módulo...', p: 50 }, { t: 'Calibrando GPS...', p: 80 }, { t: 'Pronto!', p: 100 } ], function () {
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
    var txt = geoAtual.dentro ? 'Ponto Liberado' : 'Registro Bloqueado'; 
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
    var txt = geoAtual.dentro ? 'Ponto Liberado' : 'Registro Bloqueado'; 
    var cls = geoAtual.dentro ? 'green' : 'red'; 
    var sub = geoAtual.dentro ? 'Dentro do perímetro da CRV/LAS.' : 'Fora do alcance (' + Math.round(geoAtual.dist) + 'm).';
    updateGeoUI(txt, cls, sub); 
  } 
  checkSubmit();
}

function selectType(labelEl, tipo) { tipoSelecionado = tipo; checkSubmit(); }

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

// ⚡ LATÊNCIA ZERO NO REGISTRO (Optimistic UI)
function registrarPonto() {
  var btn = document.getElementById('submitBtn'); btn.disabled = true; btn.textContent = 'Enviando...';
  var isViagem = document.getElementById('viagemSwitchToggle').classList.contains('on'); 
  var destinoText = document.getElementById('viagemDestino').value.trim();
  
  // Resposta Otimista Imediata
  showSuccess({ dentroDoRaio: true, mensagem: 'Enviando Registro...', hora: '--:--', statusGeo: 'Sincronizando em 2º plano' });
  
  var payload = { nome: sessao.nome, tipo: tipoSelecionado, selfie: selfieData, lat: geoAtual.lat, lng: geoAtual.lng, dispositivo: navigator.userAgent.substring(0, 60), ip: '', viagem: isViagem, destino: destinoText };
  
  resetAfterSubmit();
  
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' })
  .then(function (r) { return r.json(); })
  .then(function (d) { 
    if (d.status === 'ok') { incrementSession(); syncDados(); } 
  }).catch(function () { toast('Registro local. Sincronizando...'); });
}

function showSuccess(d) { document.getElementById('successIcon').textContent = d.dentroDoRaio ? '✅' : '⚠️'; document.getElementById('successMsg').textContent = d.mensagem || 'Registro Salvo!'; document.getElementById('successDetail').textContent = d.hora + ' • ' + d.statusGeo; var ov = document.getElementById('successOverlay'); ov.classList.add('show'); setTimeout(function () { ov.classList.remove('show'); }, 3000); }
function resetAfterSubmit() { 
  resetCamera(); 
  tipoSelecionado = ''; 
  document.querySelectorAll('input[name="pontoType"]').forEach(function(r){ r.checked = false; });
  if(document.getElementById('viagemSwitchToggle').classList.contains('on')) { toggleViagem(); } 
  checkSubmit(); 
}
function incrementSession() { var key = 'p_' + sessao.nome + '_sc'; var c = parseInt(localStorage.getItem(key) || '0'); localStorage.setItem(key, c + 1); }

function syncDados() { fetch(API_URL + '?sync=1').then(function (r) { return r.json(); }).then(function (d) { setBadge(true); if (d.timeline) renderTimeline(d.timeline, 'timelineList'); }).catch(function () { setBadge(false); }); }

// 🔍 DRILL-DOWN: LISTAS ESPECÍFICAS DOS CARDS (COM INTEGRAÇÃO WHATSAPP)
function abrirLista(tipo) {
  if (!dadosGestorCache) { toast("Aguarde a sincronização de dados..."); return; }
  var titulo = document.getElementById('listaRapidaTitulo');
  var body = document.getElementById('listaRapidaBody');
  var html = '';

  if (tipo === 'viagem') {
    titulo.textContent = "🚗 Colaboradores em Rota";
    var viagens = [];
    Object.keys(dadosGestorCache.colaboradores).forEach(n => {
      var r = dadosGestorCache.colaboradores[n].registros.find(reg => reg.statusGeo.indexOf('VIAGEM') > -1);
      if(r) viagens.push({nome: n, destino: r.obs, hora: r.hora});
    });
    if(viagens.length === 0) html = '<p class="empty-text">Ninguém em viagem no momento.</p>';
    viagens.forEach(v => {
      var infoDestino = v.destino.replace('DESTINO: ', '');
      html += `<div class="ios-card-row" style="background:var(--surface-1); border-radius:12px; margin-bottom:8px; border:1px solid var(--border);"><div class="ios-icon-bg" style="background:var(--orange-soft); color:var(--orange);">🚗</div><div class="ios-row-content"><div class="ios-row-title">${v.nome}</div><div class="ios-row-sub">${infoDestino}</div></div><div class="tl-hora">${v.hora}</div></div>`;
    });
  } else if (tipo === 'presentes') {
    titulo.textContent = "👥 Presentes Agora";
    Object.keys(dadosGestorCache.colaboradores).forEach(n => {
      var c = dadosGestorCache.colaboradores[n];
      if(c.entrada && !c.saida) html += `<div class="ios-card-row" style="background:var(--surface-1); border-radius:12px; margin-bottom:8px; border:1px solid var(--border);"><div class="ios-icon-bg" style="background:var(--green-soft); color:var(--green);">✅</div><div class="ios-row-content"><div class="ios-row-title">${n}</div><div class="ios-row-sub">Entrou às ${c.entrada}</div></div></div>`;
    });
    if(!html) html = '<p class="empty-text">Nenhum funcionário na base.</p>';
  } else if (tipo === 'alertas') {
    titulo.textContent = "⚠️ Alertas de Localização";
    dadosGestorCache.alertas.forEach(a => {
      html += `<div class="ios-card-row" style="background:var(--surface-1); border-radius:12px; margin-bottom:8px; border:1px solid var(--border);"><div class="ios-icon-bg" style="background:var(--red-soft); color:var(--red);">📍</div><div class="ios-row-content"><div class="ios-row-title">${a.nome}</div><div class="ios-row-sub">Fora do limite na ${a.tipo}</div></div><div class="tl-hora">${a.hora}</div></div>`;
    });
    if(!html) html = '<p class="empty-text">Tudo regular hoje. Nenhum bloqueio de GPS.</p>';
  } else if (tipo === 'pendentes') {
    titulo.textContent = "⏳ Pendentes (Sem Registro)";
    
    // Lógica para verificar se passou das 08:10 da manhã
    var agora = new Date();
    var minutosHoje = (agora.getHours() * 60) + agora.getMinutes();
    var passouDaHora = minutosHoje > 490; // 490 = 08h10min
    
    Object.keys(dadosGestorCache.colaboradores).forEach(n => {
      var c = dadosGestorCache.colaboradores[n];
      if(!c.entrada && !c.justificativa) {
        var btnZap = '';
        if (passouDaHora) {
            var msgZap = encodeURIComponent(`Fala ${n}, bom dia! O sistema acusou que você ainda não registrou o ponto de entrada hoje. Tudo certo por aí?`);
            btnZap = `<a href="https://wa.me/?text=${msgZap}" target="_blank" class="cam-btn" style="padding:6px 12px; background:var(--green-soft); color:var(--green); text-decoration:none; font-size:0.75rem; font-weight:700;">💬 Cobrar</a>`;
        }
        html += `<div class="ios-card-row" style="background:var(--surface-1); border-radius:12px; margin-bottom:8px; border:1px solid var(--border); padding-right:10px;"><div class="ios-icon-bg" style="background:var(--surface-3); color:var(--text-tertiary);">⏳</div><div class="ios-row-content"><div class="ios-row-title">${n}</div><div class="ios-row-sub">Ainda não registrou o ponto hoje</div></div>${btnZap}</div>`;
      }
    });
    if(!html) html = '<p class="empty-text">Todos os colaboradores já registraram o ponto hoje.</p>';
  }

  body.innerHTML = html;
  document.getElementById('listaRapidaModal').classList.add('show');
}

function fecharLista() { document.getElementById('listaRapidaModal').classList.remove('show'); }

// 📊 ATUALIZAÇÃO DO GESTOR E DA TIMELINE
function syncGestor() {
  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha)).then(function (r) { return r.json(); }).then(function (d) {
    if (d.erro) return;
    dadosGestorCache = d; 
    document.getElementById('statPresentes').textContent = d.presentes || 0;
    document.getElementById('statAlertas').textContent = (d.alertas ? d.alertas.length : 0);
    document.getElementById('statPendentes').textContent = d.ausentes || 0;
    
    var emViagem = [];
    var nomes = Object.keys(d.colaboradores);
    nomes.forEach(function(n) { if (d.colaboradores[n].registros.some(r => r.statusGeo.indexOf('VIAGEM') > -1)) { emViagem.push(n); } });
    document.getElementById('statViagem').textContent = emViagem.length;
    
    // Alimenta a Timeline Recente no dashboard do Gestor
    var todasAtividades = [];
    nomes.forEach(n => { d.colaboradores[n].registros.forEach(r => { todasAtividades.push({nome: n, hora: r.hora, tipo: r.tipo}); }); });
    todasAtividades.sort((a,b) => b.hora.localeCompare(a.hora));
    renderTimeline(todasAtividades.slice(0, 10), 'timelineGestor');

    if (!avisoViagemFeito && emViagem.length > 0) { toast("📍 Atenção: " + emViagem.join(", ") + " na estrada hoje."); avisoViagemFeito = true; }
    
    carregarTopHoras(); // Roda a métrica das Horas Extras
  }).catch(function () { });
}

function renderTimeline(items, targetId) {
  var el = document.getElementById(targetId); 
  if (!items || items.length === 0) { el.innerHTML = '<p class="empty-text">Sem atividade recente.</p>'; return; }
  var html = ''; 
  items.forEach(function (it) { 
    var cls = 'tl-' + it.tipo.replace(/\s/g, '_'); 
    html += '<div class="timeline-item"><span class="tl-hora">' + it.hora + '</span><span class="tl-nome">' + it.nome + '</span><span class="tl-tipo ' + cls + '">' + it.tipo + '</span></div>'; 
  }); 
  el.innerHTML = html;
}

// 🌡️ MOTOR DO TERMÔMETRO (Roda silencioso em 2º plano)
function carregarTopHoras() {
  fetch(API_URL + '?relatorio=1&senha=' + encodeURIComponent(sessao.senha))
  .then(function(r) { return r.json(); })
  .then(function(d) {
     if(d.erro) return;
     var comExtras = d.colaboradores.filter(function(c) { return c.horasExtras !== '00:00'; });
     comExtras.sort(function(a,b) { return b.horasExtras.localeCompare(a.horasExtras); });
     var top = comExtras.slice(0, 3);
     if(top.length === 0) {
        document.getElementById('topHorasWidget').innerHTML = '<div class="ios-card" style="padding:16px; text-align:center;"><p style="color:var(--green); font-weight:600; margin:0;">✅ Nenhuma hora extra acumulada</p></div>';
        return;
     }
     var h = '<div class="ios-card" style="margin-bottom:0;">';
     top.forEach(function(c, idx) {
        var medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : '🥉');
        h += `<div class="ios-card-row">
                <div class="ios-icon-bg" style="background:var(--orange-soft); color:var(--orange); font-size:1.4rem;">${medal}</div>
                <div class="ios-row-content">
                  <div class="ios-row-title">${c.nome}</div>
                  <div class="ios-row-sub">Acumulado mensal</div>
                </div>
                <div class="tl-hora" style="color:var(--orange); font-size:1.1rem;">${c.horasExtras}</div>
              </div>`;
     });
     h += '</div>';
     document.getElementById('topHorasWidget').innerHTML = h;
  });
}

function abrirPainel() { document.getElementById('painelModal').classList.add('show'); carregarPainel(); }
function fecharPainel() { document.getElementById('painelModal').classList.remove('show'); }

function carregarPainel(isPrinting) {
  var body = document.getElementById('painelBody');
  body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto; border-top-color:var(--blue);"></div><p style="color:var(--text-tertiary);margin-top:16px;font-size:.85rem;">Sincronizando dados...</p></div>';
  fetch(API_URL + '?painel=1&senha=' + encodeURIComponent(sessao.senha)).then(function (r) { return r.json(); }).then(function (d) { if (d.erro) { body.innerHTML = '<p style="color:var(--red);padding:20px;">' + d.erro + '</p>'; return; } renderPainel(d); }).catch(function () { body.innerHTML = '<p style="color:var(--red);padding:20px;">Erro de conexão</p>'; });
}

function renderPainel(d) {
  var h = '';
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
  var btn = document.getElementById('btnSalvarJust'); btn.disabled = true; btn.textContent = 'Salvando...';
  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ acao: 'justificar', nomeColab: nomeColab, motivo: motivo, gestor: sessao.nome }), redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) { if (d.status === 'ok') { fecharJustificativa(); toast(d.msg); carregarPainel(); } else { toast('Erro ao justificar'); } }).catch(function () { toast('Sem conexão'); }).finally(function () { btn.disabled = false; btn.textContent = 'Salvar Justificativa'; });
}

function abrirRelatorio() { document.getElementById('relModal').classList.add('show'); carregarRelatorio(); }
function fecharRelatorio() { document.getElementById('relModal').classList.remove('show'); }
function carregarRelatorio() {
  var body = document.getElementById('relBody');
  body.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div class="ld-spinner" style="margin:0 auto; border-top-color:var(--blue);"></div><p style="color:var(--text-tertiary);margin-top:16px;font-size:.85rem;">Calculando horas do mês inteiro...</p></div>';
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

function setBadge(on) {
  var b = document.getElementById('badgeStatus');
  if (!b) return;
  b.textContent = on ? 'Online' : 'Offline';
  b.className = 'badge ' + (on ? 'badge-online' : 'badge-offline');
}

(function() {
  var tooltipAtivo = null;
  document.addEventListener('click', function(e) {
    var icon = e.target.closest('.help-icon');
    if (!icon) { if (tooltipAtivo) { tooltipAtivo.remove(); tooltipAtivo = null; } return; }
    if (tooltipAtivo) { tooltipAtivo.remove(); tooltipAtivo = null; }
    var texto = icon.getAttribute('data-tooltip'); if (!texto) return;
    var tip = document.createElement('div');
    tip.className = 'tooltip-balloon'; tip.textContent = texto; document.body.appendChild(tip);
    var rect = icon.getBoundingClientRect(); var tipHeight = 80;
    if (rect.top > tipHeight + 20) { tip.style.bottom = (window.innerHeight - rect.top + 10 + window.scrollY) + 'px'; tip.style.top = 'auto'; } else { tip.style.top = (rect.bottom + 10 + window.scrollY) + 'px'; tip.style.bottom = 'auto'; }
    tip.style.left = Math.max(12, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 292)) + 'px';
    tooltipAtivo = tip; setTimeout(function() { if (tooltipAtivo === tip) { tip.remove(); tooltipAtivo = null; } }, 5000);
  });
})();

// ══════════════ MOTOR DOS BALÕES DE AJUDA (MOBILE TOUCH) ══════════════
document.addEventListener('click', function(e) {
  // Se clicou fora, fecha qualquer balão aberto
  if (!e.target.classList.contains('help-icon')) {
    document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove());
    document.querySelectorAll('.help-icon.active').forEach(i => i.classList.remove('active'));
    return;
  }

  // Se clicou no ícone
  var icon = e.target;
  
  // Se já estava aberto, fecha
  if (icon.classList.contains('active')) {
    icon.classList.remove('active');
    document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove());
    return;
  }

  // Fecha outros abertos
  document.querySelectorAll('.tooltip-balloon').forEach(b => b.remove());
  document.querySelectorAll('.help-icon.active').forEach(i => i.classList.remove('active'));

  // Ativa o atual
  icon.classList.add('active');
  var texto = icon.getAttribute('data-tooltip');
  
  // Cria o balão
  var balloon = document.createElement('div');
  balloon.className = 'tooltip-balloon';
  balloon.textContent = texto;
  document.body.appendChild(balloon);

  // Posiciona o balão perfeitamente acima do ícone
  var rect = icon.getBoundingClientRect();
  balloon.style.left = (rect.left + (rect.width / 2)) + 'px';
  balloon.style.top = (rect.top - balloon.offsetHeight - 10) + 'px';
});
