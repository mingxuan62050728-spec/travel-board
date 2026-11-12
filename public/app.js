'use strict';
/* 足迹板 TravelBoard 前端（极简版） */

const CATS = {
  spot: '景点', region: '地区', hotel: '酒店', restaurant: '餐厅', cafe: '咖啡',
  toilet: '卫生间', transport: '交通', nature: '自然', shopping: '购物', other: '其他',
};
const CAT_EMOJI = {
  spot: '🏛️', region: '🗺️', hotel: '🏨', restaurant: '🍽️', cafe: '☕',
  toilet: '🚻', transport: '🚉', nature: '🏞️', shopping: '🛍️', other: '📍',
};
const TRACK_COLORS = ['#e74c3c', '#3498db', '#9b59b6', '#16a085', '#f39c12', '#e67e22', '#1abc9c', '#c0392b'];
const PHOTO_ZOOM = 13;

const AVATARS = ['🙂','😀','😎','🤠','🧑‍🚀','🧑‍🎤','🧑‍🎨','🧑‍🍳','🕵️','🥷','🧙','🧚','🦊','🐱','🐶','🐼','🐯','🦁','🐸','🐙','🦄','🐳','🦋','🌸','🍀','🌵','🌊','🏔️','🚲','🚀','🎒','📷','🎧','⚽','🎮','🎨','☕','🍜','🧳','🗺️'];

const TUTORIAL = [
  { e: '📍', t: '欢迎来到足迹板', x: '这是一块多人共享的世界地图，用来记录你走过的每一个地方、去过的每一家店。' },
  { e: '➕', t: '点亮足迹', x: '点屏幕下方工具栏的「加地点」，再点地图把图钉钉上去，勾选「我去过」就能点亮它。左下角头像和右下角 ＋ 号都能拖动位置。' },
  { e: '🖼', t: '贴照片', x: '把地图放大到城市级，照片会像贴纸一样贴在地图上。照片默认仅自己可见，想分享勾选「共享给伙伴」即可。' },
  { e: '⭐', t: '打分评价', x: '点任意图钉即可打 1-5 星并写评论——景点、酒店、餐厅，甚至卫生间都能评，还能看伙伴的评分。' },
  { e: '🧭', t: '轨迹与路线', x: '在头像菜单的「轨迹」页可以画轨迹；「路线」页点地图添加途经点，保存后一键生成分享链接。' },
  { e: '🔍', t: '搜索 · 定位', x: '右上角 🔍 搜索任意地名一键飞到目的地；📍 一键定位并缩放到你当前所在的位置。' },
  { e: '🗺️', t: '地图与语言', x: '右上角 🗺️ 切换标准 / 卫星地图（卫星图也显示地名）；地图语言在头像菜单的「设置」里切换中文 / English。' },
  { e: '👁', t: '纯净模式 · 分享', x: '右上角 👁 一键隐藏所有界面、只看地图；屏幕下方分享图标可复制当前视角链接。' },
  { e: '👤', t: '头像', x: '打开菜单点左上角头像：可上传本地图片（拖动和缩放自由选取想要的区域），也可选择 emoji。' },
  { e: '👥', t: '多人共享', x: '注册即自动加入共享足迹板——伙伴们看到的是同一块板子，一起点亮、一起评分、一起贴照片。' },
];

/* localStorage 安全封装（部分手机隐私模式下会被禁用） */
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

const S = {
  token: lsGet('tb_token') || '',
  user: null,
  places: [], photos: [], tracks: [], routes: [],
  mode: null,
  tab: 'places',
  markers: {},
  trackShown: {},
  trackLines: [],
  builder: null,
  viewRouteId: null,
  trackLive: null,
  lbPhoto: null,
  openPlaceId: null,
  share: null,
  filters: { q: '', cat: '', visited: '' },
  snapshot: '',
  tutorialShown: false,
  tutIdx: 0,
  base: 'std',   // std | sat
  lang: 'zh',    // zh | en
  mapSource: 'wiki', // wiki | esri（国内访问失败自动切换）
  myMarker: null,
  users: [], friendProfile: null, viewingFriend: null,
  statsView: 'overview',
  hidden: { geo: [], items: [] },
  publicUrl: '',
};

/* ---------------- 工具 ---------------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catEmoji = (c) => CAT_EMOJI[c] || '🏷️';
const catName = (c) => CATS[c] || c || CATS.other;
const avatarOf = (u) => (u && u.avatar) || '🙂';
// 头像：emoji 或本地图片（img 加载失败时回退到 emoji）
function avatarHtml(id, emoji, isImg, ver, noClick) {
  const attr = id && !noClick ? ` data-act="user-open" data-user="${id}"` : '';
  if (isImg && id) return `<img class="u-avatar"${attr} src="/api/avatar/${id}?v=${ver || 0}" alt="" data-fb="${esc(emoji || '🙂')}">`;
  return `<span class="u-avatar-emoji"${attr}>${emoji || '🙂'}</span>`;
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function haversine(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
const fmtTime = (t) => new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
// 地点「去过的时间」：datetime-local 值形如 2026-05-01T14:30
const fmtVisit = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');

async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers);
  if (S.token) opts.headers.Authorization = 'Bearer ' + S.token;
  if (opts.json !== undefined) {
    opts.body = JSON.stringify(opts.json);
    opts.headers['Content-Type'] = 'application/json';
    delete opts.json;
  }
  const r = await fetch(path, opts);
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401 && !path.startsWith('/api/share') && !path.startsWith('/api/auth/')) {
    showLogin();
    throw new Error(data.error || '请先登录');
  }
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

const avgStars = (p) => (p.reviews && p.reviews.length ? p.reviews.reduce((a, r) => a + r.stars, 0) / p.reviews.length : null);
const starStr = (n) => {
  const full = Math.round(n);
  return `<span class="stars">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span>`;
};

/* ---------------- 地图 ---------------- */
let map, placeLayer, photoLayer, trackLayer, trackHitLayer, routeLayer, liveLayer;

function initMap() {
  map = L.map('map', { worldCopyJump: true, zoomControl: false, minZoom: 1 }).setView([32, 60], 2);
  L.control.zoom({ position: 'topright' }).addTo(map);
  buildTiles();
  renderBaseMap();

  placeLayer = L.layerGroup().addTo(map);
  photoLayer = L.layerGroup().addTo(map);
  trackLayer = L.layerGroup().addTo(map);
  trackHitLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  liveLayer = L.layerGroup().addTo(map);

  map.on('click', onMapClick);
  map.on('zoomend moveend', refreshPhotoLayer);
}

/* ---------------- 底图（中/英 + 卫星地名） ---------------- */
let baseLayers = {}, labelLayers = {};

let wikiTileErrors = 0;

function onWikiTileError() {
  if (S.mapSource !== 'wiki') return;
  wikiTileErrors++;
  // 连续 6 块失败就切换（连续计数，成功一块会清零）
  if (wikiTileErrors >= 6) switchToFallbackMap();
}
function onWikiTileLoad() { wikiTileErrors = 0; }

function setMapSource(src, silent) {
  S.mapSource = src === 'esri' ? 'esri' : src === 'osm' ? 'osm' : 'wiki';
  try { localStorage.setItem('tb_mapsource', S.mapSource); } catch (e) {}
  wikiTileErrors = 0;
  for (const l of Object.values(baseLayers)) if (map.hasLayer(l)) map.removeLayer(l);
  for (const l of Object.values(labelLayers)) if (map.hasLayer(l)) map.removeLayer(l);
  buildTiles();
  renderBaseMap();
  document.querySelectorAll('#drawer-settings button[data-source]').forEach((b) => b.classList.toggle('on', b.dataset.source === S.mapSource));
  if (!silent) toast(S.mapSource === 'wiki' ? '地图源：Wikimedia（中英文标注）' : S.mapSource === 'osm' ? '地图源：OSM（全球覆盖，国内可用）' : '地图源：Esri');
}

function switchToFallbackMap() {
  if (S.mapSource !== 'wiki') return;
  setMapSource('osm', true);
  toast('维基地图加载失败，已自动切换到 OSM 地图（国内可正常显示）', 5000);
}

function buildTiles() {
  const common = { maxZoom: 19, maxNativeZoom: 19 };
  const makeSat = () => L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    Object.assign({ attribution: '影像 © Esri' }, common)
  );
  if (S.mapSource === 'wiki') {
    const wiki = (lang) => {
      const l = L.tileLayer(
        `https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png?lang=${lang}`,
        Object.assign({ attribution: '© OpenStreetMap · Wikimedia' }, common)
      );
      l.on('tileerror', onWikiTileError);
      l.on('tileload', onWikiTileLoad);
      return l;
    };
    baseLayers = { zh: wiki('zh'), en: wiki('en'), sat: makeSat() };
  } else if (S.mapSource === 'osm') {
    const osm = () => L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      Object.assign({ attribution: '© OpenStreetMap' }, common)
    );
    baseLayers = { zh: osm(), en: osm(), sat: makeSat() };
  } else {
    const street = () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      Object.assign({ attribution: '地图 © Esri' }, common)
    );
    baseLayers = { zh: street(), en: street(), sat: makeSat() };
  }
  let lp = map.getPane('labelsPane');
  if (!lp) { lp = map.createPane('labelsPane'); lp.style.zIndex = 350; }
  labelLayers = {
    sat: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      Object.assign({ pane: 'labelsPane' }, common)
    ),
  };
}

function renderBaseMap() {
  for (const l of Object.values(baseLayers)) if (map.hasLayer(l)) map.removeLayer(l);
  for (const l of Object.values(labelLayers)) if (map.hasLayer(l)) map.removeLayer(l);
  if (S.base === 'sat') {
    baseLayers.sat.addTo(map);
    if (labelLayers.sat) labelLayers.sat.addTo(map); // 卫星图上叠加地名
  } else {
    baseLayers[S.lang].addTo(map);
  }
}

function toggleBaseMap() {
  S.base = S.base === 'sat' ? 'std' : 'sat';
  $('#basemap-btn').textContent = S.base === 'sat' ? '🛰️' : '🗺️';
  renderBaseMap();
  toast(S.base === 'sat' ? '卫星地图' : '标准地图');
}

function setLang(lang) {
  S.lang = lang === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('tb_lang', S.lang); } catch (e) {}
  document.querySelectorAll('#drawer-settings button[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === S.lang));
  renderBaseMap();
  toast(S.lang === 'zh' ? '地图标注：中文' : 'Map labels: English');
}

function locateMe() {
  if (!navigator.geolocation) { toast('此设备不支持定位'); return; }
  toast('正在定位…', 2000);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      if (S.myMarker) S.myMarker.remove();
      S.myMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 1000,
      }).addTo(map).bindPopup('📍 你在这里');
      map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 1.2 });
      setTimeout(() => { if (S.myMarker) S.myMarker.openPopup(); }, 1300);
      toast('已定位到你的位置');
    },
    (err) => {
      let msg = err.code === 1 ? '定位权限被拒绝，请在浏览器里允许定位' : '定位失败';
      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        msg += '（浏览器只允许 localhost 或 HTTPS 使用定位）';
      }
      toast(msg, 5000);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function onMapClick(e) {
  if (S.share || !S.mode) return;
  const { lat, lng } = e.latlng;
  if (S.mode === 'place') openNewPlacePopup(lat, lng);
  else if (S.mode === 'photo') openPinPhotoPopup(lat, lng);
  else if (S.mode === 'stop') addStop({ name: `第 ${S.builder ? S.builder.stops.length + 1 : 1} 站`, lat, lng, placeId: null });
  else if (S.mode === 'track') addLivePoint(lat, lng, Date.now());
}

/* ---------------- 界面开关 ---------------- */
function openDrawer() { $('#drawer').classList.add('open'); $('#drawer-backdrop').hidden = false; }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer-backdrop').hidden = true; }
function toggleDrawer() { $('#drawer').classList.contains('open') ? closeDrawer() : openDrawer(); }

/* ---------------- 模式 ---------------- */
function setMode(m) {
  if (m && !S.user) { showLogin(); return; }
  if (m === 'track' && !S.trackLive) startManualTrack();
  if (m === 'stop' && !S.builder) S.builder = { name: '', stops: [] };
  S.mode = m;
  $('#add-btn').classList.toggle('on', m === 'place');
  $('#map').classList.toggle('mode-on', !!m);
  const tip = $('#mode-tip');
  const tips = {
    place: '📍 点击地图，钉一个地点（可连续钉多个）',
    photo: '🖼 点击地图，把照片贴在这里',
    track: '✏️ 点击地图添加轨迹点（GPS 记录在「轨迹」页）',
    stop: '🧭 点击地图添加路线途经点',
  };
  tip.hidden = !m;
  if (m) tip.textContent = tips[m];
  if (m === 'stop' || m === 'track') { S.tab = m === 'stop' ? 'routes' : 'tracks'; syncTabs(); renderPanel(); }
}

/* ---------------- 数据加载与渲染 ---------------- */
async function loadAll() {
  const d = await api('/api/bootstrap');
  S.user = d.user;
  loadHidden();
  S.places = d.places; S.photos = d.photos; S.tracks = d.tracks; S.routes = d.routes;
  const snap = JSON.stringify([d.places, d.photos, d.tracks, d.routes, d.user]);
  const changed = snap !== S.snapshot;
  S.snapshot = snap;
  if (changed) renderAll();
  if (d.user && d.user.seenTutorial === false && !S.tutorialShown && !S.share) {
    S.tutorialShown = true;
    showTutorial();
  }
}

function renderAll() {
  renderUserUI();
  renderMarkers();
  renderTracks();
  renderRouteView();
  refreshPhotoLayer();
  renderPanel();
  updateDrawTools();
}

function renderUserUI() {
  const inner = S.user ? avatarHtml(S.user.id, S.user.avatar, S.user.avatarImg, S.user.avatarVer, true) : '👤';
  $('#avatar-btn').innerHTML = inner;
  $('#avatar-btn').title = S.user ? '菜单 · ' + S.user.name + '（可拖动位置）' : '打开菜单';
  $('#drawer-avatar').innerHTML = inner;
  if (S.user) {
    $('#drawer-name').textContent = S.user.name;
    $('#drawer-sub').textContent = '已加入共享足迹板 · 点左侧头像可改头像';
    $('#drawer-login').hidden = true;
    $('#drawer-logout').hidden = false;
  } else {
    $('#drawer-name').textContent = '未登录';
    $('#drawer-sub').textContent = '登录后即可点亮、评分、贴照片';
    $('#drawer-login').hidden = false;
    $('#drawer-logout').hidden = true;
  }
}

/* ---------------- 地点大头针 ---------------- */
function placeIcon(p) {
  return L.divIcon({
    className: 'pin-wrap',
    html: `<div class="pin ${p.visited ? 'lit' : ''}"><span>${catEmoji(p.category)}</span></div>`,
    iconSize: [34, 34], iconAnchor: [17, 32], popupAnchor: [0, -30],
  });
}

function renderMarkers() {
  placeLayer.clearLayers();
  S.markers = {};
  for (const p of S.places) {
    if (isPlaceHidden(p)) continue;
    const mk = L.marker([p.lat, p.lng], { icon: placeIcon(p), title: p.name });
    mk.on('click', () => { S.openPlaceId = p.id; });
    mk.bindPopup(buildPlacePopup(p), { maxWidth: 300, minWidth: 280, maxHeight: 480 });
    mk.addTo(placeLayer);
    S.markers[p.id] = mk;
  }
  if (S.openPlaceId && S.markers[S.openPlaceId]) S.markers[S.openPlaceId].openPopup();
}

function openPlacePopup(id) {
  S.openPlaceId = id;
  const mk = S.markers[id];
  const p = S.places.find((x) => x.id === id);
  if (!mk || !p) return;
  mk.setPopupContent(buildPlacePopup(p));
  mk.openPopup();
}

