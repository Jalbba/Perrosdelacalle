/* ===========================================================================
   Ojo al Perro · Rocha — lógica de la app
   =========================================================================== */

'use strict';

// ----------------------------- Constantes ----------------------------------

const TYPE_META = {
  suelto:   { label: 'Perro suelto',        emoji: '🐕', color: '#f59e0b' },
  agresivo: { label: 'Perro agresivo',      emoji: '⚠️', color: '#e11d48' },
  jauria:   { label: 'Jauría',              emoji: '🐾', color: '#8b5cf6' },
  abandono: { label: 'Abandono / maltrato', emoji: '💔', color: '#ec4899' },
  perdido:  { label: 'Perro perdido',       emoji: '🔍', color: '#2563eb' },
  otro:     { label: 'Otro',                emoji: '📋', color: '#6b7280' },
};

const ROCHA_CENTER = [-34.4828, -54.3336];

// ----------------------------- Estado --------------------------------------

const state = {
  reports: [],
  filter: 'todos',
  sort: 'recientes',
  token: null,
  pinLocation: null,     // { lat, lng } elegido en el wizard
  newType: null,
  detailId: null,
};

const deviceId = (() => {
  let id = localStorage.getItem('oap-device');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem('oap-device', id);
  }
  return id;
})();

const myVotes = new Set(JSON.parse(localStorage.getItem('oap-votes') || '[]'));
function saveVotes() { localStorage.setItem('oap-votes', JSON.stringify([...myVotes])); }

// ----------------------------- Utilidades ----------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

const rtf = new Intl.RelativeTimeFormat('es-UY', { numeric: 'auto' });
function timeAgo(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return 'recién';
}

function fullDate(iso) {
  return new Date(iso).toLocaleString('es-UY', { dateStyle: 'medium', timeStyle: 'short' });
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo salió mal. Probá de nuevo.');
  return data;
}

async function refreshToken() {
  try {
    const { token } = await api('/api/token');
    state.token = token;
  } catch { /* se reintenta al enviar */ }
}

// ----------------------------- Mapa ----------------------------------------

const map = L.map('map', { zoomControl: false }).setView(ROCHA_CENTER, 10);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

L.control.zoom({ position: 'bottomleft' }).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

