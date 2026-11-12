const MAX_BODY = 200 * 1024 * 1024;
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const MEDIA_CHUNK_SIZE = 20 * 1024 * 1024;
const STATIC_FILES = new Set([
  '/index.html',
  '/app.js',
  '/app.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/images/layers.png',
  '/vendor/leaflet/images/layers-2x.png',
  '/vendor/leaflet/images/marker-icon.png',
  '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.bmp': 'image/bmp',
};

const IMG_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/avif': '.avif',
  'image/tiff': '.tif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
};

const IMG_MIME_BY_EXT = Object.fromEntries(
  Object.entries(IMG_EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

let schemaInitialized = false;

function emptyDb() {
  return { users: [], sessions: {}, places: [], photos: [], tracks: [], routes: [] };
}

async function ensureSchema(env) {
  if (schemaInitialized) return;
  await env.DB.batch([
    env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, id)) STRICT',
    ),
    env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, revision INTEGER NOT NULL) STRICT',
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO meta (key, revision) VALUES ('state', 0)",
    ),
  ]);
  schemaInitialized = true;
}

function entityKey(kind, id) {
  return `${kind}\u0000${id}`;
}

function buildEntityMap(db) {
  const map = new Map();
  for (const kind of ['users', 'places', 'photos', 'tracks', 'routes']) {
    const singular = kind.slice(0, -1);
    for (const entity of db[kind]) {
      map.set(entityKey(singular, entity.id), JSON.stringify(entity));
    }
  }
  for (const [token, session] of Object.entries(db.sessions || {})) {
    map.set(entityKey('session', token), JSON.stringify(session));
  }
  return map;
}

async function loadSnapshot(env) {
  const [metaResult, entitiesResult] = await env.DB.batch([
    env.DB.prepare("SELECT revision FROM meta WHERE key = 'state'"),
    env.DB.prepare('SELECT kind, id, data FROM entities'),
  ]);
  const db = emptyDb();
  for (const row of entitiesResult.results || []) {
    let value;
    try {
      value = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (row.kind === 'session') db.sessions[row.id] = value;
    else if (Array.isArray(db[`${row.kind}s`]) && row.kind !== 'user') {
      db[`${row.kind}s`].push(value);
    } else if (row.kind === 'user') {
      db.users.push(value);
    }
  }
  return {
    db,
    entities: buildEntityMap(db),
    revision: Number(metaResult.results?.[0]?.revision || 0),
  };
}

async function commitSnapshot(ctx) {
  const current = buildEntityMap(ctx.db);
  const statements = [];
  for (const [key, data] of current) {
    if (ctx.initialEntities.get(key) !== data) {
      const [kind, id] = key.split('\u0000');
      statements.push(
        ctx.env.DB.prepare(
          'INSERT INTO entities (kind, id, data) VALUES (?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data',
        ).bind(kind, id, data),
      );
    }
  }
  for (const key of ctx.initialEntities.keys()) {
    if (!current.has(key)) {
      const [kind, id] = key.split('\u0000');
      statements.push(
        ctx.env.DB.prepare('DELETE FROM entities WHERE kind = ? AND id = ?').bind(kind, id),
      );
    }
  }
  if (!statements.length) return false;

  for (const upload of ctx.uploads) await putMedia(ctx.env, upload);

  const revisionStatement = ctx.env.DB.prepare(
    "UPDATE meta SET revision = CASE WHEN revision = ? THEN revision + 1 ELSE NULL END WHERE key = 'state'",
  ).bind(ctx.revision);

  try {
    await ctx.env.DB.batch([revisionStatement, ...statements]);
  } catch (error) {
    await Promise.allSettled(
      ctx.uploads.map((upload) => deleteMedia(ctx.env, upload.key, upload.chunks)),
    );
    throw error;
  }

  await Promise.allSettled(
    ctx.deletes.map((item) => deleteMedia(ctx.env, item.key, item.chunks)),
  );
  return true;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomId(bytes = 9) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

const uid = () => randomId(9);
const token24 = () => randomId(24);
const nowIso = () => new Date().toISOString();

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 100000 },
    key,
    256,
  );
  return `pbkdf2$100000$${base64Url(salt)}$${base64Url(new Uint8Array(hash))}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, iterationsText, saltText, hashText] = String(stored).split('$');
  if (algorithm !== 'pbkdf2' || !saltText || !hashText) return false;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromBase64Url(saltText), hash: 'SHA-256', iterations },
      key,
      256,
    ),
  );
  const expected = fromBase64Url(hashText);
  if (derived.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < derived.length; i += 1) mismatch |= derived[i] ^ expected[i];
  return mismatch === 0;
}

function jsonResponse(writer, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  writer.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  writer.end(body);
  return writer;
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function sessionCookie(token, maxAge) {
  return (
    'tb_session=' +
    encodeURIComponent(token) +
    '; Path=/; SameSite=Lax; HttpOnly' +
    (maxAge ? '; Max-Age=' + maxAge : '')
  );
}

function authUser(req, db) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : '';
  let session = token && db.sessions[token];
  if (!session) {
    token = getCookie(req, 'tb_session');
    session = token && db.sessions[token];
  }
  return session ? db.users.find((user) => user.id === session.userId) || null : null;
}

const pubUser = (user) =>
  user
    ? {
        id: user.id,
        name: user.name,
        avatar: user.avatar || '🙂',
        avatarImg: !!user.avatarImg,
        avatarVer: user.avatarVer || 0,
        friendCode: user.friendCode || '',
      }
    : null;

function validAvatar(value) {
  const avatar = String(value || '').trim().slice(0, 16);
  return avatar || '🙂';
}

function validLatLng(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [latitude, longitude];
}

function sanitizeName(value) {
  return (
    String(value || '')
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .slice(0, 120) || 'photo'
  );
}

function extname(value) {
  const match = String(value || '').match(/(\.[A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function decodeHeader(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return value || '';
  }
}

function photoOriginalName(req) {
  const query = new URL(req.url, 'http://x').searchParams;
  return req.headers['x-photo-name']
    ? decodeHeader(req.headers['x-photo-name'])
    : query.get('name') || '';
}

function publicPhoto(photo) {
  const { storageKey, storageChunks, file, ...rest } = photo;
  return rest;
}

async function readBody(req, limit = MAX_BODY) {
  const body = req.bodyBuffer || new Uint8Array();
  if (body.byteLength > limit) throw new Error('文件过大');
  return body;
}

async function readJson(req) {
  const body = await readBody(req, 5 * 1024 * 1024);
  const text = new TextDecoder().decode(body).trim();
  if (!text) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求体格式错误');
  }
  return value;
}

function chunkKey(key, index) {
  return `${key}.part${index}`;
}

async function putMedia(env, upload) {
  for (let index = 0; index < upload.chunks; index += 1) {
    const start = index * MEDIA_CHUNK_SIZE;
    const end = Math.min(start + MEDIA_CHUNK_SIZE, upload.body.byteLength);
    const chunk = upload.body.slice(start, end);
    await env.MEDIA.put(chunkKey(upload.key, index), chunk.buffer, {
      metadata: {
        mime: upload.mime,
        name: upload.meta?.name || '',
        chunk: index,
        chunks: upload.chunks,
      },
    });
  }
}

async function deleteMedia(env, key, chunks = 1) {
  const deletions = [];
  for (let index = 0; index < Math.max(1, chunks); index += 1) {
    deletions.push(env.MEDIA.delete(chunkKey(key, index)));
  }
  await Promise.allSettled(deletions);
}

async function serveObject(writer, env, key, chunks, mime, name, cacheControl) {
  const parts = [];
  for (let index = 0; index < Math.max(1, chunks); index += 1) {
    const part = await env.MEDIA.get(chunkKey(key, index), {
      type: 'arrayBuffer',
      cacheTtl: 3600,
    });
    if (!part) {
      writer.writeHead(404);
      writer.end('Not Found');
      return;
    }
    parts.push(part);
  }
  const body = new Blob(parts);
  const headers = new Headers({
    'Content-Type': mime || 'application/octet-stream',
    'Content-Length': String(body.size),
    'Cache-Control': cacheControl,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name || 'file')}`,
  });
  writer.streamResponse = new Response(body, { status: 200, headers });
}