function buildPlacePopup(p) {
  const avg = avgStars(p);
  const my = S.user && p.reviews.find((r) => r.userId === S.user.id);
  const photos = S.photos.filter((x) => x.placeId === p.id);
  const myPhotos = S.user ? photos.filter((x) => x.ownerId === S.user.id) : [];
  const allShared = myPhotos.length > 0 && myPhotos.every((x) => x.shared);
  const owner = S.user && p.createdBy === S.user.id;
  const pf = S.user ? (S.placeFilter || 'all') : 'all';
  const shownReviews = !S.user ? p.reviews
    : pf === 'mine' ? p.reviews.filter((r) => r.userId === S.user.id)
    : pf === 'others' ? p.reviews.filter((r) => r.userId !== S.user.id)
    : p.reviews;
  const shownPhotos = !S.user ? photos
    : pf === 'mine' ? photos.filter((x) => x.ownerId === S.user.id)
    : pf === 'others' ? photos.filter((x) => x.ownerId !== S.user.id)
    : photos;

  let html = `<div data-place="${p.id}">
    <div class="pop-title"><span class="emoji">${catEmoji(p.category)}</span>${esc(p.name)}
      <span class="badge ${p.visited ? 'lit' : 'wish'}">${p.visited ? '已点亮 ✓' : '想去'}</span></div>
    <div class="pop-avg">${avg !== null ? `${starStr(avg)} ${avg.toFixed(1)} · ${p.reviews.length} 人评价` : '<span class="small-note">还没有人评分</span>'}</div>`;
  if (p.visitedAt) html += `<div class="small-note" style="margin-top:4px">🕒 去过的时间：${esc(fmtVisit(p.visitedAt))}</div>`;
  if (p.note) html += `<div class="pop-note">${esc(p.note)}</div>`;

  // 筛选：全部 / 我的 / 其他人的
  if (S.user) {
    html += `<div class="place-filter">
      <button data-act="place-filter" data-pf="all" class="${pf === 'all' ? 'on' : ''}">全部</button>
      <button data-act="place-filter" data-pf="mine" class="${pf === 'mine' ? 'on' : ''}">我的</button>
      <button data-act="place-filter" data-pf="others" class="${pf === 'others' ? 'on' : ''}">其他人的</button>
    </div>`;
  }

  if (S.user && pf !== 'others') {
    html += `<div class="review-item" style="border-top:none;padding-top:2px">
      <div class="r-head"><span>我的评分</span>${my ? `<a href="#" data-act="del-review" style="color:#b3452e">删除</a>` : ''}</div>
      <div class="stars-input" data-value="${my ? my.stars : 0}">${[1,2,3,4,5].map((v) => `<span class="star ${my && my.stars >= v ? 'on' : ''}" data-act="set-star" data-v="${v}">★</span>`).join('')}</div>
      <textarea class="text" data-role="review-text" rows="2" placeholder="写点评价…（${catName(p.category)}）">${esc(my ? my.comment : '')}</textarea>
      <button class="btn small gold" data-act="submit-review">${my ? '修改评分' : '提交评分'}</button>
    </div>`;
  } else if (!S.user) {
    html += `<div class="small-note">🔒 登录后即可参与评分</div>`;
  }

  const revTitle = pf === 'others' ? '其他人的评价' : pf === 'mine' ? '我的评价' : '全部评价';
  if (shownReviews.length) {
    html += `<div class="rev-title">${revTitle} · ${shownReviews.length}</div>`;
    for (const r of shownReviews) {
      const isMe = S.user && r.userId === S.user.id;
      html += `<div class="review-item"><div class="r-head"><span class="who">${avatarHtml(r.userId, r.userAvatar, r.userAvatarImg)} ${esc(r.userName)}${isMe ? ' <span class="badge lit">我</span>' : ''}</span><span>${fmtTime(r.time).slice(5)}</span></div>
        ${starStr(r.stars)}${r.comment ? ' <span style="color:#5c5342">' + esc(r.comment) + '</span>' : ''}</div>`;
    }
  } else {
    html += `<div class="small-note">${pf === 'others' ? '还没有其他人的评价' : pf === 'mine' ? '你还没有评价' : '还没有人评价'}</div>`;
  }

  if (shownPhotos.length) {
    const cover = shownPhotos[shownPhotos.length - 1];
    html += `<div class="place-cover" data-act="photo-open" data-photo="${cover.id}" data-scope="place">
      <img src="/api/photos/${cover.id}/file" loading="lazy" alt="${esc(cover.name)}">
      <span class="cover-count">${shownPhotos.length > 1 ? `共 ${shownPhotos.length} 张 · 点击查看` : '点击查看'}</span>
    </div>`;
  } else if (pf === 'others') {
    html += `<div class="small-note">还没有其他人上传照片</div>`;
  } else if (pf === 'mine' && S.user) {
    html += `<div class="small-note">你还没有上传照片</div>`;
  }

  if (S.user && pf !== 'others') {
    html += `<label class="btn small upload-label">📷 从相册上传
        <input type="file" class="photo-input" multiple accept="image/*" data-place="${p.id}" hidden></label>
      <label class="share-check" title="勾选后，你在这个地点上传的照片所有人可见"><input type="checkbox" data-role="shared-flag" data-act="place-share-toggle" data-place="${p.id}" ${allShared ? 'checked' : ''}> 共享</label>`;
  }

  html += `<div class="pop-actions">
    <button class="btn" data-act="toggle-visited">${p.visited ? '取消点亮' : '点亮 ✓'}</button>
    <button class="btn" data-act="add-to-route">加入路线</button>
    <button class="btn" data-act="edit-place">编辑</button>
    ${owner ? `<button class="btn" data-act="delete-place" style="color:#b3452e">删除</button>` : ''}
  </div></div>`;
  return html;
}

function openNewPlacePopup(lat, lng, preName) {
  const catOpts = Object.entries(CATS).map(([k, v]) => `<option value="${k}">${CAT_EMOJI[k]} ${v}</option>`).join('')
    + '<option value="__custom__">🏷️ 自定义</option>';
  const html = `<div class="form-pop" data-lat="${lat}" data-lng="${lng}">
    <div class="pop-title">📍 新地点</div>
    <div class="f-row">名称<input type="text" data-role="p-name" value="${esc(preName || '')}" placeholder="如：外滩 / 某某餐厅 / 某某卫生间" autofocus></div>
    <div class="f-row">类型<select data-role="p-cat">${catOpts}</select></div>
    <div class="f-row" data-role="p-cat-custom-wrap" hidden>自定义类型<input type="text" data-role="p-cat-custom" placeholder="如：温泉 / 露营地 / 观景台" maxlength="20"></div>
    <div class="f-row">备注<textarea data-role="p-note" rows="2" placeholder="选填"></textarea></div>
    <div class="f-row">🕒 去过的时间（可选）<input type="datetime-local" data-role="p-time"></div>
    <div class="f-row">📷 从相册选择照片（选填）<input type="file" data-role="p-photos" multiple accept="image/*"></div>
    <label class="share-check"><input type="checkbox" data-role="p-shared"> 共享</label>
    <div class="f-row" style="margin-top:6px"><label><input type="checkbox" data-role="p-visited" checked> 我去过（点亮它）</label></div>
    <div class="pop-actions"><button class="btn gold" data-act="create-place">钉上 ✓</button></div></div>`;
  L.popup({ maxWidth: 310, minWidth: 290, maxHeight: 480 }).setLatLng([lat, lng]).setContent(html).openOn(map);
}