function markerIcon(type) {
  const meta = TYPE_META[type] || TYPE_META.otro;
  return L.divIcon({
    className: 'dog-marker',
    html: `<div class="pin" style="background:${meta.color}"><span>${meta.emoji}</span></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
  });
}

function renderMarkers() {
  markersLayer.clearLayers();
  for (const r of filteredReports()) {
    L.marker([r.lat, r.lng], { icon: markerIcon(r.type) })
      .on('click', () => openDetail(r.id))
      .addTo(markersLayer);
  }
}

$('#btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Tu navegador no soporta geolocalización', true);
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
    () => toast('No pudimos acceder a tu ubicación', true),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

// ----------------------------- Datos ----------------------------------------

function filteredReports() {
  let list = state.filter === 'todos' ? state.reports : state.reports.filter((r) => r.type === state.filter);
  if (state.sort === 'votados') list = [...list].sort((a, b) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt));
  return list;
}

async function loadReports() {
  try {
    const { reports } = await api('/api/reports');
    state.reports = reports;
    renderMarkers();
    renderList();
  } catch (e) {
    toast(e.message, true);
  }
}

// ----------------------------- Lista ----------------------------------------

function renderList() {
  const list = filteredReports();
  const wrap = $('#report-cards');
  $('#list-empty').classList.toggle('hidden', list.length > 0);

  const monthAgo = Date.now() - 30 * 86400000;
  const recent = state.reports.filter((r) => new Date(r.createdAt).getTime() > monthAgo).length;
  $('#list-stats').textContent = recent === 1
    ? '1 reporte en los últimos 30 días'
    : `${recent} reportes en los últimos 30 días`;

  wrap.innerHTML = list.map((r) => {
    const meta = TYPE_META[r.type] || TYPE_META.otro;
    return `
      <article class="card" style="border-left-color:${meta.color}" data-id="${r.id}">
        <div class="card-top">
          <span class="card-type">${meta.emoji} ${meta.label}</span>
          <span class="card-time">${timeAgo(r.createdAt)}</span>
        </div>
        <p class="card-desc">${esc(r.description.length > 160 ? r.description.slice(0, 160) + '…' : r.description)}</p>
        <div class="card-foot">
          <span>👍 ${r.votes}</span>
          <span>💬 ${r.comments}</span>
          ${r.driveLink ? '<span class="has-media">📷 Con fotos</span>' : ''}
        </div>
      </article>`;
  }).join('');

  wrap.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => openDetail(Number(card.dataset.id)));
  });
}

// ----------------------------- Filtros y orden ------------------------------

$('#filter-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('#filter-chips .chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  state.filter = chip.dataset.type;
  renderMarkers();
  renderList();
});

$('.list-sort').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('.list-sort .chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  state.sort = chip.dataset.sort;
  renderList();
});

// ----------------------------- Navegación -----------------------------------

function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'map') setTimeout(() => map.invalidateSize(), 60);
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));

// ----------------------------- Sheets ---------------------------------------

function openSheet(id) { $(`#${id}`).classList.remove('hidden'); }
function closeSheet(id) { $(`#${id}`).classList.add('hidden'); }

$$('.sheet-close').forEach((btn) => btn.addEventListener('click', () => closeSheet(btn.dataset.close)));
$$('.sheet-backdrop').forEach((bk) => bk.addEventListener('click', (e) => {
  if (e.target === bk) bk.classList.add('hidden');
}));

// ----------------------------- Wizard: nuevo reporte ------------------------

const WIZ_TITLES = { 1: '¿Qué pasó?', 2: '¿Dónde pasó?', 3: 'Fotos y publicar' };

function gotoStep(n) {
  $$('#sheet-new .wstep').forEach((s) => s.classList.toggle('active', s.dataset.step == n));
  $$('#sheet-new .dot').forEach((d, i) => d.classList.toggle('active', i === n - 1));
  $('#new-title').textContent = WIZ_TITLES[n];
}

function localNowValue() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

$('#fab').addEventListener('click', () => {
  state.newType = null;
  state.pinLocation = null;
  $$('#type-grid .type-btn').forEach((b) => b.classList.remove('active'));
  $('#new-description').value = '';
  $('#desc-count').textContent = '0 / 1000';
  $('#new-drive').value = '';
  $('#new-website').value = '';
  $('#new-when').value = localNowValue();
  $('#new-when').max = localNowValue();
  $('#step2-status').classList.add('hidden');
  $('#step2-next').disabled = true;
  gotoStep(1);
  openSheet('sheet-new');
  refreshToken();
});

$('#type-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-btn');
  if (!btn) return;
  $$('#type-grid .type-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.newType = btn.dataset.type;
});

$('#new-description').addEventListener('input', (e) => {
  $('#desc-count').textContent = `${e.target.value.length} / 1000`;
});

$('#step1-next').addEventListener('click', () => {
  if (!state.newType) return toast('Elegí el tipo de situación 🐕', true);
  if ($('#new-description').value.trim().length < 10) return toast('Contanos un poco más de lo que pasó (mínimo 10 caracteres)', true);
  if (!$('#new-when').value) return toast('Indicá cuándo pasó', true);
  gotoStep(2);
});

$$('#sheet-new [data-goto]').forEach((b) => b.addEventListener('click', () => gotoStep(Number(b.dataset.goto))));

// --- Paso 2: elegir el punto sobre el mapa principal ---

function startPinPicker(center) {
  closeSheet('sheet-new');
  showView('map');
  if (center) map.setView(center, 16);
  else if (map.getZoom() < 13) map.setView(ROCHA_CENTER, 13);
  $('#pin-picker').classList.remove('hidden');
}

function endPinPicker() {
  $('#pin-picker').classList.add('hidden');
  openSheet('sheet-new');
  gotoStep(2);
}

$('#step2-pick').addEventListener('click', () => startPinPicker(state.pinLocation && [state.pinLocation.lat, state.pinLocation.lng]));

$('#step2-gps').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Tu navegador no soporta geolocalización', true);
  toast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    (pos) => startPinPicker([pos.coords.latitude, pos.coords.longitude]),
    () => toast('No pudimos acceder a tu ubicación. Marcá el punto a mano.', true),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

$('#pin-confirm').addEventListener('click', () => {
  const c = map.getCenter();
  state.pinLocation = { lat: c.lat, lng: c.lng };
  $('#step2-status').classList.remove('hidden');
  $('#step2-next').disabled = false;
  endPinPicker();
});

$('#pin-cancel').addEventListener('click', endPinPicker);

$('#step2-next').addEventListener('click', () => {
  if (!state.pinLocation) return toast('Marcá el lugar en el mapa', true);
  gotoStep(3);
});

// --- Paso 3: enviar ---

$('#btn-submit').addEventListener('click', async () => {
  const btn = $('#btn-submit');
  btn.disabled = true;
  btn.textContent = 'Publicando…';
  try {
    if (!state.token) await refreshToken();
    const { id } = await api('/api/reports', {
      method: 'POST',
      body: {
        type: state.newType,
        description: $('#new-description').value,
        lat: state.pinLocation?.lat,
        lng: state.pinLocation?.lng,
        occurredAt: new Date($('#new-when').value).toISOString(),
        driveLink: $('#new-drive').value.trim() || null,
        deviceId,
        token: state.token,
        website: $('#new-website').value,
      },
    });
    closeSheet('sheet-new');
    state.token = null;
    toast('¡Gracias! Tu reporte ya está en el mapa 🐾');
    await loadReports();
    if (state.pinLocation) map.setView([state.pinLocation.lat, state.pinLocation.lng], 15);
    showView('map');
    if (id) setTimeout(() => openDetail(id), 350);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publicar reporte 🐾';
  }
});

// ----------------------------- Detalle ---------------------------------------

async function openDetail(id) {
  state.detailId = id;
  try {
    const { report } = await api(`/api/reports/${id}`);
    renderDetail(report);
    openSheet('sheet-detail');
  } catch (e) {
    toast(e.message, true);
  }
}

function renderDetail(r) {
  const meta = TYPE_META[r.type] || TYPE_META.otro;
  const voted = myVotes.has(r.id);
  $('#detail-title').textContent = `${meta.emoji} ${meta.label}`;

  $('#detail-body').innerHTML = `
    <div class="detail-meta">
      <span class="detail-badge" style="background:${meta.color}">${meta.emoji} ${meta.label}</span>
      <span class="detail-time">Ocurrió: ${fullDate(r.occurredAt)}<br>Publicado ${timeAgo(r.createdAt)}</span>
    </div>
    <p class="detail-desc">${esc(r.description)}</p>
    ${r.driveLink ? `<a class="detail-media" href="${esc(r.driveLink)}" target="_blank" rel="noopener noreferrer">📷 Ver fotos / videos del hecho ↗</a>` : ''}
    <div class="detail-actions">
      <button class="btn btn-outline btn-vote ${voted ? 'voted' : ''}" id="btn-vote">
        👍 <span id="vote-count">${r.votes}</span> ${voted ? '¡A vos también!' : 'A mí también me pasó'}
      </button>
      <button class="btn btn-outline" id="btn-share">📤 Compartir</button>
    </div>
    <div class="comments">
      <h3>💬 Comentarios</h3>
      <div id="comment-list">
        ${r.commentList.length === 0 ? '<p class="no-comments">Sin comentarios todavía. ¿Viste algo? Contalo acá 👇</p>' : r.commentList.map(commentHtml).join('')}
      </div>
      <div class="comment-form">
        <textarea id="comment-body" rows="2" maxlength="600" placeholder="¿Viste lo mismo? Sumá tu testimonio (anónimo)…"></textarea>
        <input type="url" id="comment-drive" inputmode="url" placeholder="Link a tus fotos en Google Drive (opcional)">
        <button class="btn btn-primary" id="btn-comment">Comentar</button>
      </div>
    </div>`;

  $('#btn-vote').addEventListener('click', () => vote(r.id));
  $('#btn-share').addEventListener('click', () => share(r));
  $('#btn-comment').addEventListener('click', () => sendComment(r.id));
}

function commentHtml(c) {
  return `
    <div class="comment">
      <p>${esc(c.body)}</p>
      ${c.driveLink ? `<a href="${esc(c.driveLink)}" target="_blank" rel="noopener noreferrer">📷 Ver fotos ↗</a>` : ''}
      <span class="comment-time">${timeAgo(c.createdAt)}</span>
    </div>`;
}

async function vote(id) {
  try {
    const { voted, votes } = await api(`/api/reports/${id}/vote`, { method: 'POST', body: { deviceId } });
    if (voted) myVotes.add(id); else myVotes.delete(id);
    saveVotes();
    const btn = $('#btn-vote');
    btn.classList.toggle('voted', voted);
    btn.innerHTML = `👍 <span id="vote-count">${votes}</span> ${voted ? '¡A vos también!' : 'A mí también me pasó'}`;
    const item = state.reports.find((r) => r.id === id);
    if (item) { item.votes = votes; renderList(); }
  } catch (e) {
    toast(e.message, true);
  }
}

async function sendComment(id) {
  const body = $('#comment-body').value.trim();
  if (body.length < 3) return toast('Escribí un comentario un poco más largo', true);
  const btn = $('#btn-comment');
  btn.disabled = true;
  try {
    if (!state.token) await refreshToken();
    const { comments } = await api(`/api/reports/${id}/comments`, {
      method: 'POST',
      body: { body, driveLink: $('#comment-drive').value.trim() || null, token: state.token, website: '' },
    });
    $('#comment-list').innerHTML = comments.map(commentHtml).join('');
    $('#comment-body').value = '';
    $('#comment-drive').value = '';
    toast('Comentario publicado 💬');
    const item = state.reports.find((r) => r.id === id);
    if (item) { item.comments = comments.length; renderList(); }
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function share(r) {
  const meta = TYPE_META[r.type] || TYPE_META.otro;
  const url = `${location.origin}/#reporte-${r.id}`;
  const text = `${meta.emoji} ${meta.label} en Rocha: "${r.description.slice(0, 120)}" — Mirá el reporte en Ojo al Perro`;
  if (navigator.share) {
    navigator.share({ title: 'Ojo al Perro · Rocha', text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(`${text} ${url}`).then(
      () => toast('Link copiado al portapapeles 📋'),
      () => toast('No se pudo copiar el link', true)
    );
  }
}

// ----------------------------- Inicio ---------------------------------------

// Deep-link: /#reporte-123 abre ese reporte
function handleHash() {
  const m = location.hash.match(/^#reporte-(\d+)$/);
  if (m) openDetail(Number(m[1]));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

refreshToken();
loadReports().then(handleHash);

// Refrescar datos al volver a la app
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadReports();
});