function stageUpload(ctx, key, body, mime, meta = {}) {
  const chunks = Math.max(1, Math.ceil(body.byteLength / MEDIA_CHUNK_SIZE));
  ctx.uploads.push({ key, body: body.slice(), mime, meta, chunks });
  return chunks;
}

function genFriendCode(db) {
  const used = new Set(db.users.map((user) => user.friendCode).filter(Boolean));
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (used.has(code));
  return code;
}

async function handleApi(req, writer, url, ctx) {
  const { db, env, origin } = ctx;
  const mark = () => {
    ctx.dirty = true;
  };
  const findPlace = (id) => db.places.find((place) => place.id === id);
  const findPhoto = (id) => db.photos.find((photo) => photo.id === id);
  const findTrack = (id) => db.tracks.find((track) => track.id === id);
  const findRoute = (id) => db.routes.find((route) => route.id === id);
  let match;

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return jsonResponse(writer, 200, { publicUrl: origin });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (name.length < 1 || name.length > 24) {
      return jsonResponse(writer, 400, { error: '昵称需为 1-24 个字符' });
    }
    if (password.length < 3) {
      return jsonResponse(writer, 400, { error: '密码至少 3 位' });
    }
    if (db.users.some((user) => user.name === name)) {
      return jsonResponse(writer, 400, { error: '该昵称已被使用' });
    }
    const user = {
      id: uid(),
      name,
      pass: await hashPassword(password),
      avatar: validAvatar(body.avatar),
      seenTutorial: false,
      friendCode: genFriendCode(db),
      friends: [],
      created: nowIso(),
    };
    db.users.push(user);
    const token = token24();
    db.sessions[token] = { userId: user.id, time: nowIso() };
    mark();
    return jsonResponse(
      writer,
      200,
      { token, user: pubUser(user) },
      { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) },
    );
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req);
    const user = db.users.find((item) => item.name === String(body.name || '').trim());
    if (!user || !(await verifyPassword(body.password, user.pass))) {
      return jsonResponse(writer, 401, { error: '昵称或密码错误' });
    }
    const token = token24();
    db.sessions[token] = { userId: user.id, time: nowIso() };
    mark();
    return jsonResponse(
      writer,
      200,
      { token, user: pubUser(user) },
      { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) },
    );
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const header = req.headers.authorization || '';
    let token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) token = getCookie(req, 'tb_session');
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      mark();
    }
    return jsonResponse(
      writer,
      200,
      { ok: true },
      { 'Set-Cookie': sessionCookie('', 0) },
    );
  }

  if (req.method === 'PATCH' && url.pathname === '/api/me') {
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    const body = await readJson(req);
    if (body.avatar !== undefined) {
      user.avatar = validAvatar(body.avatar);
      user.avatarImg = false;
      user.avatarVer = Date.now();
    }
    mark();
    return jsonResponse(writer, 200, { user: pubUser(user) });
  }

  if (req.method === 'POST' && url.pathname === '/api/me/avatar') {
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!mime.startsWith('image/')) {
      return jsonResponse(writer, 400, { error: '请选择图片文件' });
    }
    const ext = IMG_EXT_BY_MIME[mime] || '.jpg';
    let body;
    try {
      body = await readBody(req, 30 * 1024 * 1024);
    } catch {
      return jsonResponse(writer, 400, { error: '图片太大，请选择 30MB 以内的图片' });
    }
    if (!body.length) return jsonResponse(writer, 400, { error: '空文件' });
    const oldKey = user.avatarKey;
    const oldChunks = user.avatarChunks || 1;
    const key = `avatars/${user.id}${ext}`;
    const chunks = stageUpload(ctx, key, body, mime, { name: `avatar-${user.id}` });
    if (oldKey && oldKey !== key) {
      ctx.deletes.push({ key: oldKey, chunks: oldChunks });
    }
    user.avatarImg = true;
    user.avatarExt = ext;
    user.avatarKey = key;
    user.avatarChunks = chunks;
    user.avatarVer = Date.now();
    mark();
    return jsonResponse(writer, 200, { user: pubUser(user) });
  }

  if (req.method === 'POST' && url.pathname === '/api/me/tutorial') {
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    user.seenTutorial = true;
    mark();
    return jsonResponse(writer, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    const me = authUser(req, db);
    if (!me) return jsonResponse(writer, 401, { error: '请先登录' });
    const ids = new Set(me.friends || []);
    const users = db.users
      .filter((user) => ids.has(user.id))
      .map((user) => ({
        id: user.id,
        name: user.name,
        avatar: user.avatar || '🙂',
        avatarImg: !!user.avatarImg,
        avatarVer: user.avatarVer || 0,
        reviewCount: db.places.reduce(
          (total, place) =>
            total + place.reviews.filter((review) => review.userId === user.id).length,
          0,
        ),
        photoCount: db.photos.filter(
          (photo) => photo.ownerId === user.id && photo.shared,
        ).length,
      }));
    return jsonResponse(writer, 200, { users, friendCode: me.friendCode || '' });
  }

  if (req.method === 'POST' && url.pathname === '/api/friends/add') {
    const me = authUser(req, db);
    if (!me) return jsonResponse(writer, 401, { error: '请先登录' });
    const body = await readJson(req);
    const code = String(body.code || '').trim();
    if (!code) return jsonResponse(writer, 400, { error: '请输入好友代码' });
    const target = db.users.find(
      (user) => String(user.friendCode || '').toLowerCase() === code.toLowerCase(),
    );
    if (!target) {
      return jsonResponse(writer, 404, { error: '好友代码不存在，请核对后重试' });
    }
    if (target.id === me.id) {
      return jsonResponse(writer, 400, { error: '不能添加自己为好友' });
    }
    if (!Array.isArray(me.friends)) me.friends = [];
    if (!Array.isArray(target.friends)) target.friends = [];
    if (me.friends.includes(target.id)) {
      return jsonResponse(writer, 400, { error: '你们已经是好友了' });
    }
    me.friends.push(target.id);
    target.friends.push(me.id);
    mark();
    return jsonResponse(writer, 200, { ok: true, friend: pubUser(target) });
  }

  if ((match = url.pathname.match(/^\/api\/friends\/([A-Za-z0-9_-]+)$/)) && req.method === 'DELETE') {
    const me = authUser(req, db);
    if (!me) return jsonResponse(writer, 401, { error: '请先登录' });
    const target = db.users.find((user) => user.id === match[1]);
    if (!target) return jsonResponse(writer, 404, { error: '用户不存在' });
    me.friends = (me.friends || []).filter((id) => id !== target.id);
    target.friends = (target.friends || []).filter((id) => id !== me.id);
    mark();
    return jsonResponse(writer, 200, { ok: true });
  }

  if (
    (match = url.pathname.match(/^\/api\/users\/([A-Za-z0-9_-]+)\/profile$/)) &&
    req.method === 'GET'
  ) {
    const me = authUser(req, db);
    if (!me) return jsonResponse(writer, 401, { error: '请先登录' });
    const user = db.users.find((item) => item.id === match[1]);
    if (!user) return jsonResponse(writer, 404, { error: '用户不存在' });
    const reviews = [];
    for (const place of db.places) {
      for (const review of place.reviews) {
        if (review.userId === user.id) {
          reviews.push({
            placeId: place.id,
            placeName: place.name,
            category: place.category,
            stars: review.stars,
            comment: review.comment,
            time: review.time,
            replies: review.replies || [],
          });
        }
      }
    }
    const photos = db.photos
      .filter((photo) => photo.ownerId === user.id && photo.shared)
      .map(publicPhoto);
    return jsonResponse(writer, 200, {
      user: pubUser(user),
      reviews,
      photos,
      wall: user.wall || [],
    });
  }

  if (
    (match = url.pathname.match(/^\/api\/users\/([A-Za-z0-9_-]+)\/wall$/)) &&
    req.method === 'POST'
  ) {
    const me = authUser(req, db);
    if (!me) return jsonResponse(writer, 401, { error: '请先登录' });
    const user = db.users.find((item) => item.id === match[1]);
    if (!user) return jsonResponse(writer, 404, { error: '用户不存在' });
    const body = await readJson(req);
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) return jsonResponse(writer, 400, { error: '留言不能为空' });
    if (!user.wall) user.wall = [];
    user.wall.push({
      id: uid(),
      fromId: me.id,
      fromName: me.name,
      fromAvatar: me.avatar || '🙂',
      fromAvatarImg: !!me.avatarImg,
      text,
      time: nowIso(),
    });
    mark();
    return jsonResponse(writer, 200, { ok: true });
  }

  if (
    (match = url.pathname.match(/^\/api\/photos\/([^/]+)\/rate$/)) &&
    req.method === 'POST'
  ) {
    const me = authUser(req, db);
    if (!me) return jsonResponse(writer, 401, { error: '请先登录' });
    const photo = findPhoto(match[1]);
    if (!photo) return jsonResponse(writer, 404, { error: '照片不存在' });
    if (!photo.shared && photo.ownerId !== me.id) {
      return jsonResponse(writer, 403, { error: '无权评分这张照片' });
    }
    const body = await readJson(req);
    const stars = Math.round(Number(body.stars));
    if (!(stars >= 1 && stars <= 5)) {
      return jsonResponse(writer, 400, { error: '评分需为 1-5 星' });
    }
    const comment = String(body.comment || '').slice(0, 500);
    if (!photo.ratings) photo.ratings = [];
    const existing = photo.ratings.find((rating) => rating.userId === me.id);
    if (existing) {
      existing.stars = stars;
      existing.comment = comment;
      existing.time = nowIso();
    } else {
      photo.ratings.push({
        userId: me.id,
        userName: me.name,
        userAvatar: me.avatar || '🙂',
        userAvatarImg: !!me.avatarImg,
        stars,
        comment,
        time: nowIso(),
      });
    }
    mark();
    return jsonResponse(writer, 200, { photo: publicPhoto(photo) });
  }

  if (
    (match = url.pathname.match(
      /^\/api\/places\/([^/]+)\/reviews\/([^/]+)\/reply$/,
    )) &&
    req.method === 'POST'
  ) {
    const me = authUser(req, db);
    if (!me) return jsonResponse(writer, 401, { error: '请先登录' });
    const place = findPlace(match[1]);
    if (!place) return jsonResponse(writer, 404, { error: '地点不存在' });
    const review = place.reviews.find((item) => item.userId === match[2]);
    if (!review) return jsonResponse(writer, 404, { error: '评价不存在' });
    const body = await readJson(req);
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) return jsonResponse(writer, 400, { error: '留言不能为空' });
    if (!review.replies) review.replies = [];
    review.replies.push({
      id: uid(),
      fromId: me.id,
      fromName: me.name,
      fromAvatar: me.avatar || '🙂',
      fromAvatarImg: !!me.avatarImg,
      text,
      time: nowIso(),
    });
    mark();
    return jsonResponse(writer, 200, { review });
  }

  if ((match = url.pathname.match(/^\/api\/avatar\/([A-Za-z0-9_-]+)$/)) && req.method === 'GET') {
    const user = db.users.find((item) => item.id === match[1]);
    if (!user || !user.avatarImg) {
      writer.writeHead(404);
      return writer.end('Not Found');
    }
    const key = user.avatarKey || `avatars/${user.id}${user.avatarExt || '.jpg'}`;
    return serveObject(
      writer,
      env,
      key,
      user.avatarChunks || 1,
      IMG_MIME_BY_EXT[user.avatarExt] || 'image/jpeg',
      `avatar-${user.id}`,
      'no-store',
    );
  }

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    const user = authUser(req, db);
    return jsonResponse(writer, 200, {
      user: user
        ? { ...pubUser(user), seenTutorial: !!user.seenTutorial }
        : null,
      places: db.places,
      photos: db.photos
        .filter((photo) => photo.shared || (user && photo.ownerId === user.id))
        .map(publicPhoto),
      tracks: db.tracks,
      routes: db.routes.map((route) => ({ ...route })),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/places') {
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    const body = await readJson(req);
    const latLng = validLatLng(body.lat, body.lng);
    const name = String(body.name || '').trim();
    if (!name) return jsonResponse(writer, 400, { error: '请填写地点名称' });
    if (!latLng) return jsonResponse(writer, 400, { error: '坐标不合法' });
    const place = {
      id: uid(),
      name,
      category: String(body.category || 'other'),
      lat: latLng[0],
      lng: latLng[1],
      visited: !!body.visited,
      visitedAt: String(body.visitedAt || '').slice(0, 40),
      note: String(body.note || '').slice(0, 2000),
      country: String(body.country || '').slice(0, 60),
      city: String(body.city || '').slice(0, 60),
      continent: String(body.continent || '').slice(0, 30),
      createdBy: user.id,
      createdByName: user.name,
      createdByAvatar: user.avatar || '🙂',
      createdByAvatarImg: !!user.avatarImg,
      createdTime: nowIso(),
      reviews: [],
    };
    db.places.push(place);
    mark();
    return jsonResponse(writer, 200, { place });
  }

  if ((match = url.pathname.match(/^\/api\/places\/([^/]+)$/))) {
    const place = findPlace(match[1]);
    if (!place) return jsonResponse(writer, 404, { error: '地点不存在' });
    if (req.method === 'PATCH') {
      const user = authUser(req, db);
      if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
      const body = await readJson(req);
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return jsonResponse(writer, 400, { error: '名称不能为空' });
        place.name = name.slice(0, 100);
      }
      if (body.category !== undefined) place.category = String(body.category);
      if (body.note !== undefined) place.note = String(body.note).slice(0, 2000);
      if (body.country !== undefined) place.country = String(body.country).slice(0, 60);
      if (body.city !== undefined) place.city = String(body.city).slice(0, 60);
      if (body.continent !== undefined) {
        place.continent = String(body.continent).slice(0, 30);
      }
      if (body.visited !== undefined) place.visited = !!body.visited;
      if (body.visitedAt !== undefined) {
        place.visitedAt = String(body.visitedAt).slice(0, 40);
      }
      if (body.lat !== undefined || body.lng !== undefined) {
        const latLng = validLatLng(
          body.lat !== undefined ? body.lat : place.lat,
          body.lng !== undefined ? body.lng : place.lng,
        );
        if (!latLng) return jsonResponse(writer, 400, { error: '坐标不合法' });
        place.lat = latLng[0];
        place.lng = latLng[1];
      }
      mark();
      return jsonResponse(writer, 200, { place });
    }
    if (req.method === 'DELETE') {
      const user = authUser(req, db);
      if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
      if (place.createdBy !== user.id) {
        return jsonResponse(writer, 403, { error: '只有创建者可以删除地点' });
      }
      for (const photo of db.photos.filter((item) => item.placeId === place.id)) {
        if (photo.storageKey) {
          ctx.deletes.push({
            key: photo.storageKey,
            chunks: photo.storageChunks || 1,
          });
        }
      }
      db.photos = db.photos.filter((item) => item.placeId !== place.id);
      db.places = db.places.filter((item) => item.id !== place.id);
      mark();
      return jsonResponse(writer, 200, { ok: true });
    }
  }

  if ((match = url.pathname.match(/^\/api\/places\/([^/]+)\/reviews$/))) {
    const place = findPlace(match[1]);
    if (!place) return jsonResponse(writer, 404, { error: '地点不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录后再评分' });
    if (req.method === 'POST') {
      const body = await readJson(req);
      const stars = Math.round(Number(body.stars));
      if (!(stars >= 1 && stars <= 5)) {
        return jsonResponse(writer, 400, { error: '评分需为 1-5 星' });
      }
      const comment = String(body.comment || '').slice(0, 1000);
      const existing = place.reviews.find((review) => review.userId === user.id);
      if (existing) {
        existing.stars = stars;
        existing.comment = comment;
        existing.userAvatar = user.avatar || '🙂';
        existing.userAvatarImg = !!user.avatarImg;
        existing.time = nowIso();
      } else {
        place.reviews.push({
          userId: user.id,
          userName: user.name,
          userAvatar: user.avatar || '🙂',
          userAvatarImg: !!user.avatarImg,
          stars,
          comment,
          time: nowIso(),
        });
      }
      mark();
      return jsonResponse(writer, 200, { place });
    }
    if (req.method === 'DELETE') {
      place.reviews = place.reviews.filter((review) => review.userId !== user.id);
      mark();
      return jsonResponse(writer, 200, { place });
    }
  }

  if (
    (match = url.pathname.match(/^\/api\/places\/([^/]+)\/photos$/)) &&
    req.method === 'POST'
  ) {
    const place = findPlace(match[1]);
    if (!place) return jsonResponse(writer, 404, { error: '地点不存在' });
    return savePhoto(req, writer, ctx, {
      placeId: place.id,
      lat: place.lat,
      lng: place.lng,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/photos') {
    const latLng = validLatLng(
      url.searchParams.get('lat'),
      url.searchParams.get('lng'),
    );
    if (!latLng) return jsonResponse(writer, 400, { error: '缺少坐标' });
    return savePhoto(req, writer, ctx, { lat: latLng[0], lng: latLng[1] });
  }

  if ((match = url.pathname.match(/^\/api\/photos\/([^/]+)$/))) {
    const photo = findPhoto(match[1]);
    if (!photo) return jsonResponse(writer, 404, { error: '照片不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    if (photo.ownerId !== user.id) {
      return jsonResponse(writer, 403, { error: '只有上传者可以操作这张照片' });
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      if (body.shared !== undefined) photo.shared = !!body.shared;
      if (body.category !== undefined) {
        photo.category = String(body.category).slice(0, 30);
      }
      if (body.name !== undefined) {
        photo.name = sanitizeName(String(body.name)) || photo.name;
      }
      if (body.country !== undefined) photo.country = String(body.country).slice(0, 60);
      if (body.city !== undefined) photo.city = String(body.city).slice(0, 60);
      if (body.continent !== undefined) {
        photo.continent = String(body.continent).slice(0, 30);
      }
      mark();
      return jsonResponse(writer, 200, { photo: publicPhoto(photo) });
    }
    if (req.method === 'DELETE') {
      if (photo.storageKey) {
        ctx.deletes.push({
          key: photo.storageKey,
          chunks: photo.storageChunks || 1,
        });
      }
      db.photos = db.photos.filter((item) => item.id !== photo.id);
      mark();
      return jsonResponse(writer, 200, { ok: true });
    }
  }

  if (
    (match = url.pathname.match(/^\/api\/photos\/([^/]+)\/file$/)) &&
    req.method === 'GET'
  ) {
    const photo = findPhoto(match[1]);
    if (!photo) {
      writer.writeHead(404);
      return writer.end('Not Found');
    }
    if (!photo.shared) {
      const user = authUser(req, db);
      if (!user || user.id !== photo.ownerId) {
        writer.writeHead(403);
        return writer.end('Forbidden');
      }
    }
    const key = photo.storageKey || `photos/${photo.id}${extname(photo.name) || '.jpg'}`;
    return serveObject(
      writer,
      env,
      key,
      photo.storageChunks || 1,
      photo.mime,
      photo.name,
      'public, max-age=31536000, immutable',
    );
  }

  if (req.method === 'POST' && url.pathname === '/api/tracks') {
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    const body = await readJson(req);
    const name =
      String(body.name || '').trim().slice(0, 100) ||
      `轨迹 ${new Date().toLocaleString('zh-CN')}`;
    if (!Array.isArray(body.points) || body.points.length < 2) {
      return jsonResponse(writer, 400, { error: '轨迹点太少' });
    }
    if (body.points.length > 50000) {
      return jsonResponse(writer, 400, { error: '轨迹点过多' });
    }
    const points = body.points
      .map((point) => {
        const latLng = validLatLng(point[0], point[1]);
        return latLng
          ? [
              Math.round(latLng[0] * 1e6) / 1e6,
              Math.round(latLng[1] * 1e6) / 1e6,
              Number(point[2]) || 0,
            ]
          : null;
      })
      .filter(Boolean);
    if (points.length < 2) return jsonResponse(writer, 400, { error: '轨迹点无效' });
    const track = {
      id: uid(),
      name,
      points,
      ownerId: user.id,
      ownerName: user.name,
      ownerAvatar: user.avatar || '🙂',
      ownerAvatarImg: !!user.avatarImg,
      time: nowIso(),
    };
    db.tracks.push(track);
    mark();
    return jsonResponse(writer, 200, { track });
  }

  if (
    (match = url.pathname.match(/^\/api\/tracks\/([^/]+)\/share$/)) &&
    req.method === 'POST'
  ) {
    const track = findTrack(match[1]);
    if (!track) return jsonResponse(writer, 404, { error: '轨迹不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    if (track.ownerId !== user.id) {
      return jsonResponse(writer, 403, { error: '只有录制者可以分享轨迹' });
    }
    if (!track.token) {
      track.token = token24();
      mark();
    }
    return jsonResponse(writer, 200, { token: track.token });
  }

  if (
    (match = url.pathname.match(/^\/api\/tracks\/([^/]+)$/)) &&
    req.method === 'DELETE'
  ) {
    const track = findTrack(match[1]);
    if (!track) return jsonResponse(writer, 404, { error: '轨迹不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    if (track.ownerId !== user.id) {
      return jsonResponse(writer, 403, { error: '只有录制者可以删除轨迹' });
    }
    db.tracks = db.tracks.filter((item) => item.id !== track.id);
    mark();
    return jsonResponse(writer, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/routes') {
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    const body = await readJson(req);
    const name = String(body.name || '').trim().slice(0, 100);
    if (!name) return jsonResponse(writer, 400, { error: '请填写路线名称' });
    if (!Array.isArray(body.stops) || body.stops.length < 1) {
      return jsonResponse(writer, 400, { error: '路线至少要有一个途经点' });
    }
    const stops = body.stops
      .slice(0, 200)
      .map((stop) => {
        const latLng = validLatLng(stop.lat, stop.lng);
        return latLng
          ? {
              name: String(stop.name || '途经点').slice(0, 100),
              lat: latLng[0],
              lng: latLng[1],
              placeId: stop.placeId || null,
            }
          : null;
      })
      .filter(Boolean);
    if (!stops.length) return jsonResponse(writer, 400, { error: '途经点无效' });
    const route = {
      id: uid(),
      name,
      stops,
      ownerId: user.id,
      ownerName: user.name,
      ownerAvatar: user.avatar || '🙂',
      ownerAvatarImg: !!user.avatarImg,
      time: nowIso(),
      token: null,
      collaborators: [],
    };
    db.routes.push(route);
    mark();
    return jsonResponse(writer, 200, { route });
  }

  if ((match = url.pathname.match(/^\/api\/routes\/([^/]+)$/)) && req.method === 'PATCH') {
    const route = findRoute(match[1]);
    if (!route) return jsonResponse(writer, 404, { error: '路线不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    const canEdit =
      route.ownerId === user.id || (route.collaborators || []).includes(user.id);
    if (!canEdit) {
      return jsonResponse(writer, 403, { error: '只有创建者或被共享的好友可以修改路线' });
    }
    const body = await readJson(req);
    if (body.name !== undefined) {
      const name = String(body.name || '').trim().slice(0, 100);
      if (name) route.name = name;
    }
    if (body.stops !== undefined) {
      if (!Array.isArray(body.stops) || !body.stops.length) {
        return jsonResponse(writer, 400, { error: '路线至少要有一个途经点' });
      }
      const stops = body.stops
        .slice(0, 200)
        .map((stop) => {
          const latLng = validLatLng(stop.lat, stop.lng);
          return latLng
            ? {
                name: String(stop.name || '途经点').slice(0, 100),
                lat: latLng[0],
                lng: latLng[1],
                placeId: stop.placeId || null,
              }
            : null;
        })
        .filter(Boolean);
      if (!stops.length) return jsonResponse(writer, 400, { error: '途经点无效' });
      route.stops = stops;
    }
    route.updatedTime = nowIso();
    mark();
    return jsonResponse(writer, 200, { route });
  }

  if (
    (match = url.pathname.match(/^\/api\/routes\/([^/]+)\/collaborators$/)) &&
    req.method === 'POST'
  ) {
    const route = findRoute(match[1]);
    if (!route) return jsonResponse(writer, 404, { error: '路线不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    if (route.ownerId !== user.id) {
      return jsonResponse(writer, 403, { error: '只有创建者可以共享路线' });
    }
    const body = await readJson(req);
    const target = db.users.find((item) => item.id === body.userId);
    if (!target) return jsonResponse(writer, 404, { error: '用户不存在' });
    if (!(user.friends || []).includes(target.id)) {
      return jsonResponse(writer, 400, { error: '只能共享给好友，请先加对方为好友' });
    }
    if (!route.collaborators) route.collaborators = [];
    if (!route.collaborators.includes(target.id)) route.collaborators.push(target.id);
    mark();
    return jsonResponse(writer, 200, {
      ok: true,
      collaborators: route.collaborators,
    });
  }

  if (
    (match = url.pathname.match(/^\/api\/routes\/([^/]+)\/collaborators\/([^/]+)$/)) &&
    req.method === 'DELETE'
  ) {
    const route = findRoute(match[1]);
    if (!route) return jsonResponse(writer, 404, { error: '路线不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    if (route.ownerId !== user.id) {
      return jsonResponse(writer, 403, { error: '只有创建者可以取消共享' });
    }
    route.collaborators = (route.collaborators || []).filter(
      (id) => id !== match[2],
    );
    mark();
    return jsonResponse(writer, 200, { ok: true });
  }

  if ((match = url.pathname.match(/^\/api\/routes\/([^/]+)$/)) && req.method === 'DELETE') {
    const route = findRoute(match[1]);
    if (!route) return jsonResponse(writer, 404, { error: '路线不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    if (route.ownerId !== user.id) {
      return jsonResponse(writer, 403, { error: '只有创建者可以删除路线' });
    }
    db.routes = db.routes.filter((item) => item.id !== route.id);
    mark();
    return jsonResponse(writer, 200, { ok: true });
  }

  if (
    (match = url.pathname.match(/^\/api\/routes\/([^/]+)\/share$/)) &&
    req.method === 'POST'
  ) {
    const route = findRoute(match[1]);
    if (!route) return jsonResponse(writer, 404, { error: '路线不存在' });
    const user = authUser(req, db);
    if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
    if (route.ownerId !== user.id) {
      return jsonResponse(writer, 403, { error: '只有创建者可以分享路线' });
    }
    if (!route.token) {
      route.token = token24();
      mark();
    }
    return jsonResponse(writer, 200, { token: route.token });
  }

  if (req.method === 'GET' && url.pathname === '/api/share-board') {
    const places = db.places.map((place) => {
      const average = place.reviews.length
        ? place.reviews.reduce((total, review) => total + review.stars, 0) /
          place.reviews.length
        : null;
      return {
        name: place.name,
        category: place.category,
        lat: place.lat,
        lng: place.lng,
        visited: !!place.visited,
        avg: average,
        reviewCount: place.reviews.length,
      };
    });
    const photos = db.photos
      .filter((photo) => photo.shared)
      .map((photo) => ({
        id: photo.id,
        name: photo.name,
        lat: photo.lat,
        lng: photo.lng,
        url: `/api/photos/${photo.id}/file`,
      }));
    return jsonResponse(writer, 200, {
      visitedCount: places.filter((place) => place.visited).length,
      photoCount: photos.length,
      places,
      photos,
    });
  }

  if (
    (match = url.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]+)$/)) &&
    req.method === 'GET'
  ) {
    const track = db.tracks.find((item) => item.token === match[1]);
    if (track) {
      return jsonResponse(writer, 200, {
        type: 'track',
        track: {
          name: track.name,
          ownerName: track.ownerName,
          time: track.time,
          pointCount: track.points.length,
          points: track.points,
        },
      });
    }
    const route = db.routes.find((item) => item.token === match[1]);
    if (!route) return jsonResponse(writer, 404, { error: '分享链接无效或已失效' });
    const stops = route.stops.map((stop, index) => {
      const place = stop.placeId ? findPlace(stop.placeId) : null;
      const reviews = place ? place.reviews : [];
      const average = reviews.length
        ? reviews.reduce((total, review) => total + review.stars, 0) /
          reviews.length
        : null;
      const photos = place
        ? db.photos
            .filter((photo) => photo.placeId === place.id && photo.shared)
            .map((photo) => ({
              id: photo.id,
              name: photo.name,
              ownerName: photo.ownerName,
              url: `/api/photos/${photo.id}/file`,
            }))
        : [];
      return {
        index: index + 1,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        place: place
          ? {
              name: place.name,
              category: place.category,
              note: place.note,
              avg: average,
              reviewCount: reviews.length,
              reviews,
            }
          : null,
        photos,
      };
    });
    return jsonResponse(writer, 200, {
      type: 'route',
      route: {
        name: route.name,
        ownerName: route.ownerName,
        time: route.time,
        stopCount: route.stops.length,
      },
      stops,
    });
  }

  return jsonResponse(writer, 404, { error: '接口不存在' });
}

async function savePhoto(req, writer, ctx, { placeId = null, lat, lng }) {
  const { db } = ctx;
  const user = authUser(req, db);
  if (!user) return jsonResponse(writer, 401, { error: '请先登录' });
  const rawName = photoOriginalName(req);
  let mime = String(req.headers['content-type'] || '').split(';')[0].trim();
  let ext = IMG_EXT_BY_MIME[mime];
  if (!ext && rawName && extname(rawName)) {
    ext = extname(rawName);
    if (!MIME[ext]) ext = '.bin';
    if (!mime) mime = MIME[ext] || 'application/octet-stream';
  }
  if (!mime.startsWith('image/')) {
    return jsonResponse(writer, 400, { error: '只支持上传图片文件' });
  }
  if (!ext) ext = '.bin';
  let body;
  try {
    body = await readBody(req);
  } catch {
    return jsonResponse(writer, 400, { error: '文件太大' });
  }
  if (!body.length) return jsonResponse(writer, 400, { error: '空文件' });
  const id = uid();
  const storageKey = `photos/${id}${ext}`;
  const storageChunks = Math.max(
    1,
    Math.ceil(body.byteLength / MEDIA_CHUNK_SIZE),
  );
  const query = new URL(req.url, 'http://x').searchParams;
  const shared = ['1', 'true', 'yes'].includes(
    String(query.get('shared')).toLowerCase(),
  );
  const title =
    sanitizeName(String(query.get('title') || '').trim()) ||
    sanitizeName(rawName || '') ||
    `照片-${new Date().toISOString().slice(0, 10)}`;
  const category = String(query.get('category') || '').trim().slice(0, 30);
  let country = '';
  let city = '';
  let continent = '';
  if (placeId) {
    const place = db.places.find((item) => item.id === placeId);
    if (place) {
      country = place.country || '';
      city = place.city || '';
      continent = place.continent || '';
    }
  }
  const photo = {
    id,
    placeId,
    ownerId: user.id,
    ownerName: user.name,
    ownerAvatar: user.avatar || '🙂',
    ownerAvatarImg: !!user.avatarImg,
    shared,
    name: title,
    category,
    country,
    city,
    continent,
    mime,
    size: body.length,
    time: nowIso(),
    lat,
    lng,
    storageKey,
    storageChunks,
  };
  db.photos.push(photo);
  stageUpload(ctx, storageKey, body, mime, { name: title });
  ctx.dirty = true;
  return jsonResponse(writer, 200, { photo: publicPhoto(photo) });
}

class ResponseWriter {
  constructor() {
    this.status = 200;
    this.headers = {};
    this.body = null;
    this.streamResponse = null;
  }

  writeHead(status, headers = {}) {
    this.status = status;
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  end(body = '') {
    this.body = body;
    return this;
  }

  toResponse() {
    if (this.streamResponse) return this.streamResponse;
    const headers = new Headers(this.headers);
    if (this.body instanceof Uint8Array) {
      return new Response(this.body, { status: this.status, headers });
    }
    return new Response(this.body == null ? '' : String(this.body), {
      status: this.status,
      headers,
    });
  }
}

async function handleApiRequest(request, env) {
  await ensureSchema(env);
  const bodyBuffer = new Uint8Array(await request.arrayBuffer());
  const url = new URL(request.url);
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const snapshot = await loadSnapshot(env);
    const ctx = {
      env,
      db: snapshot.db,
      initialEntities: snapshot.entities,
      revision: snapshot.revision,
      uploads: [],
      deletes: [],
      dirty: false,
      origin: url.origin,
    };
    const writer = new ResponseWriter();
    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
      bodyBuffer,
    };
    try {
      await handleApi(req, writer, url, ctx);
      if (ctx.dirty && writer.status < 400) {
        await commitSnapshot(ctx);
      }
      return writer.toResponse();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!message.includes('NOT NULL constraint failed: meta.revision')) {
        await Promise.allSettled(
          ctx.uploads.map((upload) =>
            deleteMedia(env, upload.key, upload.chunks),
          ),
        );
        console.error('TravelBoard API error', error);
        return jsonResponse(new ResponseWriter(), 500, {
          error: '服务器内部错误：' + message,
        }).toResponse();
      }
    }
  }

  console.error('TravelBoard commit conflict', lastError);
  return jsonResponse(new ResponseWriter(), 409, {
    error: '数据刚刚被其他人更新，请重试一次',
  }).toResponse();
}

async function serveStatic(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (env.ASSETS) return env.ASSETS.fetch(request);

  const url = new URL(request.url);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (pathname === '/') pathname = '/index.html';
  if (!STATIC_FILES.has(pathname)) {
    return new Response('Not Found', { status: 404 });
  }

  const upstream =
    'https://cdn.jsdelivr.net/gh/mingxuan62050728-spec/travel-board@main/public' +
    pathname;
  const cache = caches.default;
  const cacheKey = new Request(upstream, { method: 'GET' });
  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(upstream, {
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: { '200-299': 3600, '404': 60, '500-599': 0 },
      },
    });
    if (response.ok) await cache.put(cacheKey, response.clone());
  }
  if (!response.ok) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  const mime = MIME[extname(pathname)] || 'application/octet-stream';
  headers.set('Content-Type', mime);
  headers.set(
    'Cache-Control',
    pathname === '/index.html' || pathname === '/app.js' || pathname === '/app.css'
      ? 'no-cache'
      : 'public, max-age=3600',
  );
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: 200,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApiRequest(request, env);
    return serveStatic(request, env);
  },
};