function openEditPlacePopup(p) {
  const isCustom = !CATS[p.category];
  const catOpts = Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${p.category === k ? 'selected' : ''}>${CAT_EMOJI[k]} ${v}</option>`).join('')
    + `<option value="__custom__" ${isCustom ? 'selected' : ''}>🏷️ 自定义</option>`;
  const html = `<div class="form-pop" data-place="${p.id}">
    <div class="pop-title">✏️ 编辑地点</div>
    <div class="f-row">名称<input type="text" data-role="p-name" value="${esc(p.name)}"></div>
    <div class="f-row">类型<select data-role="p-cat">${catOpts}</select></div>
    <div class="f-row" data-role="p-cat-custom-wrap" ${isCustom ? '' : 'hidden'}>自定义类型<input type="text" data-role="p-cat-custom" value="${isCustom ? esc(p.category) : ''}" maxlength="20"></div>
    <div class="f-row">🕒 去过的时间<input type="datetime-local" data-role="p-time" value="${esc(p.visitedAt || '')}"></div>
    <div class="f-row">备注<textarea data-role="p-note" rows="2">${esc(p.note)}</textarea></div>
    <div class="pop-actions">
      <button class="btn gold" data-act="edit-place-save">保存</button>
      <button class="btn" data-act="edit-place-cancel">取消</button>
    </div></div>`;
  S.markers[p.id].setPopupContent(html);
}

function openPinPhotoPopup(lat, lng) {
  const html = `<div class="form-pop" data-lat="${lat}" data-lng="${lng}">
    <div class="pop-title">🖼 在这里贴照片</div>
    <div class="small-note" style="margin:6px 0">照片原文件无损保存。</div>
    <label class="share-check"><input type="checkbox" data-role="pin-shared"> 共享</label><br>
    <label class="btn gold" style="margin-top:8px;display:inline-block">选择照片
      <input type="file" class="photo-input" multiple accept="image/*" data-lat="${lat}" data-lng="${lng}" hidden></label>
  </div>`;
  L.popup({ maxWidth: 300, minWidth: 280, maxHeight: 480 }).setLatLng([lat, lng]).setContent(html).openOn(map);
}

/* ---------------- 照片毛毡层 ---------------- */
function offsetFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [(((h % 7) - 3) * 0.00035), ((((h >> 2) % 7) - 3) * 0.00028)];
}

function refreshPhotoLayer() {
  photoLayer.clearLayers();
  if (!map || S.share) return;
  if (map.getZoom() < PHOTO_ZOOM) return;
  const b = map.getBounds().pad(0.25);
  let shown = 0;
  for (const ph of S.photos) {
    if (isPhotoHidden(ph)) continue;
    if (!b.contains([ph.lat, ph.lng]) || shown >= 80) continue;
    shown++;
    const [dx, dy] = offsetFor(ph.id);
    const mk = L.marker([ph.lat + dy, ph.lng + dx], {
      icon: L.divIcon({
        className: 'photo-pin',
        html: `<img src="/api/photos/${ph.id}/file" loading="lazy"><span class="tape"></span>`,
        iconSize: [88, 72], iconAnchor: [44, 36],
      }),
      keyboard: false, interactive: true,
    });
    mk.on('click', (e) => { L.DomEvent.stopPropagation(e); openLightbox(ph); });
    photoLayer.addLayer(mk);
  }
}

/* ---------------- Lightbox ---------------- */
/* ---------------- 照片查看器（左：评论评分 / 右：图片+筛选） ---------------- */
function viewerBase() {
  return S.viewer.baseIds.map((id) => S.photos.find((p) => p.id === id)).filter(Boolean);
}
function visibleViewerPhotos() {
  const base = viewerBase();
  if (!S.user) return base;
  if (S.viewer.imgFilter === 'mine') return base.filter((p) => p.ownerId === S.user.id);
  if (S.viewer.imgFilter === 'others') return base.filter((p) => p.ownerId !== S.user.id);
  return base;
}

function openLightbox(ph, opts = {}) {
  const base = (opts.photos && opts.photos.length) ? opts.photos : S.photos;
  const filter = opts.filter === 'mine' || opts.filter === 'others' ? opts.filter : 'all';
  S.viewer = { baseIds: base.map((x) => x.id), index: 0, imgFilter: filter, reviewFilter: 'all' };
  const list = visibleViewerPhotos();
  const idx = list.findIndex((x) => x.id === ph.id);
  S.viewer.index = idx >= 0 ? idx : 0;
  renderViewer();
  $('#lightbox').hidden = false;
}

function viewerNav(delta) {
  const list = visibleViewerPhotos();
  if (!list.length) return;
  S.viewer.index = (S.viewer.index + delta + list.length) % list.length;
  renderViewer();
}

function renderViewer() {
  const list = visibleViewerPhotos();
  if (S.viewer.index >= list.length) S.viewer.index = Math.max(0, list.length - 1);
  const ph = list[S.viewer.index] || null;
  S.lbPhoto = ph;
  const img = $('#pv-img');
  if (ph) { img.src = `/api/photos/${ph.id}/file`; img.style.display = ''; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
  $('#pv-count').textContent = list.length ? `${S.viewer.index + 1} / ${list.length}` : '0 / 0';
  document.querySelectorAll('#pv-imgfilter button').forEach((b) => b.classList.toggle('on', b.dataset.imgfilter === S.viewer.imgFilter));
  const multi = list.length > 1;
  ['#pv-prev', '#pv-next', '#pv-arrow-prev', '#pv-arrow-next'].forEach((sel) => { $(sel).style.display = multi ? '' : 'none'; });
  renderViewerLeft(ph);
  renderViewerActions(ph);
}

function renderViewerLeft(ph) {
  const left = $('#pv-left');
  if (!ph) {
    left.innerHTML = `<div class="empty-tip">${S.viewer.imgFilter === 'others' ? '还没有其他人的图片' : S.user ? '你还没有上传过图片' : '没有可查看的图片'}<br><button class="btn small" data-act="img-filter-all" style="margin-top:8px">查看全部图片</button></div>`;
    return;
  }
  const place = S.places.find((p) => p.id === ph.placeId);
  const ratings = ph.ratings || [];
  const shown = !S.user ? ratings
    : S.viewer.reviewFilter === 'mine' ? ratings.filter((r) => r.userId === S.user.id)
    : S.viewer.reviewFilter === 'others' ? ratings.filter((r) => r.userId !== S.user.id)
    : ratings;
  const avg = ratings.length ? ratings.reduce((a, r) => a + r.stars, 0) / ratings.length : null;

  let html = `<div class="pv-info">
    <div class="t">${esc(ph.name)}</div>
    <div class="m">${avatarHtml(ph.ownerId, ph.ownerAvatar, ph.ownerAvatarImg)} ${esc(ph.ownerName || '')} · ${fmtTime(ph.time)}</div>
    <div class="m">${fmtSize(ph.size)} 原图无损 · ${ph.shared ? '已共享' : '仅自己可见'}${place ? ' · 📍 ' + esc(place.name) : ''}</div>
  </div>`;
  html += `<div class="pv-seg">
    <button data-act="review-filter" data-rf="all" class="${S.viewer.reviewFilter === 'all' ? 'on' : ''}">全部评价</button>
    <button data-act="review-filter" data-rf="mine" class="${S.viewer.reviewFilter === 'mine' ? 'on' : ''}">我的</button>
    <button data-act="review-filter" data-rf="others" class="${S.viewer.reviewFilter === 'others' ? 'on' : ''}">其他人的</button>
  </div>`;
  html += `<div class="pv-reviews">`;
  if (avg !== null) html += `<div class="pop-avg">${starStr(avg)} ${avg.toFixed(1)} · ${ratings.length} 人评分</div>`;
  if (!shown.length) html += `<div class="small-note" style="padding:4px 0">${S.viewer.reviewFilter === 'others' ? '还没有其他人的评分' : S.viewer.reviewFilter === 'mine' ? '你还没有评分' : '还没有人评分'}</div>`;
  for (const r of shown) {
    html += `<div class="review-item">${avatarHtml(r.userId, r.userAvatar, r.userAvatarImg)} <b>${esc(r.userName)}</b> ${starStr(r.stars)} ${r.comment ? esc(r.comment) : ''}</div>`;
  }
  html += `</div>`;
  if (S.user && ph.ownerId !== S.user.id) {
    const mine = ratings.find((r) => r.userId === S.user.id);
    html += `<div class="pv-rate">
      <div class="stars-input" data-value="${mine ? mine.stars : 0}">${[1, 2, 3, 4, 5].map((v) => `<span class="star ${mine && mine.stars >= v ? 'on' : ''}" data-act="set-star" data-v="${v}">★</span>`).join('')}</div>
      <input class="text" data-role="rate-comment" placeholder="写点评 / 留言…" value="${esc(mine ? mine.comment : '')}">
      <button class="btn small primary" data-act="lb-rate" data-photo="${ph.id}">${mine ? '修改评分' : '提交评分'}</button>
    </div>`;
  }
  left.innerHTML = html;
}

function renderViewerActions(ph) {
  const acts = $('#pv-actions');
  if (!ph) { acts.innerHTML = ''; return; }
  let html = `<a class="btn" href="/api/photos/${ph.id}/file" download="${esc(ph.name)}">⬇ 下载原片</a>`;
  if (S.user && ph.ownerId === S.user.id) {
    html += `<button class="btn" data-act="lb-toggle-share">${ph.shared ? '转为仅自己' : '共享'}</button>
      <button class="btn" data-act="lb-delete" style="color:#ffb3a5">删除</button>`;
  }
  acts.innerHTML = html;
}

/* ---------------- 上传 ---------------- */
async function uploadFiles(files, { placeId = null, lat = null, lng = null, shared, title = '', category = '' } = {}) {
  const isImg = (f) => (f.type && f.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(f.name || '');
  const imgs = [...files].filter(isImg);
  if (!imgs.length) { toast('请选择图片文件'); return; }
  if (shared === undefined) {
    const sharedEl = document.querySelector('[data-role="shared-flag"], [data-role="pin-shared"]');
    shared = sharedEl ? sharedEl.checked : false; // 默认不共享
  }
  let ok = 0;
  toast(`正在上传 ${imgs.length} 张照片…`, 60000);
  for (const f of imgs) {
    try {
      const q = new URLSearchParams({ shared: shared ? '1' : '0', name: f.name, title: title || f.name, category });
      const path = placeId ? `/api/places/${placeId}/photos?${q}` : `/api/photos?lat=${lat}&lng=${lng}&` + q;
      const r = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': f.type,
          'X-Photo-Name': encodeURIComponent(f.name),
          ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}),
        },
        body: f,
      });
      if (r.ok) ok++;
      else { const e = await r.json().catch(() => ({})); toast(`${f.name}: ${e.error || '上传失败'}`); }
    } catch (e) { toast('上传出错：' + e.message); }
  }
  toast(`✓ 已上传 ${ok}/${imgs.length} 张（${shared ? '已共享给伙伴' : '仅自己可见'}，原文件无损保存）`);
  await loadAll();
  if (placeId) openPlacePopup(placeId);
}

/* ---------------- 轨迹 ---------------- */
function startGpsTrack() {
  if (!navigator.geolocation) { toast('此设备不支持定位，试试手动画轨迹'); return; }
  if (S.trackLive) { toast('已有正在进行的记录'); return; }
  S.trackLive = { points: [], manual: false, t0: Date.now(), watchId: null };
  S.trackLive.line = L.polyline([], { color: '#e74c3c', weight: 4, opacity: .85 }).addTo(liveLayer);
  S.trackLive.watchId = navigator.geolocation.watchPosition(
    (pos) => addLivePoint(pos.coords.latitude, pos.coords.longitude, pos.timestamp),
    (err) => toast('定位失败：' + err.message + '（可改用手动画轨迹）'),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
  S.tab = 'tracks'; syncTabs(); renderPanel();
  closeDrawer();
  updateDrawTools();
  toast('▶ 开始实时记录轨迹');
}

function startManualTrack() {
  if (S.trackLive) return;
  S.trackLive = { points: [], manual: true, t0: Date.now(), watchId: null };
  S.trackLive.line = L.polyline([], { color: '#e74c3c', weight: 4, opacity: .85, dashArray: '1 7' }).addTo(liveLayer);
  closeDrawer();
  updateDrawTools();
}

function addLivePoint(lat, lng, ts) {
  if (!S.trackLive) return;
  const pts = S.trackLive.points;
  const last = pts[pts.length - 1];
  if (last && Math.abs(last[0] - lat) < 1e-7 && Math.abs(last[1] - lng) < 1e-7) return;
  pts.push([lat, lng, ts || Date.now()]);
  S.trackLive.line.setLatLngs(pts.map((p) => [p[0], p[1]]));
  if (S.trackLive.follow) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  updateLiveStats();
}

function trackStats(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

function updateDrawTools() {
  const box = $('#draw-tools');
  if (!box) return;
  if (!S.trackLive) { box.hidden = true; return; }
  box.hidden = false;
  const info = $('#draw-info');
  if (info) info.textContent = `${S.trackLive.points.length} 点 · ${fmtKm(trackStats(S.trackLive.points))}`;
}

function updateLiveStats() {
  updateDrawTools();
  const el = document.querySelector('[data-role="live-stats"]');
  if (!el || !S.trackLive) return;
  const d = trackStats(S.trackLive.points);
  const dur = Math.round((Date.now() - S.trackLive.t0) / 1000);
  const mm = String(Math.floor(dur / 60)).padStart(2, '0'), ss = String(dur % 60).padStart(2, '0');
  el.innerHTML = `<b>${S.trackLive.points.length}</b> 个点 · <b>${fmtKm(d)}</b> · ⏱ ${mm}:${ss}`;
}
setInterval(() => { if (S.trackLive) updateLiveStats(); }, 1000);

function stopLiveLine() {
  if (!S.trackLive) return;
  if (S.trackLive.watchId !== null && S.trackLive.watchId !== undefined) {
    navigator.geolocation.clearWatch(S.trackLive.watchId);
  }
  liveLayer.clearLayers();
  S.trackLive = null;
  setMode(null);
  updateDrawTools();
}

async function saveLiveTrack() {
  if (!S.trackLive || S.trackLive.points.length < 2) { toast('轨迹点太少，无法保存'); return; }
  const nameEl = document.querySelector('[data-role="track-name"]');
  let name = (nameEl && nameEl.value.trim()) || '';
  if (!name) name = (prompt('给这条轨迹起个名字：', '轨迹 ' + new Date().toLocaleDateString('zh-CN')) || '').trim();
  if (!name) return;
  try {
    await api('/api/tracks', { method: 'POST', json: { name, points: S.trackLive.points } });
    stopLiveLine();
    await loadAll();
    toast('✓ 轨迹已保存');
  } catch (e) { toast(e.message); }
}

// 导入 GPX / GeoJSON 轨迹文件
async function importTrackFile(file) {
  if (!S.user) { showLogin(); return; }
  try {
    const text = await file.text();
    const points = [];
    const add = (lat, lng, t) => {
      if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) points.push([lat, lng, Number(t) || 0]);
    };
    if (/\.gpx$/i.test(file.name) || /<gpx[\s>]/i.test(text.slice(0, 800))) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      doc.querySelectorAll('trkpt, rtept, wpt').forEach((el) => {
        const tEl = el.querySelector('time');
        add(parseFloat(el.getAttribute('lat')), parseFloat(el.getAttribute('lon')), tEl ? Date.parse(tEl.textContent) : 0);
      });
    } else {
      const d = JSON.parse(text);
      const collect = (coords) => { for (const c of coords || []) { if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') add(c[1], c[0]); } };
      const walk = (g) => {
        if (!g || typeof g !== 'object') return;
        if (g.type === 'LineString' || g.type === 'MultiPoint' || g.type === 'Point') collect(g.coordinates);
        else if (g.type === 'MultiLineString' || g.type === 'Polygon') (g.coordinates || []).forEach(collect);
        else if (g.type === 'Feature') walk(g.geometry);
        else if (g.type === 'FeatureCollection') (g.features || []).forEach(walk);
        else if (Array.isArray(g)) g.forEach(walk);
      };
      walk(d);
    }
    if (points.length < 2) { toast('没有解析出有效轨迹点（支持 GPX / GeoJSON）'); return; }
    let pts = points;
    if (pts.length > 20000) { const step = Math.ceil(pts.length / 20000); pts = points.filter((_, i) => i % step === 0); }
    const name = (prompt('给这条轨迹起个名字', file.name.replace(/\.[^.]+$/, '')) || '').trim();
    if (!name) return;
    await api('/api/tracks', { method: 'POST', json: { name, points: pts } });
    await loadAll();
    toast(`✓ 已导入轨迹「${name}」（${pts.length} 个点）`);
  } catch (e) { toast('解析失败：' + e.message); }
}

function renderTracks() {
  trackLayer.clearLayers();
  S.trackLines = [];
  const highlight = S.tab === 'tracks';
  S.tracks.forEach((t, i) => {
    if (S.trackShown[t.id] === false) return;
    const pts = t.points.map((p) => [p[0], p[1]]);
    if (highlight) {
      // 轨迹界面：白色描边 + 橙色高亮，突出走过的街道
      L.polyline(pts, { color: '#ffffff', weight: 9, opacity: .45 }).addTo(trackLayer);
      const line = L.polyline(pts, { color: '#ff6b35', weight: 4.5, opacity: .95 });
      line.bindTooltip(`轨迹：${t.name}（${t.ownerName}）`, { sticky: true });
      line.addTo(trackLayer);
      S.trackLines.push(line);
    } else {
      const color = TRACK_COLORS[i % TRACK_COLORS.length];
      const line = L.polyline(pts, { color, weight: 3.5, opacity: .8 });
      line.bindTooltip(`轨迹：${t.name}（${t.ownerName}）`, { sticky: true });
      line.addTo(trackLayer);
      S.trackLines.push(line);
    }
  });
  // 轨迹界面：高亮轨迹经过的地点
  if (trackHitLayer) {
    trackHitLayer.clearLayers();
    if (highlight) {
      const HIT = 0.15; // 约 150 米
      for (const p of S.places) {
        if (isPlaceHidden(p)) continue;
        let hit = false;
        for (const t of S.tracks) {
          if (S.trackShown[t.id] === false) continue;
          const step = Math.max(1, Math.floor(t.points.length / 1500));
          for (let i = 0; i < t.points.length; i += step) {
            const pt = t.points[i];
            if (haversine({ lat: pt[0], lng: pt[1] }, p) < HIT) { hit = true; break; }
          }
          if (hit) break;
        }
        if (hit) {
          L.circleMarker([p.lat, p.lng], {
            radius: 16, color: '#ff6b35', weight: 2,
            fillColor: '#ff6b35', fillOpacity: .12, opacity: .9,
          }).addTo(trackHitLayer);
        }
      }
    }
  }
}

/* ---------------- 路线 ---------------- */
function addStop(stop) {
  if (!S.builder) S.builder = { name: '', stops: [] };
  S.builder.stops.push(stop);
  renderRouteView();
  renderPanel();
  toast(`已添加：${stop.name}`);
}

function renderRouteView() {
  routeLayer.clearLayers();
  const rid = S.viewRouteId;
  let route = null;
  if (rid) route = S.routes.find((r) => r.id === rid);
  else if (S.builder && S.builder.stops.length) route = { stops: S.builder.stops, name: '（规划中）' };
  if (!route) return;
  const pts = route.stops.map((s) => [s.lat, s.lng]);
  if (pts.length >= 2) L.polyline(pts, { color: '#e8a13a', weight: 3.5, dashArray: '6 8', opacity: .9 }).addTo(routeLayer);
  route.stops.forEach((s, i) => {
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', html: `<div class="stop-num">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      interactive: false,
    }).addTo(routeLayer);
  });
}

async function shareRoute(id) {
  try {
    await ensurePublicUrl();
    const d = await api(`/api/routes/${id}/share`, { method: 'POST' });
    const url = `${shareBase()}/#share=${d.token}`;
    try { await navigator.clipboard.writeText(url); toast('✓ 分享链接已复制，发给朋友吧！'); }
    catch (e) { prompt('复制下面的分享链接：', url); }
  } catch (e) { toast(e.message); }
}

// 分享弹窗：选择分享足迹板（灰色点亮地图）或某条轨迹
function showShareModal() {
  const tracks = S.tracks.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `<div class="modal">
    <h2>分享</h2>
    <div class="m-sub">选择要分享的内容，复制链接发给朋友（无需登录即可查看）</div>
    <button class="btn primary" style="width:100%;margin-bottom:12px" data-act="share-board-do">🖼 分享足迹板（灰色点亮地图）</button>
    <div class="panel-title" style="margin:4px 0 8px">或者分享一条轨迹</div>
    ${S.tracks.length ? `<select data-role="share-track-sel">${tracks}</select>
      <button class="btn" style="width:100%;margin-top:8px" data-act="share-track-do">🔗 复制轨迹分享链接</button>` : '<div class="small-note">还没有轨迹</div>'}
    <button class="btn" style="width:100%;margin-top:10px" data-act="modal-close">关闭</button>
  </div>`;
}

async function shareTrack(id) {
  try {
    await ensurePublicUrl();
    const d = await api('/api/tracks/' + id + '/share', { method: 'POST' });
    const url = `${shareBase()}/#share=${d.token}`;
    try { await navigator.clipboard.writeText(url); toast('✓ 轨迹分享链接已复制'); }
    catch (e) { prompt('复制轨迹分享链接：', url); }
  } catch (e) { toast(e.message); }
}

// 把路线共享给指定好友（好友可一起修改）
async function showRouteCollabModal(routeId) {
  const route = S.routes.find((r) => r.id === routeId);
  if (!route) return;
  let d;
  try { d = await api('/api/users'); } catch (e) { toast(e.message); return; }
  const ids = route.collaborators || [];
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `<div class="modal">
    <h2>共享路线给好友</h2>
    <div class="m-sub">被共享的好友可以一起修改「${esc(route.name)}」</div>
    ${d.users.length ? d.users.map((u) => `<label class="collab-row"><input type="checkbox" data-act="route-collab" data-route="${routeId}" data-user="${u.id}" ${ids.includes(u.id) ? 'checked' : ''}> ${avatarHtml(u.id, u.avatar, u.avatarImg, u.avatarVer)} ${esc(u.name)}</label>`).join('') : '<div class="empty-tip">还没有好友，先去「好友」页添加</div>'}
    <button class="btn" style="width:100%;margin-top:10px" data-act="modal-close">关闭</button>
  </div>`;
}

/* ---------------- 隐藏（按洲/国家/城市，或单条路线） ---------------- */
function hiddenStorageKey() { return 'tb_hidden_' + (S.user ? S.user.id : 'guest'); }
function loadHidden() {
  try {
    const h = JSON.parse(localStorage.getItem(hiddenStorageKey()) || 'null');
    S.hidden = { geo: (h && h.geo) || [], items: (h && h.items) || [] };
  } catch (e) { S.hidden = { geo: [], items: [] }; }
}
function saveHidden() { try { localStorage.setItem(hiddenStorageKey(), JSON.stringify(S.hidden)); } catch (e) {} }
function geoKeysFor(obj) {
  const keys = [];
  const cont = (obj.continent || '').trim();
  const country = (obj.country || '').trim();
  const city = (obj.city || '').trim();
  if (cont) keys.push('cont:' + cont);
  if (country) keys.push('country:' + country);
  if (city) keys.push('city:' + country + '|' + city);
  return keys;
}
function isPlaceHidden(p) { return geoKeysFor(p).some((k) => S.hidden.geo.includes(k)); }
function photoGeo(ph) {
  const place = ph.placeId ? S.places.find((x) => x.id === ph.placeId) : null;
  return {
    continent: (ph.continent || (place && place.continent) || '').trim(),
    country: (ph.country || (place && place.country) || '').trim(),
    city: (ph.city || (place && place.city) || '').trim(),
  };
}
function isPhotoHidden(ph) {
  return geoKeysFor(photoGeo(ph)).some((k) => S.hidden.geo.includes(k));
}
function isRouteHidden(r) { return S.hidden.items.includes('route:' + r.id); }
function geoLabel(key) {
  if (key.startsWith('cont:')) return key.slice(5);
  if (key.startsWith('country:')) return key.slice(8);
  if (key.startsWith('city:')) { const v = key.slice(5); return v.split('|')[1] || v; }
  return key;
}
function hiddenFooter() {
  const geo = S.hidden.geo.map((k) => `<button class="btn small" data-act="geo-unhide" data-key="${esc(k)}">${esc(geoLabel(k))} ✕</button>`);
  const items = S.hidden.items.filter((k) => k.startsWith('route:')).map((k) => {
    const r = S.routes.find((x) => x.id === k.slice(6));
    return `<button class="btn small" data-act="route-unhide" data-route="${esc(k.slice(6))}">${esc(r ? r.name : '路线')} ✕</button>`;
  });
  const all = [...geo, ...items];
  if (!all.length) return '';
  return `<div class="hidden-box"><div class="small-note">已隐藏（点击恢复）：</div><div class="row-actions">${all.join(' ')}</div><button class="btn small" data-act="unhide-all" style="margin-top:6px">全部显示</button></div>`;
}
function applyHidden() { saveHidden(); renderMarkers(); refreshPhotoLayer(); renderPanel(); }
function geoEye(key, title) {
  const hidden = S.hidden.geo.includes(key);
  return `<button class="geo-eye" data-act="${hidden ? 'geo-unhide' : 'geo-hide'}" data-key="${esc(key)}" title="${esc(title)}">${hidden ? '🙈' : '👁'}</button>`;
}

/* ---------------- 侧栏面板 ---------------- */
function syncTabs() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
}

function renderPanel() {
  if (S.share) return renderSharePanel();
  if (S.tab === 'friends') {
    if (S.viewingFriend) openFriendProfile(S.viewingFriend);
    else renderFriendsPanel();
    return;
  }
  const f = { places: renderPlacesPanel, tracks: renderTracksPanel, routes: renderRoutesPanel, photos: renderPhotosPanel, stats: renderStatsOuter };
  (f[S.tab] || f.places)();
}

function renderStatsOuter() {
  if (S.statsView === 'lit') renderLitPanel();
  else renderStatsPanel();
}

function renderPlacesPanel() {
  loadHidden();
  const flt = S.filters;
  const list = S.places
    .filter((p) => (!flt.cat || p.category === flt.cat)
      && (!flt.visited || (flt.visited === '1') === !!p.visited)
      && (!flt.q || p.name.toLowerCase().includes(flt.q.toLowerCase()))
      && !isPlaceHidden(p))
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  let html = `<div class="panel-title"><span>地点 · ${S.places.length}</span>
    <button class="btn small" data-act="refresh">↻ 刷新</button></div>
    <div class="filter-row">
      <input type="text" placeholder="搜索地点…" value="${esc(flt.q)}" data-role="flt-q">
      <select data-role="flt-cat"><option value="">全部类型</option>${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${flt.cat === k ? 'selected' : ''}>${CAT_EMOJI[k]} ${v}</option>`).join('')}</select>
      <select data-role="flt-visited">
        <option value="">全部</option>
        <option value="1" ${flt.visited === '1' ? 'selected' : ''}>已点亮</option>
        <option value="0" ${flt.visited === '0' ? 'selected' : ''}>想去</option>
      </select>
    </div>`;
  if (!list.length) {
    html += `<div class="empty-tip">还没有地点<br>点右下角 ＋ 号 →「加地点」<br>再点击地图把图钉钉上毛毡板</div>`;
  }

  // 按 洲 → 国家 → 城市 分组
  const groups = {};
  for (const p of list) {
    const cont = (p.continent || '').trim() || '未分类';
    const country = (p.country || '').trim() || '未分类';
    const city = (p.city || '').trim() || '未分类';
    groups[cont] = groups[cont] || {};
    groups[cont][country] = groups[cont][country] || {};
    groups[cont][country][city] = groups[cont][country][city] || [];
    groups[cont][country][city].push(p);
  }
  const sortKeys = (arr) => arr.sort((a, b) => (a === '未分类' ? 1 : b === '未分类' ? -1 : a.localeCompare(b, 'zh')));

  for (const cont of sortKeys(Object.keys(groups))) {
    const countries = groups[cont];
    const contCount = Object.values(countries).reduce((a, cs) => a + Object.values(cs).reduce((x, arr) => x + arr.length, 0), 0);
    const contSample = Object.values(countries)[0] && Object.values(Object.values(countries)[0])[0] && Object.values(Object.values(countries)[0])[0][0];
    const contKey = contSample && contSample.continent ? 'cont:' + contSample.continent : '';
    html += `<div class="geo-continent">🌍 ${esc(cont)}<span class="lit-count">${contCount}</span>${contKey ? geoEye(contKey, '隐藏' + cont) : ''}</div>`;
    for (const country of sortKeys(Object.keys(countries))) {
      const cities = countries[country];
      const countryCount = Object.values(cities).reduce((a, arr) => a + arr.length, 0);
      const countrySample = Object.values(cities)[0] && Object.values(cities)[0][0];
      const countryKey = countrySample && countrySample.country ? 'country:' + countrySample.country : '';
      html += `<div class="geo-country">🏳️ ${esc(country)}<span class="lit-count">${countryCount}</span>${countryKey ? geoEye(countryKey, '隐藏' + country) : ''}</div>`;
      for (const city of sortKeys(Object.keys(cities))) {
        const places = cities[city];
        const citySample = places[0];
        const cityKey = citySample && citySample.city ? 'city:' + (citySample.country || '') + '|' + citySample.city : '';
        html += `<div class="geo-city">🏙 ${esc(city)}<span class="lit-count">${places.length}</span>${cityKey ? geoEye(cityKey, '隐藏' + city) : ''}</div>`;
        for (const p of places) {
          const avg = avgStars(p);
          const nPhotos = S.photos.filter((x) => x.placeId === p.id).length;
          html += `<div class="list-item" style="margin-left:14px">
            <span class="emoji">${catEmoji(p.category)}</span>
            <div class="body">
              <div class="name" data-act="place-fly" data-place="${p.id}">${esc(p.name)}
                <span class="badge ${p.visited ? 'lit' : 'wish'}">${p.visited ? '已点亮' : '想去'}</span></div>
              <div class="sub">${avg !== null ? starStr(avg) + ' ' + avg.toFixed(1) + ' · ' + p.reviews.length + ' 人评' : '暂无评分'}${nPhotos ? ' · 🖼 ' + nPhotos : ''}</div>
              <div class="sub">${avatarHtml(p.createdBy, p.createdByAvatar, p.createdByAvatarImg)} ${p.createdByName} 添加</div>
            </div></div>`;
        }
      }
    }
  }
  html += hiddenFooter();
  $('#panel').innerHTML = html;

  // 后台补全缺失的洲/国家/城市
  if (S.user && list.length) {
    const missing = list.filter((p) => !p.continent || !p.country || !p.city);
    if (missing.length) geocodeAll(missing);
  }
}

function renderTracksPanel() {
  let html = `<div class="panel-title"><span>轨迹 · ${S.tracks.length}</span></div>`;
  if (S.trackLive) {
    const d = trackStats(S.trackLive.points);
    html += `<div class="active-card">
      <div class="title">${S.trackLive.manual ? '✏️ 手动轨迹绘制中' : '🔴 GPS 实时记录中'}</div>
      <div class="stat-line" data-role="live-stats"><b>${S.trackLive.points.length}</b> 个点 · <b>${fmtKm(d)}</b></div>
      ${S.trackLive.manual
        ? `<div class="small-note">点击地图添加轨迹点</div>`
        : `<label class="share-check"><input type="checkbox" data-role="follow" ${S.trackLive.follow ? 'checked' : ''}> 跟随我的位置</label>`}
      <input class="text" type="text" placeholder="轨迹名称，如：环滇池骑行" data-role="track-name">
      <div class="row-actions">
        <button class="btn small" data-act="track-undo">↶ 撤回上一步</button>
        <button class="btn small danger" data-act="track-clear">🗑 删除</button>
      </div>
      <div class="row-actions">
        <button class="btn small primary" data-act="record-save">💾 保存</button>
        <button class="btn small danger" data-act="record-cancel">丢弃</button>
      </div></div>`;
  } else {
    html += `<div class="row-actions" style="margin-bottom:10px">
      <button class="btn primary" data-act="record-start">▶ GPS 实时记录</button>
      <button class="btn" data-act="record-manual">✏️ 手动画轨迹</button></div>
      <label class="btn" style="display:flex;justify-content:center;margin-bottom:8px">📤 上传轨迹文件（GPX / GeoJSON）
        <input type="file" data-role="track-file" accept=".gpx,.geojson,.json" hidden></label>
      <div class="small-note" style="margin-bottom:8px">手机浏览器可实时记录 GPS 轨迹；电脑上可用手动画线。*手机经局域网 IP 访问时浏览器可能禁用定位，用 localhost 或手动模式。</div>`;
  }
  if (!S.tracks.length && !S.trackLive) html += `<div class="empty-tip">还没有轨迹<br>可以记录、手动画，或上传 GPX / GeoJSON 文件</div>`;
  S.tracks.forEach((t, i) => {
    const d = trackStats(t.points);
    html += `<div class="list-item">
      <span class="emoji" style="color:${TRACK_COLORS[i % TRACK_COLORS.length]}">➰</span>
      <div class="body">
        <div class="name" data-act="track-zoom" data-track="${t.id}">${esc(t.name)}</div>
        <div class="sub">${fmtKm(d)} · ${t.points.length} 点 · ${avatarHtml(t.ownerId, t.ownerAvatar, t.ownerAvatarImg)} ${t.ownerName} · ${fmtTime(t.time)}</div>
        <div class="row-actions">
          <button class="btn small" data-act="track-toggle" data-track="${t.id}">${S.trackShown[t.id] === false ? '👁 显示' : '🙈 隐藏'}</button>
          <button class="btn small" data-act="track-share" data-track="${t.id}">🔗 分享</button>
          ${S.user && t.ownerId === S.user.id ? `<button class="btn small danger" data-act="track-delete" data-track="${t.id}">删除</button>` : ''}
        </div>
      </div></div>`;
  });
  $('#panel').innerHTML = html;
}

function renderRoutesPanel() {
  loadHidden();
  const visible = S.routes.filter((r) => !isRouteHidden(r));
  let html = `<div class="panel-title"><span>路线 · ${visible.length}</span></div>`;
  if (S.builder) {
    html += `<div class="active-card">
      <div class="title">🧭 路线规划中</div>
      <input class="text" type="text" placeholder="路线名称，如：云南七日游" data-role="route-name">
      <div>`;
    S.builder.stops.forEach((s, i) => {
      html += `<div class="list-item" style="padding:5px 8px">
        <span class="stop-num" style="transform:scale(.8)">${i + 1}</span>
        <div class="body"><div class="name" data-act="stop-rename" data-i="${i}">${esc(s.name)}</div>
          <div class="sub">${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</div></div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <button class="btn small" data-act="stop-up" data-i="${i}">↑</button>
          <button class="btn small" data-act="stop-down" data-i="${i}">↓</button>
          <button class="btn small danger" data-act="stop-del" data-i="${i}">✕</button>
        </div></div>`;
    });
    html += `</div>
      <div class="small-note" style="margin:4px 0 6px">点击地图即可添加途经点；也可在地点弹窗里点「加入路线」</div>
      <div class="row-actions">
        <button class="btn small primary" data-act="route-save">💾 保存路线</button>
        <button class="btn small danger" data-act="route-cancel">取消</button>
      </div></div>`;
  } else if (S.editRouteId) {
    const r = S.routes.find((x) => x.id === S.editRouteId);
    const canEdit = r && S.user && (r.ownerId === S.user.id || (r.collaborators || []).includes(S.user.id));
    if (!r || !canEdit) {
      S.editRouteId = null;
    } else {
      html += `<div class="active-card">
        <div class="title">✏️ 编辑路线</div>
        <input class="text" type="text" data-role="re-name" value="${esc(r.name)}">
        <div>`;
      S.editStops.forEach((s, i) => {
        html += `<div class="list-item" style="padding:5px 8px">
          <span class="stop-num" style="transform:scale(.8)">${i + 1}</span>
          <div class="body"><div class="name">${esc(s.name)}</div><div class="sub">${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}</div></div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <button class="btn small" data-act="re-up" data-i="${i}">↑</button>
            <button class="btn small" data-act="re-down" data-i="${i}">↓</button>
            <button class="btn small danger" data-act="re-del" data-i="${i}">✕</button>
          </div></div>`;
      });
      html += `</div>
        <div class="row-actions" style="margin-top:6px">
          <select data-role="re-add-place"><option value="">选择地点添加…</option>${S.places.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <button class="btn small" data-act="re-add">＋ 添加</button>
        </div>
        <div class="row-actions">
          <button class="btn small primary" data-act="re-save">💾 保存修改</button>
          <button class="btn small danger" data-act="re-cancel">取消</button>
        </div>
        <div class="small-note">共享给好友后，好友也能一起修改这条路线</div>
      </div>`;
    }
  } else {
    html += `<button class="btn primary" style="width:100%;margin-bottom:10px" data-act="route-new">＋ 新建路线</button>`;
  }
  if (!S.routes.length && !S.builder) html += `<div class="empty-tip">还没有路线<br>规划好行程后可以共享给好友一起编辑</div>`;
  for (const r of visible) {
    const isOwner = S.user && r.ownerId === S.user.id;
    const canEdit = S.user && (isOwner || (r.collaborators || []).includes(S.user.id));
    const collabCount = (r.collaborators || []).length;
    html += `<div class="list-item">
      <span class="emoji">🧭</span>
      <div class="body">
        <div class="name" data-act="route-view" data-route="${r.id}">${esc(r.name)}${!isOwner && canEdit ? ' <span class="badge share">好友共享</span>' : ''}${isOwner && collabCount ? ` <span class="badge share">👥 ${collabCount}</span>` : ''}</div>
        <div class="sub">${r.stops.length} 站 · ${avatarHtml(r.ownerId, r.ownerAvatar, r.ownerAvatarImg)} ${esc(r.ownerName)} · ${fmtTime(r.time)}</div>
        <div class="row-actions">
          <button class="btn small" data-act="route-view" data-route="${r.id}">查看</button>
          ${canEdit ? `<button class="btn small primary" data-act="route-edit" data-route="${r.id}">✏️ 编辑</button>` : ''}
          ${isOwner ? `<button class="btn small" data-act="route-collab" data-route="${r.id}">👥 共享给好友</button>` : ''}
          ${isOwner ? `<button class="btn small" data-act="route-share" data-route="${r.id}">🔗 链接</button>` : ''}
          ${isOwner ? `<button class="btn small danger" data-act="route-delete" data-route="${r.id}">删除</button>` : ''}
          <button class="btn small" data-act="route-hide" data-route="${r.id}" title="从我的地图隐藏这条路线">🙈</button>
        </div>
      </div></div>`;
  }
  html += hiddenFooter();
  $('#panel').innerHTML = html;
}

function renderPhotosPanel() {
  loadHidden();
  let html = `<div class="panel-title"><span>照片 · ${S.photos.length}</span>
    <button class="btn small primary" data-act="photo-add">＋ 新增照片</button></div>`;
  if (!S.photos.length) {
    html += `<div class="empty-tip">还没有照片<br>点「＋ 新增照片」从相册上传</div>`;
  }

  // 按 洲 → 国家 → 城市 分组
  const groups = {};
  for (const ph of S.photos) {
    if (isPhotoHidden(ph)) continue;
    const geo = photoGeo(ph);
    const continent = geo.continent || '未分类';
    const country = geo.country || '未分类';
    const city = geo.city || '未分类';
    groups[continent] = groups[continent] || {};
    groups[continent][country] = groups[continent][country] || {};
    groups[continent][country][city] = groups[continent][country][city] || [];
    groups[continent][country][city].push(ph);
  }
  const sortKeys = (arr) => arr.sort((a, b) => (a === '未分类' ? 1 : b === '未分类' ? -1 : a.localeCompare(b, 'zh')));

  for (const continent of sortKeys(Object.keys(groups))) {
    const countries = groups[continent];
    const contCount = Object.values(countries).reduce((a, cs) => a + Object.values(cs).reduce((x, arr) => x + arr.length, 0), 0);
    const firstList = Object.values(Object.values(countries)[0] || {})[0] || [];
    const contGeo = firstList[0] ? photoGeo(firstList[0]) : {};
    const contKey = contGeo.continent ? 'cont:' + contGeo.continent : '';
    html += `<div class="geo-continent">🌍 ${esc(continent)}<span class="lit-count">${contCount}</span>${contKey ? geoEye(contKey, '隐藏' + continent) : ''}</div>`;
    for (const country of sortKeys(Object.keys(countries))) {
      const cities = countries[country];
      const count = Object.values(cities).reduce((a, arr) => a + arr.length, 0);
      const countryFirst = Object.values(cities)[0] && Object.values(cities)[0][0];
      const countryGeo = countryFirst ? photoGeo(countryFirst) : {};
      const countryKey = countryGeo.country ? 'country:' + countryGeo.country : '';
      html += `<div class="geo-country">🏳️ ${esc(country)}<span class="lit-count">${count}</span>${countryKey ? geoEye(countryKey, '隐藏' + country) : ''}</div>`;
      for (const city of sortKeys(Object.keys(cities))) {
        const photos = cities[city];
        const cityFirst = photos[0];
        const cityGeo = cityFirst ? photoGeo(cityFirst) : {};
        const cityKey = cityGeo.city ? 'city:' + cityGeo.country + '|' + cityGeo.city : '';
        html += `<div class="geo-city">🏙 ${esc(city)}<span class="lit-count">${photos.length}</span>${cityKey ? geoEye(cityKey, '隐藏' + city) : ''}</div>`;
        html += `<div class="photo-grid" style="grid-template-columns:repeat(3,1fr)">`;
        for (const ph of photos) {
          html += `<div class="photo-card" data-act="photo-open" data-photo="${ph.id}">
            <img src="/api/photos/${ph.id}/file" loading="lazy" alt="${esc(ph.name)}">
            ${ph.category ? `<span class="pc-cat">${esc(ph.category)}</span>` : ''}
            <span class="pc-name">${esc(ph.name)}</span>
          </div>`;
        }
        html += `</div>`;
      }
    }
  }
  html += hiddenFooter();
  $('#panel').innerHTML = html;

  // 后台补全照片/所属地点的洲、国家、城市
  if (S.user) {
    const missing = S.photos.filter((ph) => {
      const place = ph.placeId ? S.places.find((p) => p.id === ph.placeId) : null;
      const cont = ph.continent || (place && place.continent);
      const ctry = ph.country || (place && place.country);
      const cty = ph.city || (place && place.city);
      return !(cont && ctry && cty);
    });
    if (missing.length) geocodePhotos(missing);
  }
}

async function geocodePhoto(ph) {
  if (!S.user || !ph || (ph.continent && ph.country && ph.city)) return false;
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${ph.lat}&longitude=${ph.lng}&localityLanguage=${S.lang === 'en' ? 'en' : 'zh'}`);
    const d = await r.json();
    const country = String(d.countryName || '').slice(0, 60);
    const city = String(d.city || d.locality || d.principalSubdivision || '').slice(0, 60);
    const continent = String(d.continent || '').slice(0, 30);
    if (!country && !city && !continent) return false;
    await api('/api/photos/' + ph.id, { method: 'PATCH', json: { country, city, continent } });
    ph.country = country;
    ph.city = city;
    ph.continent = continent;
    return true;
  } catch (e) { return false; }
}

async function geocodePhotos(photos) {
  let changed = false;
  for (const ph of photos) {
    const place = ph.placeId ? S.places.find((p) => p.id === ph.placeId) : null;
    if (place) {
      if (!(place.continent && place.country && place.city) && await geocodePlace(place)) changed = true;
    } else if (await geocodePhoto(ph)) changed = true;
  }
  if (changed) {
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
    if (S.tab === 'photos' && !S.share && !typing) renderPhotosPanel();
  }
}

function showPhotoAddModal() {
  if (!S.user) { showLogin(); return; }
  const opts = S.places.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `<div class="modal">
    <h2>新增照片 📷</h2>
    <div class="m-sub">可自定义名称和分类；照片会按国家 / 城市自动归类</div>
    <div class="f-row">选择照片（可多张）<input type="file" data-role="pa-files" multiple accept="image/*"></div>
    <div class="f-row">名称（可选，留空用文件名）<input type="text" data-role="pa-title" placeholder="如：西湖日落" maxlength="40"></div>
    <div class="f-row">分类
      <select data-role="pa-cat">
        <option value="">不分类</option>
        <option>风景</option><option>美食</option><option>人物</option><option>建筑</option><option>动物</option><option>其他</option>
      </select>
    </div>
    <div class="f-row">归类到
      <select data-role="pa-place">
        <option value="">当前地图中心（不绑定地点）</option>
        ${opts}
      </select>
    </div>
    <label class="share-check" style="display:block;margin:8px 0"><input type="checkbox" data-role="pa-shared"> 共享给所有人</label>
    <button class="btn primary" style="width:100%;margin-top:8px" data-act="photo-add-submit">上传</button>
  </div>`;
}

function renderStatsPanel() {
  const visited = S.places.filter((p) => p.visited).length;
  const reviews = S.places.reduce((a, p) => a + p.reviews.length, 0);
  const dist = S.tracks.reduce((a, t) => a + trackStats(t.points), 0);
  const shared = S.photos.filter((p) => p.shared).length;
  const byCat = {};
  for (const p of S.places) byCat[catName(p.category)] = (byCat[catName(p.category)] || 0) + 1;
  $('#panel').innerHTML = `<div class="panel-title"><span>我的足迹板</span></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${S.places.length}</div><div class="lbl">地点总数</div></div>
      <div class="stat-card" data-act="stats-lit" style="cursor:pointer"><div class="num">${visited}</div><div class="lbl">已点亮 ›</div></div>
      <div class="stat-card"><div class="num">${S.places.length - visited}</div><div class="lbl">想去</div></div>
      <div class="stat-card"><div class="num">${reviews}</div><div class="lbl">条评价</div></div>
      <div class="stat-card"><div class="num">${S.tracks.length}</div><div class="lbl">条轨迹</div></div>
      <div class="stat-card"><div class="num">${(dist / 1000).toFixed(1)}</div><div class="lbl">累计 km</div></div>
      <div class="stat-card"><div class="num">${S.photos.length}</div><div class="lbl">照片</div></div>
      <div class="stat-card"><div class="num">${S.routes.length}</div><div class="lbl">条路线</div></div>
    </div>
    <div class="panel-title" style="margin-top:14px"><span>分类</span><span class="small-note">已共享照片 ${shared} 张</span></div>
    ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="list-item" style="padding:5px 10px"><div class="body"><div class="sub">${k} × ${v}</div></div></div>`).join('') || '<div class="empty-tip">暂无数据</div>'}`;
}

/* ---------------- 点亮足迹（按国家 / 城市分组） ---------------- */
function renderLitPanel() {
  loadHidden();
  const lit = S.places.filter((p) => p.visited && !isPlaceHidden(p));
  const groups = {};
  for (const p of lit) {
    const country = (p.country || '').trim() || '未分类';
    const city = (p.city || '').trim() || '未分类';
    groups[country] = groups[country] || {};
    groups[country][city] = groups[country][city] || [];
    groups[country][city].push(p);
  }
  const sortKeys = (arr) => arr.sort((a, b) => (a === '未分类' ? 1 : b === '未分类' ? -1 : a.localeCompare(b, 'zh')));
  let html = `<div class="panel-title"><span><a href="#" data-act="stats-back" style="color:var(--accent);text-decoration:none">← 统计</a></span>
    <span class="small-note">${lit.length} 个点亮</span></div>`;
  if (!lit.length) html += `<div class="empty-tip">还没有点亮的地方<br>去地图上钉几个吧</div>`;
  for (const country of sortKeys(Object.keys(groups))) {
    const cities = groups[country];
    const count = Object.values(cities).reduce((a, arr) => a + arr.length, 0);
    html += `<div class="lit-country">🌍 ${esc(country)}<span class="lit-count">${count}</span></div>`;
    for (const city of sortKeys(Object.keys(cities))) {
      const places = cities[city];
      html += `<div class="lit-city">🏙 ${esc(city)}<span class="lit-count">${places.length}</span></div>`;
      for (const p of places) {
        const avg = avgStars(p);
        html += `<div class="list-item" style="margin-left:8px">
          <span class="emoji">${catEmoji(p.category)}</span>
          <div class="body">
            <div class="name" data-act="place-fly" data-place="${p.id}">${esc(p.name)}</div>
            <div class="sub">${avg !== null ? starStr(avg) + ' ' + avg.toFixed(1) : '暂无评分'}${p.visitedAt ? ' · 🕒 ' + esc(fmtVisit(p.visitedAt)) : ''}</div>
          </div></div>`;
      }
    }
  }
  $('#panel').innerHTML = html;
  // 后台补全缺失的国家/城市（仅登录用户可写）
  if (S.user) {
    const missing = lit.filter((p) => !p.country && !p.city);
    if (missing.length) geocodeAll(missing);
  }
}

async function geocodePlace(place) {
  if (!S.user || !place || (place.country && place.city && place.continent)) return false;
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${place.lat}&longitude=${place.lng}&localityLanguage=${S.lang === 'en' ? 'en' : 'zh'}`);
    const d = await r.json();
    const country = String(d.countryName || '').slice(0, 60);
    const city = String(d.city || d.locality || d.principalSubdivision || '').slice(0, 60);
    const continent = String(d.continent || '').slice(0, 30);
    if (!country && !city && !continent) return false;
    await api('/api/places/' + place.id, { method: 'PATCH', json: { country, city, continent } });
    place.country = country;
    place.city = city;
    place.continent = continent;
    return true;
  } catch (e) { return false; }
}

async function geocodeAll(places) {
  let changed = false;
  for (const p of places) {
    if (p.country && p.city && p.continent) continue;
    if (await geocodePlace(p)) changed = true;
  }
  if (changed) {
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
    if (S.tab === 'stats' && S.statsView === 'lit') renderLitPanel();
    else if (S.tab === 'places' && !S.share && !typing) renderPlacesPanel();
  }
}

/* ---------------- 好友 ---------------- */
async function renderFriendsPanel() {
  const panel = $('#panel');
  panel.innerHTML = '<div class="empty-tip">加载中…</div>';
  try {
    const d = await api('/api/users');
    S.users = d.users;
    const myCode = (S.user && S.user.friendCode) || d.friendCode || '';
    let html = `<div class="panel-title"><span>我的好友代码</span></div>
      <div class="list-item"><div class="body">
        <div class="name" style="font-family:monospace;font-size:22px;letter-spacing:3px">${esc(myCode || '—')}</div>
        <div class="sub">把这串数字发给朋友，对方就能加你为好友</div>
        <div class="row-actions"><button class="btn small" data-act="copy-code">复制代码</button></div>
      </div></div>
      <div class="panel-title" style="margin-top:14px"><span>添加好友</span></div>
      <input class="text" data-role="friend-code-input" placeholder="输入对方的好友代码（数字或字母）" inputmode="text">
      <button class="btn primary" data-act="friend-add">＋ 添加好友</button>
      <div class="panel-title" style="margin-top:16px"><span>好友 · ${d.users.length}</span>
        <button class="btn small" data-act="friends-refresh">↻ 刷新</button></div>`;
    if (!d.users.length) html += `<div class="empty-tip">还没有好友<br>用上面的好友代码添加吧</div>`;
    for (const u of d.users) {
      html += `<div class="list-item">
        <span class="emoji">${avatarHtml(u.id, u.avatar, u.avatarImg, u.avatarVer)}</span>
        <div class="body">
          <div class="name" data-act="friend-open" data-user="${u.id}">${esc(u.name)}</div>
          <div class="sub">${u.reviewCount} 条评价 · ${u.photoCount} 张共享照片</div>
          <div class="row-actions">
            <button class="btn small" data-act="friend-open" data-user="${u.id}">查看</button>
            <button class="btn small danger" data-act="friend-delete" data-user="${u.id}" data-name="${esc(u.name)}">删除好友</button>
          </div>
        </div></div>`;
    }
    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = `<div class="empty-tip">${esc(e.message)}</div>`;
  }
}

async function openFriendProfile(id) {
  S.viewingFriend = id;
  const panel = $('#panel');
  panel.innerHTML = '<div class="empty-tip">加载中…</div>';
  try {
    const d = await api('/api/users/' + id + '/profile');
    S.friendProfile = d;
    renderFriendProfilePanel();
  } catch (e) {
    panel.innerHTML = `<div class="empty-tip">${esc(e.message)}</div>`;
  }
}

function renderFriendProfilePanel() {
  const d = S.friendProfile;
  if (!d) return;
  const u = d.user;
  let html = `<div class="panel-title"><span><a href="#" data-act="friend-back" style="color:var(--accent);text-decoration:none">← 好友</a></span></div>
    <div class="list-item"><span class="emoji">${avatarHtml(u.id, u.avatar, u.avatarImg, u.avatarVer)}</span>
      <div class="body"><div class="name">${esc(u.name)}</div>
      <div class="sub">${d.reviews.length} 条评价 · ${d.photos.length} 张共享照片</div>
      <div class="row-actions"><button class="btn small danger" data-act="friend-delete" data-user="${u.id}" data-name="${esc(u.name)}">删除好友</button></div>
      </div></div>`;

  // 统计概览
  const created = S.places.filter((p) => p.createdBy === u.id);
  const lit = created.filter((p) => p.visited);
  const reviewCount = S.places.reduce((a, p) => a + p.reviews.filter((r) => r.userId === u.id).length, 0);
  const photoCount = S.photos.filter((x) => x.ownerId === u.id && x.shared).length;
  const trackCount = S.tracks.filter((t) => t.ownerId === u.id).length;
  const routeCount = S.routes.filter((r) => r.ownerId === u.id).length;
  const continents = new Set(lit.map((p) => p.continent).filter(Boolean));
  html += `<div class="stat-grid" style="margin-top:10px">
    <div class="stat-card"><div class="num">${created.length}</div><div class="lbl">地点</div></div>
    <div class="stat-card"><div class="num">${lit.length}</div><div class="lbl">已点亮</div></div>
    <div class="stat-card"><div class="num">${continents.size}</div><div class="lbl">洲</div></div>
    <div class="stat-card"><div class="num">${reviewCount}</div><div class="lbl">条评价</div></div>
    <div class="stat-card"><div class="num">${photoCount}</div><div class="lbl">共享照片</div></div>
    <div class="stat-card"><div class="num">${trackCount}</div><div class="lbl">条轨迹</div></div>
    <div class="stat-card"><div class="num">${routeCount}</div><div class="lbl">条路线</div></div>
  </div>`;

  html += `<div class="panel-title" style="margin-top:12px">评价与评分</div>`;
  if (!d.reviews.length) html += `<div class="small-note" style="padding:4px 0">还没有评价</div>`;
  d.reviews.forEach((r, i) => {
    const rid = 'reply-' + i;
    html += `<div class="list-item"><span class="emoji">${catEmoji(r.category)}</span>
      <div class="body">
        <div class="name">${esc(r.placeName)}</div>
        <div class="sub">${starStr(r.stars)} ${r.stars} 星</div>
        ${r.comment ? `<div class="sub" style="color:var(--ink)">${esc(r.comment)}</div>` : ''}`;
    for (const rep of (r.replies || [])) {
      html += `<div class="sub" style="margin:5px 0 0 6px">💬 ${avatarHtml(rep.fromId, rep.fromAvatar, rep.fromAvatarImg)} <b>${esc(rep.fromName)}</b>：${esc(rep.text)}</div>`;
    }
    html += `<input class="text" data-role="${rid}" placeholder="回复这条评价…" style="margin-top:6px">
      <button class="btn small" data-act="review-reply" data-place="${r.placeId}" data-user="${u.id}" data-input="${rid}">留言</button>
      </div></div>`;
  });

  html += `<div class="panel-title" style="margin-top:12px">共享照片</div>`;
  if (!d.photos.length) html += `<div class="small-note" style="padding:4px 0">还没有共享照片</div>`;
  else {
    html += `<div class="photo-grid">`;
    for (const ph of d.photos) html += `<img src="/api/photos/${ph.id}/file" loading="lazy" data-act="photo-open" data-photo="${ph.id}">`;
    html += `</div><div class="small-note">点开照片可以打分、留言</div>`;
  }

  html += `<div class="panel-title" style="margin-top:12px">留言板</div>`;
  if (!d.wall.length) html += `<div class="small-note" style="padding:4px 0">还没有留言，来做第一个吧</div>`;
  for (const w of d.wall) {
    html += `<div class="sub" style="margin:6px 0">${avatarHtml(w.fromId, w.fromAvatar, w.fromAvatarImg)} <b>${esc(w.fromName)}</b>：${esc(w.text)} <span style="color:#9aa1ad">${fmtTime(w.time).slice(5)}</span></div>`;
  }
  html += `<input class="text" data-role="wall-input" placeholder="给 ${esc(u.name)} 留言…" style="margin-top:6px">
    <button class="btn small primary" data-act="wall-post" data-user="${u.id}">发送留言</button>`;

  $('#panel').innerHTML = html;
}

function renderSharePanel() {
  const d = S.share;
  if (d && d.type === 'track') {
    $('#panel').innerHTML = `<div class="panel-title"><span>🔗 分享的轨迹</span></div>
      <div class="list-item"><span class="emoji">➰</span><div class="body">
        <div class="name">${esc(d.track.name)}</div>
        <div class="sub">${esc(d.track.ownerName)} 记录 · ${d.track.pointCount} 个点</div>
        <div class="row-actions"><button class="btn small" data-act="share-exit">进入完整足迹板</button></div>
      </div></div>`;
    return;
  }
  let html = `<div class="panel-title"><span>🔗 分享的路线</span></div>
    <div class="list-item"><span class="emoji">🧭</span><div class="body">
      <div class="name">${esc(d.route.name)}</div>
      <div class="sub">${d.route.ownerName} 规划 · ${d.route.stopCount} 站</div>
      <div class="row-actions"><button class="btn small" data-act="share-exit">进入完整足迹板</button></div>
    </div></div>`;
  d.stops.forEach((s) => {
    html += `<div class="list-item"><span class="emoji">${s.place ? catEmoji(s.place.category) : '📍'}</span><div class="body">
      <div class="name">${s.index}. ${esc(s.name)}</div>`;
    if (s.place && s.place.avg !== null) html += `<div class="sub">${starStr(s.place.avg)} ${s.place.avg.toFixed(1)} · ${s.place.reviewCount} 人评价</div>`;
    if (s.place && s.place.note) html += `<div class="sub">${esc(s.place.note)}</div>`;
    for (const r of (s.place ? s.place.reviews : []).slice(0, 5)) {
      html += `<div class="sub">${avatarHtml(r.userId, r.userAvatar, r.userAvatarImg)} ${esc(r.userName)}：${starStr(r.stars)}${r.comment ? ' ' + esc(r.comment) : ''}</div>`;
    }
    html += `</div></div>`;
    if (s.photos.length) {
      html += `<div class="photo-grid">`;
      for (const ph of s.photos) html += `<img src="${ph.url}" loading="lazy" alt="${esc(ph.name)}">`;
      html += `</div>`;
    }
  });
  $('#panel').innerHTML = html;
}

/* ---------------- 登录 / 头像 ---------------- */
function showLogin(mode = 'login') {
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `<div class="modal">
    <h2>欢迎来到足迹板 📍</h2>
    <div class="m-sub">注册即自动加入共享足迹板，和伙伴共用一个世界地图</div>
    <div class="m-tabs">
      <button data-m="login" class="${mode === 'login' ? 'on' : ''}">登录</button>
      <button data-m="reg" class="${mode === 'reg' ? 'on' : ''}">注册</button>
    </div>
    <input type="text" placeholder="昵称" data-role="m-name" maxlength="24">
    <input type="password" placeholder="密码" data-role="m-pass" maxlength="64">
    <div class="err" data-role="m-err"></div>
    <button class="btn primary" style="width:100%;padding:9px" data-act="m-submit">${mode === 'reg' ? '注册并进入' : '登录'}</button>
  </div>`;
  root.querySelector('.m-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (b) showLogin(b.dataset.m);
  });
  // 手机上按键盘「前往/回车」也能直接提交
  root.querySelectorAll('[data-role="m-name"], [data-role="m-pass"]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitLogin(); }
    });
  });
  root.querySelector('[data-role="m-name"]').focus();
}

function showAvatarPicker() {
  if (!S.user) { showLogin(); return; }
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `<div class="modal">
    <h2>更改头像</h2>
    <div class="m-sub">上传本地图片，或挑一个 emoji（点击即生效）</div>
    <label class="btn primary" style="width:100%;margin-bottom:12px;display:flex;justify-content:center;padding:9px">📷 选择图片（相册 / 本地）
      <input type="file" accept="image/*" data-role="avatar-file" hidden></label>
    <div class="avatar-grid">${AVATARS.map((a) => `<button class="aopt" data-avatar="${a}" title="${a}">${a}</button>`).join('')}</div>
  </div>`;
  root.querySelector('.avatar-grid').addEventListener('click', async (e) => {
    const b = e.target.closest('.aopt'); if (!b) return;
    try {
      await api('/api/me', { method: 'PATCH', json: { avatar: b.dataset.avatar } });
      S.user.avatar = b.dataset.avatar;
      S.user.avatarImg = false;
      $('#modal-root').hidden = true;
      renderUserUI();
      toast('✓ 头像已更新');
    } catch (err) { toast(err.message); }
  });
}

/* ---- 头像裁剪：拖动 + 缩放选择区域 ---- */
function openAvatarCropper(file) {
  if (!((file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(file.name || ''))) { toast('请选择图片文件'); return; }
  const img = new Image();
  img.onload = () => { buildCropper(img); URL.revokeObjectURL(img.src); };
  img.onerror = () => toast('无法读取这张图片');
  img.src = URL.createObjectURL(file);
}

function buildCropper(img) {
  const C = 280;
  const root = $('#modal-root');
  root.hidden = false;
  root.innerHTML = `<div class="modal">
    <h2>选择头像区域</h2>
    <div class="m-sub">拖动图片调整位置 · 滚轮或滑块缩放</div>
    <canvas id="crop-canvas" width="${C}" height="${C}"></canvas>
    <input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1">
    <div class="crop-actions">
      <button class="btn" id="crop-cancel">取消</button>
      <button class="btn primary" id="crop-ok">使用这张</button>
    </div>
  </div>`;

  const cv = $('#crop-canvas');
  const ctx = cv.getContext('2d');
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const cover = Math.max(C / iw, C / ih);
  let s = cover, ox = (C - iw * s) / 2, oy = (C - ih * s) / 2;

  function clamp() {
    ox = Math.min(0, Math.max(C - iw * s, ox));
    oy = Math.min(0, Math.max(C - ih * s, oy));
  }
  function draw() {
    clamp();
    ctx.fillStyle = '#101318';
    ctx.fillRect(0, 0, C, C);
    ctx.drawImage(img, ox, oy, iw * s, ih * s);
    const r = C / 2 - 10;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, C, C);
    ctx.moveTo(C / 2 + r, C / 2);
    ctx.arc(C / 2, C / 2, r, 0, Math.PI * 2, false);
    ctx.fillStyle = 'rgba(8,10,14,.55)';
    ctx.fill('evenodd');
    ctx.restore();
    ctx.beginPath();
    ctx.arc(C / 2, C / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  function setZoom(z) {
    const ns = cover * z;
    const cx = (C / 2 - ox) / s, cy = (C / 2 - oy) / s;
    s = ns;
    ox = C / 2 - cx * s;
    oy = C / 2 - cy * s;
    clamp(); draw();
  }
  draw();

  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox, oy };
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = C / (cv.getBoundingClientRect().width || C);
    ox = drag.ox + (e.clientX - drag.x) * k;
    oy = drag.oy + (e.clientY - drag.y) * k;
    clamp(); draw();
  });
  const endDrag = () => { drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const z = Math.max(1, Math.min(4, (s / cover) * (1 - e.deltaY * 0.0015)));
    $('#crop-zoom').value = z;
    setZoom(z);
  }, { passive: false });
  $('#crop-zoom').addEventListener('input', (e) => setZoom(parseFloat(e.target.value)));
  $('#crop-cancel').addEventListener('click', () => { $('#modal-root').hidden = true; });

  $('#crop-ok').addEventListener('click', () => {
    const out = document.createElement('canvas');
    out.width = 256; out.height = 256;
    const octx = out.getContext('2d');
    const sx = -ox / s, sy = -oy / s, sw = C / s, sh = C / s;
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, 256, 256);
    out.toBlob(async (blob) => {
      if (!blob) { toast('生成图片失败'); return; }
      try {
        const r = await fetch('/api/me/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
          body: blob,
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || '上传失败');
        S.user = data.user;
        $('#modal-root').hidden = true;
        renderUserUI();
        toast('✓ 头像已更新');
      } catch (err) { toast(err.message); }
    }, 'image/jpeg', 0.92);
  });
}

async function submitLogin() {
  const name = $('#modal-root [data-role="m-name"]').value.trim();
  const pass = $('#modal-root [data-role="m-pass"]').value;
  const isReg = $('#modal-root .m-tabs button.on').dataset.m === 'reg';
  const err = $('#modal-root [data-role="m-err"]');
  try {
    const d = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', json: { name, password: pass } });
    S.token = d.token;
    lsSet('tb_token', d.token);
    $('#modal-root').hidden = true;
    S.snapshot = '';
    S.tutorialShown = false; // 新账号可再次触发教程
    await loadAll();
    toast(`欢迎，${d.user.name}！`);
  } catch (e) { err.textContent = e.message; }
}

/* ---------------- 新手教程 ---------------- */
function showTutorial() { S.tutIdx = 0; renderTut(); $('#tutorial').hidden = false; }
function renderTut() {
  const s = TUTORIAL[S.tutIdx];
  $('#tut-emoji').textContent = s.e;
  $('#tut-title').textContent = s.t;
  $('#tut-text').textContent = s.x;
  $('#tut-dots').innerHTML = TUTORIAL.map((_, i) => `<span class="${i === S.tutIdx ? 'on' : ''}"></span>`).join('');
  $('#tut-next').hidden = S.tutIdx >= TUTORIAL.length - 1;
  $('#tut-done').hidden = S.tutIdx < TUTORIAL.length - 1;
  $('#tut-skip').hidden = S.tutIdx >= TUTORIAL.length - 1;
}
function tutNext() {
  if (S.tutIdx < TUTORIAL.length - 1) { S.tutIdx++; renderTut(); }
  else finishTutorial();
}
function finishTutorial() {
  $('#tutorial').hidden = true;
  if (S.user) api('/api/me/tutorial', { method: 'POST' }).catch(() => {});
}

/* ---------------- 分享视图 ---------------- */
let shareGrayLayer = null;

// 分享页：切换成干净的灰色底图
function enterShareMap() {
  document.body.classList.add('share-mode');
  for (const l of Object.values(baseLayers)) if (map.hasLayer(l)) map.removeLayer(l);
  for (const l of Object.values(labelLayers)) if (map.hasLayer(l)) map.removeLayer(l);
  if (!shareGrayLayer) {
    shareGrayLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 16, maxNativeZoom: 16, attribution: '底图 © Esri' }
    );
  }
  if (!map.hasLayer(shareGrayLayer)) shareGrayLayer.addTo(map);
}

// 在分享页把「点亮过的地方」画成金色图钉
function renderLitPlaces(places) {
  const visited = (places || []).filter((p) => p.visited);
  for (const p of visited) {
    L.marker([p.lat, p.lng], { icon: placeIcon({ category: p.category, visited: true }) })
      .bindPopup(`<div class="pop-title">${catEmoji(p.category)} ${esc(p.name)}</div>
        ${p.avg !== null ? `<div class="pop-avg">${starStr(p.avg)} ${p.avg.toFixed(1)} · ${p.reviewCount} 人评价</div>` : ''}`)
      .addTo(placeLayer);
  }
  return visited;
}

// 足迹板分享页（无需登录）：灰色地图 + 点亮的地方
async function loadBoardShare() {
  try {
    const d = await api('/api/share-board');
    S.share = d;
    enterShareMap();
    const visited = renderLitPlaces(d.places);
    if (visited.length) map.fitBounds(L.latLngBounds(visited.map((p) => [p.lat, p.lng])).pad(0.3));
    else map.setView([20, 0], 2);
    const banner = document.createElement('div');
    banner.id = 'share-banner';
    banner.innerHTML = `<b>🌍 共享足迹板</b><br>${d.visitedCount} 个点亮的地方 · ${d.photoCount} 张共享照片
      <br><button class="btn small" data-act="share-exit">进入完整足迹板</button>`;
    document.body.appendChild(banner);
    renderUserUI();
  } catch (e) {
    toast(e.message);
    S.share = null;
    boot();
  }
}

async function loadShare(token) {
  try {
    const d = await api('/api/share/' + token);
    S.share = d;
    enterShareMap();

    // 分享的轨迹
    if (d.type === 'track') {
      const pts = (d.track.points || []).map((p) => [p[0], p[1]]);
      if (pts.length >= 2) {
        L.polyline(pts, { color: '#ffffff', weight: 8, opacity: .5 }).addTo(routeLayer);
        L.polyline(pts, { color: '#ff6b35', weight: 4, opacity: .95 }).addTo(routeLayer);
        L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).addTo(routeLayer);
        L.circleMarker(pts[pts.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }).addTo(routeLayer);
      }
      const banner = document.createElement('div');
      banner.id = 'share-banner';
      banner.innerHTML = `<b>➰ ${esc(d.track.name)}</b><br>由 ${esc(d.track.ownerName)} 分享的轨迹 · ${d.track.pointCount} 个点
        <br><button class="btn small" data-act="share-exit">进入完整足迹板</button>`;
      document.body.appendChild(banner);
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25));
      else map.setView([20, 0], 2);
      renderSharePanel();
      renderUserUI();
      return;
    }

    const banner = document.createElement('div');
    banner.id = 'share-banner';
    banner.innerHTML = `<b>🔗 ${esc(d.route.name)}</b><br>由 ${esc(d.route.ownerName)} 分享的路线 · ${d.route.stopCount} 站
      <br><button class="btn small" data-act="share-exit">进入完整足迹板</button>`;
    document.body.appendChild(banner);
    const pts = d.stops.map((s) => [s.lat, s.lng]);
    if (pts.length >= 2) L.polyline(pts, { color: '#e8a13a', weight: 4, dashArray: '6 8' }).addTo(routeLayer);
    d.stops.forEach((s) => {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html: `<div class="stop-num">${s.index}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).bindPopup(`<div class="pop-title">${s.place ? catEmoji(s.place.category) : '📍'} ${esc(s.name)}</div>
        ${s.place && s.place.avg !== null ? `<div class="pop-avg">${starStr(s.place.avg)} ${s.place.avg.toFixed(1)} · ${s.place.reviewCount} 人评价</div>` : ''}
        ${s.place && s.place.note ? `<div class="pop-note">${esc(s.place.note)}</div>` : ''}
        ${s.photos.length ? `<div class="photo-grid">${s.photos.map((p) => `<img src="${p.url}">`).join('')}</div>` : ''}`).addTo(routeLayer);
    });
    try { const board = await api('/api/share-board'); renderLitPlaces(board.places); } catch (e) {}
    map.fitBounds(L.latLngBounds(pts).pad(0.3));
    renderSharePanel();
    renderUserUI();
  } catch (e) {
    toast(e.message);
    S.share = null;
    boot();
  }
}

/* ---------------- 头像拖动 ---------------- */

function wireAvatarDrag() {
  const btn = $('#avatar-btn');
  const saved = JSON.parse(localStorage.getItem('tb_avatar_pos') || 'null');
  if (saved && typeof saved.x === 'number') { btn.style.left = saved.x + 'px'; btn.style.top = saved.y + 'px'; }
  let startX, startY, startLeft, startTop, moved = false;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    startLeft = btn.offsetLeft; startTop = btn.offsetTop;
    moved = false;
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
  });
  btn.addEventListener('pointermove', (e) => {
    if (startX === undefined) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 8) moved = true;
    if (!moved) return;
    const maxX = window.innerWidth - btn.offsetWidth - 8, maxY = window.innerHeight - btn.offsetHeight - 8;
    btn.style.left = Math.max(8, Math.min(maxX, startLeft + dx)) + 'px';
    btn.style.top = Math.max(8, Math.min(maxY, startTop + dy)) + 'px';
    btn.style.right = 'auto'; btn.style.bottom = 'auto';
  });
  btn.addEventListener('pointerup', () => {
    if (startX !== undefined && moved) {
      localStorage.setItem('tb_avatar_pos', JSON.stringify({ x: btn.offsetLeft, y: btn.offsetTop }));
    }
    startX = undefined;
  });
  btn.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
    toggleDrawer();
    renderPanel();
  });
}

function shareBase() {
  return (S.publicUrl || location.origin).replace(/\/+$/, '');
}
async function ensurePublicUrl() {
  if (S.publicUrl) return;
  try { const c = await api('/api/config'); S.publicUrl = c.publicUrl || ''; } catch (e) {}
}
function isLocalUrl(u) {
  return /:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u);
}
async function shareBoard() {
  await ensurePublicUrl();
  const base = shareBase();
  const url = `${base}/#board`;
  const local = !S.publicUrl && isLocalUrl(base);
  const done = () => toast(local
    ? '⚠️ 未检测到公网地址，别人打不开！请先运行「启动公网访问」再分享'
    : '🔗 分享链接已复制，朋友打开就能看到你点亮的地方', local ? 7000 : 3000);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => { prompt('复制分享链接：', url); });
  } else { prompt('复制分享链接：', url); }
}

/* ---------------- 搜索 / 昼夜开关 / 纯净模式 ---------------- */
let searchTimer = null, searchData = [];

function setupSearch() {
  const input = $('#search-input'), results = $('#search-results');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(() => doSearch(q, results), 400);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(input.value.trim(), results); }
  });
  results.addEventListener('click', (e) => {
    const item = e.target.closest('.sr-item');
    if (!item || item.dataset.i === undefined) return;
    const d = searchData[parseInt(item.dataset.i, 10)];
    if (!d) return;
    results.innerHTML = ''; input.value = '';
    const lat = parseFloat(d.lat), lng = parseFloat(d.lon);
    closeDrawer();
    map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 1.2 });
    setTimeout(() => openNewPlacePopup(lat, lng, d.display_name), 1200);
  });
}

async function doSearch(q, results) {
  if (!q) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="sr-item">搜索中…</div>';
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}&accept-language=zh`);
    const data = await r.json();
    searchData = Array.isArray(data) ? data : [];
    if (!searchData.length) { results.innerHTML = '<div class="sr-item">没有找到结果</div>'; return; }
    results.innerHTML = searchData.map((d, i) => `<div class="sr-item" data-i="${i}">📍 ${esc(d.display_name)}</div>`).join('');
  } catch (e) {
    results.innerHTML = '<div class="sr-item">搜索失败，请重试</div>';
  }
}

function toggleCleanMode() {
  const on = document.body.classList.toggle('clean-mode');
  $('#clean-btn').classList.toggle('on', on);
  if (on) { closeDrawer(); setMode(null); }
}

/* ---------------- 事件委托 ---------------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const placeId = el.closest('[data-place]')?.dataset.place;
  const place = placeId ? S.places.find((p) => p.id === placeId) : null;

  try {
    switch (act) {
      case 'login-open': showLogin('login'); break;
      case 'logout': {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        S.token = ''; S.user = null;
        lsDel('tb_token');
        S.snapshot = '';
        await loadAll();
        break;
      }
      case 'm-submit': submitLogin(); break;

      case 'set-star': {
        const box = el.closest('.stars-input');
        box.dataset.value = el.dataset.v;
        box.querySelectorAll('.star').forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= Number(el.dataset.v)));
        break;
      }
      case 'submit-review': {
        const box = el.closest('[data-place]').querySelector('.stars-input');
        const stars = Number(box.dataset.value || 0);
        const comment = el.closest('[data-place]').querySelector('[data-role="review-text"]').value;
        if (!stars) { toast('请先点星星打分（1-5 星）'); break; }
        await api(`/api/places/${placeId}/reviews`, { method: 'POST', json: { stars, comment } });
        await loadAll();
        openPlacePopup(placeId);
        toast('✓ 评分已提交，感谢分享！');
        break;
      }
      case 'del-review': {
        await api(`/api/places/${placeId}/reviews`, { method: 'DELETE' });
        await loadAll();
        openPlacePopup(placeId);
        break;
      }
      case 'toggle-visited': {
        await api(`/api/places/${placeId}`, { method: 'PATCH', json: { visited: !place.visited } });
        await loadAll();
        openPlacePopup(placeId);
        toast(place.visited ? '✓ 已点亮这个足迹！' : '已改为「想去」');
        break;
      }
      case 'edit-place': openEditPlacePopup(place); break;
      case 'edit-place-cancel': openPlacePopup(placeId); break;
      case 'delete-place': {
        if (!confirm(`确定删除地点「${place.name}」吗？其照片也会一并删除。`)) break;
        await api(`/api/places/${placeId}`, { method: 'DELETE' });
        S.openPlaceId = null;
        await loadAll();
        toast('已删除');
        break;
      }
      case 'create-place': {
        const root = el.closest('.form-pop');
        const name = root.querySelector('[data-role="p-name"]').value.trim();
        if (!name) { toast('请填写地点名称'); break; }
        let cat = root.querySelector('[data-role="p-cat"]').value;
        if (cat === '__custom__') {
          const custom = root.querySelector('[data-role="p-cat-custom"]').value.trim();
          if (!custom) { toast('请填写自定义类型'); break; }
          cat = custom;
        }
        const photoInput = root.querySelector('[data-role="p-photos"]');
        const photoFiles = photoInput && photoInput.files ? photoInput.files : null;
        const shared = root.querySelector('[data-role="p-shared"]').checked;
        const r = await api('/api/places', {
          method: 'POST',
          json: {
            name, category: cat,
            note: root.querySelector('[data-role="p-note"]').value,
            visitedAt: root.querySelector('[data-role="p-time"]').value,
            visited: root.querySelector('[data-role="p-visited"]').checked,
            lat: Number(root.dataset.lat), lng: Number(root.dataset.lng),
          },
        });
        S.openPlaceId = r.place.id;
        await loadAll();
        toast(r.place.visited ? `✓ 已点亮「${r.place.name}」` : `已钉上「${r.place.name}」`);
        const fresh = S.places.find((x) => x.id === r.place.id);
        if (fresh) geocodePlace(fresh); // 后台自动补全国家/城市
        if (photoFiles && photoFiles.length) await uploadFiles(photoFiles, { placeId: r.place.id, shared });
        break;
      }
      case 'edit-place-save': {
        const root = el.closest('[data-place]');
        let cat = root.querySelector('[data-role="p-cat"]').value;
        if (cat === '__custom__') {
          const custom = root.querySelector('[data-role="p-cat-custom"]').value.trim();
          if (!custom) { toast('请填写自定义类型'); break; }
          cat = custom;
        }
        await api(`/api/places/${placeId}`, {
          method: 'PATCH',
          json: {
            name: root.querySelector('[data-role="p-name"]').value,
            category: cat,
            note: root.querySelector('[data-role="p-note"]').value,
            visitedAt: root.querySelector('[data-role="p-time"]').value,
          },
        });
        await loadAll();
        openPlacePopup(placeId);
        break;
      }
      case 'add-to-route': {
        if (!S.builder) S.builder = { name: '', stops: [] };
        S.builder.stops.push({ name: place.name, lat: place.lat, lng: place.lng, placeId: place.id });
        S.viewRouteId = null;
        renderRouteView(); S.tab = 'routes'; syncTabs(); renderPanel();
        toast(`「${place.name}」已加入路线（第 ${S.builder.stops.length} 站）`);
        break;
      }

      case 'place-filter': {
        S.placeFilter = el.dataset.pf || 'all';
        if (S.openPlaceId) openPlacePopup(S.openPlaceId);
        break;
      }
      case 'photo-add': showPhotoAddModal(); break;
      case 'photo-add-submit': {
        const root = $('#modal-root');
        const files = root.querySelector('[data-role="pa-files"]').files;
        if (!files || !files.length) { toast('请选择照片'); break; }
        const title = root.querySelector('[data-role="pa-title"]').value.trim();
        const category = root.querySelector('[data-role="pa-cat"]').value;
        const shared = root.querySelector('[data-role="pa-shared"]').checked;
        const placeId = root.querySelector('[data-role="pa-place"]').value || null;
        $('#modal-root').hidden = true;
        const c = map.getCenter();
        await uploadFiles(files, { placeId, lat: c.lat, lng: c.lng, shared, title, category });
        S.tab = 'photos'; syncTabs(); renderPanel();
        toast('✓ 已添加照片');
        break;
      }
      case 'photo-open': {
        const ph = S.photos.find((x) => x.id === el.dataset.photo);
        if (!ph) break;
        const scope = el.dataset.scope;
        const set = (scope === 'place' && ph.placeId) ? S.photos.filter((x) => x.placeId === ph.placeId) : null;
        openLightbox(ph, { photos: set || null, filter: scope === 'place' ? (S.placeFilter || 'all') : 'all' });
        break;
      }
      case 'review-filter': {
        if (!S.viewer) break;
        S.viewer.reviewFilter = el.dataset.rf === 'mine' || el.dataset.rf === 'others' ? el.dataset.rf : 'all';
        renderViewer();
        break;
      }
      case 'img-filter-all': {
        if (!S.viewer) break;
        S.viewer.imgFilter = 'all';
        S.viewer.index = 0;
        renderViewer();
        break;
      }
      case 'lb-toggle-share': {
        if (!S.lbPhoto) break;
        await api(`/api/photos/${S.lbPhoto.id}`, { method: 'PATCH', json: { shared: !S.lbPhoto.shared } });
        await loadAll();
        renderViewer();
        break;
      }
      case 'lb-delete': {
        if (!S.lbPhoto) break;
        if (!confirm('确定删除这张照片吗？')) break;
        await api(`/api/photos/${S.lbPhoto.id}`, { method: 'DELETE' });
        await loadAll();
        if (visibleViewerPhotos().length) renderViewer();
        else $('#lightbox').hidden = true;
        if (S.openPlaceId) openPlacePopup(S.openPlaceId);
        break;
      }
      case 'lb-rate': {
        const photoId = el.dataset.photo;
        const box = el.closest('#pv-left').querySelector('.stars-input');
        const stars = Number(box.dataset.value || 0);
        if (!stars) { toast('请先点星星评分'); break; }
        const comment = el.closest('#pv-left').querySelector('[data-role="rate-comment"]').value;
        await api(`/api/photos/${photoId}/rate`, { method: 'POST', json: { stars, comment } });
        await loadAll();
        renderViewer();
        toast('✓ 评分已提交');
        break;
      }
      case 'user-open': {
        const uid = el.dataset.user;
        if (!uid) break;
        if (!S.user) { showLogin(); break; }
        if (uid === S.user.id) {
          S.tab = 'stats'; S.statsView = 'overview'; syncTabs(); openDrawer(); renderPanel();
          break;
        }
        S.tab = 'friends'; S.viewingFriend = uid; syncTabs(); openDrawer(); openFriendProfile(uid);
        break;
      }
      case 'friend-open': openFriendProfile(el.dataset.user); break;
      case 'friend-back': S.viewingFriend = null; renderFriendsPanel(); break;
      case 'friends-refresh': renderFriendsPanel(); break;
      case 'friend-add': {
        const input = document.querySelector('[data-role="friend-code-input"]');
        const code = input ? input.value.trim() : '';
        if (!/^[A-Za-z0-9]{3,20}$/.test(code)) { toast('请输入好友代码（数字或字母）'); break; }
        const r = await api('/api/friends/add', { method: 'POST', json: { code } });
        toast(`✓ 已添加好友「${r.friend.name}」`);
        renderFriendsPanel();
        break;
      }
      case 'friend-delete': {
        if (!confirm(`删除好友「${el.dataset.name || ''}」？`)) break;
        await api('/api/friends/' + el.dataset.user, { method: 'DELETE' });
        S.viewingFriend = null;
        toast('已删除好友');
        renderFriendsPanel();
        break;
      }
      case 'copy-code': {
        const code = (S.user && S.user.friendCode) || '';
        if (!code) { toast('好友代码尚未生成'); break; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(() => toast('✓ 好友代码已复制')).catch(() => prompt('好友代码：', code));
        } else { prompt('好友代码：', code); }
        break;
      }
      case 'review-reply': {
        const input = document.querySelector('[data-role="' + el.dataset.input + '"]');
        const text = input ? input.value.trim() : '';
        if (!text) { toast('请先输入留言'); break; }
        await api(`/api/places/${el.dataset.place}/reviews/${el.dataset.user}/reply`, { method: 'POST', json: { text } });
        await openFriendProfile(el.dataset.user);
        toast('✓ 留言已发送');
        break;
      }
      case 'wall-post': {
        const input = document.querySelector('[data-role="wall-input"]');
        const text = input ? input.value.trim() : '';
        if (!text) { toast('请先输入留言'); break; }
        await api(`/api/users/${el.dataset.user}/wall`, { method: 'POST', json: { text } });
        await openFriendProfile(el.dataset.user);
        toast('✓ 留言已发送');
        break;
      }

      case 'record-start': startGpsTrack(); break;
      case 'record-manual': setMode('track'); toast('✏️ 点击地图即可添加轨迹点'); break;
      case 'record-save': saveLiveTrack(); break;
      case 'record-cancel': {
        if (S.trackLive && S.trackLive.points.length >= 2 && !confirm('丢弃当前轨迹？')) break;
        stopLiveLine(); renderPanel(); break;
      }
      case 'track-undo': {
        if (!S.trackLive || !S.trackLive.points.length) { toast('没有可撤回的点'); break; }
        S.trackLive.points.pop();
        S.trackLive.line.setLatLngs(S.trackLive.points.map((p) => [p[0], p[1]]));
        updateLiveStats(); renderPanel();
        break;
      }
      case 'track-clear': {
        if (!S.trackLive) break;
        if (S.trackLive.points.length && !confirm('删除当前轨迹的所有点？')) break;
        S.trackLive.points = [];
        S.trackLive.line.setLatLngs([]);
        updateLiveStats(); renderPanel();
        toast('已删除轨迹点');
        break;
      }
      case 'track-toggle': {
        const id = el.dataset.track;
        S.trackShown[id] = S.trackShown[id] === false ? true : false;
        renderTracks(); renderPanel(); break;
      }
      case 'track-zoom': {
        const t = S.tracks.find((x) => x.id === el.dataset.track);
        if (t) map.fitBounds(L.latLngBounds(t.points.map((p) => [p[0], p[1]])).pad(0.2));
        break;
      }
      case 'track-delete': {
        if (!confirm('删除这条轨迹？')) break;
        await api(`/api/tracks/${el.dataset.track}`, { method: 'DELETE' });
        await loadAll();
        break;
      }

      case 'route-new': {
        S.builder = { name: '', stops: [] };
        setMode('stop');
        renderPanel();
        break;
      }
      case 'route-save': {
        if (!S.builder.stops.length) { toast('至少添加一个途经点'); break; }
        const name = (document.querySelector('[data-role="route-name"]')?.value || '').trim();
        if (!name) { toast('请填写路线名称'); break; }
        const r = await api('/api/routes', { method: 'POST', json: { name, stops: S.builder.stops } });
        S.builder = null;
        S.viewRouteId = r.route.id;
        setMode(null);
        await loadAll();
        toast(`✓ 路线「${r.route.name}」已保存`);
        break;
      }
      case 'route-cancel': {
        S.builder = null;
        setMode(null);
        renderRouteView(); renderPanel();
        break;
      }
      case 'stop-up': case 'stop-down': {
        const i = Number(el.dataset.i);
        const arr = S.builder.stops;
        const j = act === 'stop-up' ? i - 1 : i + 1;
        if (j < 0 || j >= arr.length) break;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        renderRouteView(); renderPanel();
        break;
      }
      case 'stop-del': {
        S.builder.stops.splice(Number(el.dataset.i), 1);
        renderRouteView(); renderPanel();
        break;
      }
      case 'stop-rename': {
        const s = S.builder.stops[Number(el.dataset.i)];
        const v = prompt('站点名称', s.name);
        if (v && v.trim()) { s.name = v.trim(); renderRouteView(); renderPanel(); }
        break;
      }
      case 'route-view': {
        S.viewRouteId = S.viewRouteId === el.dataset.route ? null : el.dataset.route;
        renderRouteView(); renderPanel();
        const r = S.routes.find((x) => x.id === S.viewRouteId);
        if (r) map.fitBounds(L.latLngBounds(r.stops.map((s) => [s.lat, s.lng])).pad(0.25));
        break;
      }
      case 'route-share': shareRoute(el.dataset.route); break;
      case 'route-delete': {
        if (!confirm('删除这条路线？')) break;
        await api(`/api/routes/${el.dataset.route}`, { method: 'DELETE' });
        if (S.viewRouteId === el.dataset.route) S.viewRouteId = null;
        await loadAll();
        break;
      }
      case 'route-edit': {
        const r = S.routes.find((x) => x.id === el.dataset.route);
        if (!r || !S.user) { toast('请先登录'); break; }
        const canEdit = r.ownerId === S.user.id || (r.collaborators || []).includes(S.user.id);
        if (!canEdit) { toast('只有创建者或被共享的好友可以编辑'); break; }
        S.editRouteId = r.id;
        S.editStops = r.stops.map((s) => ({ ...s }));
        S.viewRouteId = r.id;
        renderRouteView(); renderPanel();
        break;
      }
      case 're-up': case 're-down': {
        const i = Number(el.dataset.i);
        const j = act === 're-up' ? i - 1 : i + 1;
        const arr = S.editStops || [];
        if (j < 0 || j >= arr.length) break;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        renderPanel();
        break;
      }
      case 're-del': {
        (S.editStops || []).splice(Number(el.dataset.i), 1);
        renderPanel();
        break;
      }
      case 're-add': {
        const sel = document.querySelector('[data-role="re-add-place"]');
        const p = sel && S.places.find((x) => x.id === sel.value);
        if (!p) { toast('请选择一个地点'); break; }
        if (!S.editStops) S.editStops = [];
        S.editStops.push({ name: p.name, lat: p.lat, lng: p.lng, placeId: p.id });
        renderPanel();
        break;
      }
      case 're-save': {
        if (!S.editRouteId) break;
        if (!(S.editStops || []).length) { toast('至少要有一个途经点'); break; }
        const name = (document.querySelector('[data-role="re-name"]')?.value || '').trim();
        if (!name) { toast('请填写路线名称'); break; }
        await api(`/api/routes/${S.editRouteId}`, { method: 'PATCH', json: { name, stops: S.editStops } });
        S.editRouteId = null;
        S.editStops = null;
        await loadAll();
        toast('✓ 路线已保存');
        break;
      }
      case 're-cancel': {
        S.editRouteId = null;
        S.editStops = null;
        renderPanel();
        break;
      }
      case 'route-collab': showRouteCollabModal(el.dataset.route); break;
      case 'route-hide': {
        const id = el.dataset.route;
        if (!S.hidden.items.includes('route:' + id)) S.hidden.items.push('route:' + id);
        if (S.viewRouteId === id) { S.viewRouteId = null; renderRouteView(); }
        applyHidden();
        toast('🙈 已隐藏这条路线，可在列表底部恢复');
        break;
      }
      case 'route-unhide': {
        S.hidden.items = S.hidden.items.filter((k) => k !== 'route:' + el.dataset.route);
        applyHidden();
        break;
      }
      case 'geo-hide': {
        const key = el.dataset.key;
        if (key && !S.hidden.geo.includes(key)) S.hidden.geo.push(key);
        applyHidden();
        toast('🙈 已隐藏「' + geoLabel(key || '') + '」，可在列表底部恢复');
        break;
      }
      case 'geo-unhide': {
        S.hidden.geo = S.hidden.geo.filter((k) => k !== el.dataset.key);
        applyHidden();
        break;
      }
      case 'unhide-all': {
        S.hidden = { geo: [], items: [] };
        applyHidden();
        toast('已全部显示');
        break;
      }
      case 'modal-close': $('#modal-root').hidden = true; break;

      case 'place-fly': {
        const p = S.places.find((x) => x.id === el.dataset.place);
        if (p) {
          closeDrawer();
          map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), PHOTO_ZOOM + 1));
          setTimeout(() => openPlacePopup(p.id), 600);
        }
        break;
      }
      case 'refresh': S.snapshot = ''; await loadAll(); toast('已刷新'); break;
      case 'stats-lit': S.statsView = 'lit'; renderPanel(); break;
      case 'stats-back': S.statsView = 'overview'; renderPanel(); break;
      case 'share-board': showShareModal(); break;
      case 'share-board-do': { $('#modal-root').hidden = true; await shareBoard(); break; }
      case 'share-track-do': {
        const sel = document.querySelector('[data-role="share-track-sel"]');
        const id = sel && sel.value;
        $('#modal-root').hidden = true;
        if (id) await shareTrack(id);
        break;
      }
      case 'track-share': await shareTrack(el.dataset.track); break;
      case 'share-exit': { location.hash = ''; location.reload(); break; }
    }
  } catch (err) {
    if (err.message !== '请先登录' && err.message !== '请先登录后再评分') toast(err.message);
  }
});

// 上传 / 表单 change 事件
document.addEventListener('change', async (e) => {
  const inp = e.target;
  if (inp.classList && inp.classList.contains('photo-input')) {
    if (!inp.files.length) return;
    const placeId = inp.dataset.place || null;
    const lat = inp.dataset.lat ? Number(inp.dataset.lat) : null;
    const lng = inp.dataset.lng ? Number(inp.dataset.lng) : null;
    await uploadFiles(inp.files, { placeId, lat, lng });
    inp.value = '';
    return;
  }
  if (inp.dataset && inp.dataset.role === 'follow' && S.trackLive) { S.trackLive.follow = inp.checked; return; }
  if (inp.dataset && inp.dataset.role === 'avatar-file') {
    const f = inp.files[0];
    if (f) openAvatarCropper(f);
    inp.value = '';
    return;
  }
  if (inp.dataset && inp.dataset.role === 'track-file') {
    const f = inp.files[0];
    if (f) await importTrackFile(f);
    inp.value = '';
    return;
  }
  if (inp.dataset && inp.dataset.role === 'p-cat') {
    const form = inp.closest('.form-pop');
    const wrap = form && form.querySelector('[data-role="p-cat-custom-wrap"]');
    if (wrap) wrap.hidden = inp.value !== '__custom__';
    return;
  }
  // 地点弹窗里的「共享」：同步到该地点我已上传的所有照片
  if (inp.dataset && inp.dataset.act === 'place-share-toggle') {
    const pid = inp.dataset.place;
    const mine = S.photos.filter((x) => x.placeId === pid && S.user && x.ownerId === S.user.id);
    if (!mine.length) {
      toast(inp.checked ? '之后上传的照片会共享给所有人' : '之后上传的照片仅自己可见');
      return;
    }
    for (const ph of mine) {
      await api('/api/photos/' + ph.id, { method: 'PATCH', json: { shared: inp.checked } });
    }
    await loadAll();
    openPlacePopup(pid);
    toast(inp.checked ? '✓ 该地点的照片已共享' : '已改为仅自己可见');
    return;
  }
  // 路线共享给好友（复选框）
  if (inp.dataset && inp.dataset.act === 'route-collab') {
    const rid = inp.dataset.route, uid = inp.dataset.user;
    if (inp.checked) await api(`/api/routes/${rid}/collaborators`, { method: 'POST', json: { userId: uid } });
    else await api(`/api/routes/${rid}/collaborators/${uid}`, { method: 'DELETE' });
    await loadAll();
    toast(inp.checked ? '✓ 已共享给该好友，TA 可以一起修改' : '已取消共享');
    return;
  }
  if (inp.dataset && inp.dataset.role === 'flt-q') { S.filters.q = inp.value; renderPlacesPanel(); return; }
  if (inp.dataset && inp.dataset.role === 'flt-cat') { S.filters.cat = inp.value; renderPlacesPanel(); return; }
  if (inp.dataset && inp.dataset.role === 'flt-visited') { S.filters.visited = inp.value; renderPlacesPanel(); return; }
});

// tabs / 抽屉 / 头像按钮 / fab
document.querySelector('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.tab = b.dataset.tab;
  syncTabs();
  renderPanel();
  renderTracks();
  // 打开轨迹界面：地图自动定位并高亮所有轨迹
  if (S.tab === 'tracks') {
    const pts = [];
    for (const t of S.tracks) {
      if (S.trackShown[t.id] === false) continue;
      for (const p of t.points) pts.push([p[0], p[1]]);
    }
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.15));
  }
});
$('#add-btn').addEventListener('click', () => setMode(S.mode === 'place' ? null : 'place'));
wireAvatarDrag();
$('#drawer-avatar').addEventListener('click', showAvatarPicker);
$('#drawer-backdrop').addEventListener('click', closeDrawer);
$('#search-btn').addEventListener('click', () => { openDrawer(); setTimeout(() => $('#search-input').focus(), 200); });
$('#friends-btn').addEventListener('click', () => { openDrawer(); S.tab = 'friends'; S.viewingFriend = null; syncTabs(); renderPanel(); });
$('#locate-btn').addEventListener('click', locateMe);
$('#basemap-btn').addEventListener('click', toggleBaseMap);
$('#clean-btn').addEventListener('click', toggleCleanMode);
$('#drawer-settings').addEventListener('click', (e) => {
  const langBtn = e.target.closest('button[data-lang]');
  if (langBtn) { setLang(langBtn.dataset.lang); return; }
  const srcBtn = e.target.closest('button[data-source]');
  if (srcBtn) setMapSource(srcBtn.dataset.source);
});
setupSearch();

$('#lb-close').addEventListener('click', () => { $('#lightbox').hidden = true; });
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lightbox').hidden = true; });
$('#pv-prev').addEventListener('click', () => viewerNav(-1));
$('#pv-next').addEventListener('click', () => viewerNav(1));
$('#pv-arrow-prev').addEventListener('click', () => viewerNav(-1));
$('#pv-arrow-next').addEventListener('click', () => viewerNav(1));
$('#pv-imgfilter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-imgfilter]'); if (!b || !S.viewer) return;
  S.viewer.imgFilter = b.dataset.imgfilter;
  S.viewer.index = 0;
  renderViewer();
});
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').hidden) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); viewerNav(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); viewerNav(1); }
});
$('#modal-root').addEventListener('click', (e) => { if (e.target.id === 'modal-root') $('#modal-root').hidden = true; });

$('#tut-next').addEventListener('click', tutNext);
$('#tut-done').addEventListener('click', finishTutorial);
$('#tut-skip').addEventListener('click', finishTutorial);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#lightbox').hidden) { $('#lightbox').hidden = true; return; }
    if (!$('#tutorial').hidden) { finishTutorial(); return; }
    if (!$('#modal-root').hidden) { $('#modal-root').hidden = true; return; }
    if ($('#drawer').classList.contains('open')) { closeDrawer(); return; }
    setMode(null);
  }
});

// 头像图片加载失败时回退为 emoji
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains('u-avatar')) {
    const span = document.createElement('span');
    span.className = 'u-avatar-emoji';
    span.textContent = t.dataset.fb || '🙂';
    if (t.dataset.act) span.dataset.act = t.dataset.act;
    if (t.dataset.user) span.dataset.user = t.dataset.user;
    t.replaceWith(span);
  }
}, true);

// 定期静默刷新（多人协作时看到伙伴的新内容）
setInterval(async () => {
  if (S.share || document.hidden || !$('#lightbox').hidden || !$('#modal-root').hidden || !$('#tutorial').hidden) return;
  try { await loadAll(); } catch (e) {}
}, 30000);

// iOS Safari 会忽略 user-scalable=no：阻止地图以外的双指缩放，地图本身仍可缩放
document.addEventListener('gesturestart', (e) => {
  const t = e.target;
  if (!(t && t.closest && t.closest('#map'))) e.preventDefault();
}, { passive: false });

/* ---------------- 启动 ---------------- */
function boot() {
  document.body.classList.remove('share-mode');
  api('/api/config').then((c) => { S.publicUrl = c.publicUrl || ''; }).catch(() => {});
  loadAll().then(() => renderAll()).catch((e) => toast(e.message));
}

function init() {
  if (!window.L) {
    document.body.innerHTML = '<div style="padding:40px;color:#f3ead8;font-size:16px">地图组件（Leaflet CDN）加载失败，请检查网络后刷新。</div>';
    return;
  }
  initMap();
  try {
    if (localStorage.getItem('tb_lang') === 'en') {
      S.lang = 'en';
      document.querySelectorAll('#drawer-settings button[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === 'en'));
      renderBaseMap();
    }
  } catch (e) {}
  try {
    const saved = localStorage.getItem('tb_mapsource');
    // Esri 街道图在中国没有高缩放数据（会显示 Map data not yet available），统一迁到 OSM
    if (saved === 'esri') setMapSource('osm', true);
    else if (saved === 'osm') setMapSource('osm', true);
  } catch (e) {}
  const vm = location.hash.match(/^#@([-\d.]+),([-\d.]+),(\d+)z/);
  if (vm) map.setView([parseFloat(vm[1]), parseFloat(vm[2])], parseInt(vm[3], 10));
  const m = location.hash.match(/share=([A-Za-z0-9_-]+)/);
  if (location.hash === '#board') loadBoardShare();
  else if (m) loadShare(m[1]);
  else boot();
}
init();
