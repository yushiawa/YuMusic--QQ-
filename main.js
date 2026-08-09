const { app, BrowserWindow, WebContentsView, ipcMain, session, net, screen, Tray, Menu, globalShortcut, nativeImage, protocol } = require('electron');

const { qqDecryptLyricContent } = require('./qq-lyric-crypto.js');

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const APP_ICON = path.join(__dirname, 'renderer', 'assets', 'arknights', 'app-icon.png');

// Wallpaper Engine 壁纸协议：需在 app ready 之前注册
try {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'wallpaper', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
  ]);
} catch (err) { /* 忽略 */ }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE = 'https://music.163.com';
const API_HEADERS = { 'User-Agent': UA, Referer: BASE + '/', Accept: 'application/json, text/plain, */*' };

let mainWindow = null;
let loginWindow = null;
let loginTimer = null;
let qqLoginWindow = null;
let qqEmbedView = null;
let qqLoginTimer = null;
let lyricWindow = null;

function createMainWindow(opts) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#07090f',
    icon: APP_ICON,
    title: 'YuMusic · Electron 3D',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  try { mainWindow.webContents.setBackgroundThrottling(false); } catch (err) { /* 忽略 */ }
  const loadOpts = opts && opts.query ? { query: opts.query } : undefined;
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), loadOpts);
  mainWindow.on('closed', () => { closeQqEmbed(); mainWindow = null; });
  mainWindow.on('resize', () => { layoutQqEmbed(); });
}

// ---------- 无边框窗口控制 ----------
function sendMaxState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('window-maximized', mainWindow.isMaximized());
  }
}
ipcMain.handle('win-min', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('win-max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  sendMaxState();
});
ipcMain.handle('win-close', () => { if (mainWindow) mainWindow.close(); });
if (mainWindow) {
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);
}

// ---------- 网络请求（自动带上登录 Cookie） ----------
// 统一网络请求：20s 超时 + 网络层瞬态错误（SSL 握手失败/连接被关闭等）自动重试 2 次
async function nfetch(url, options) {
  const opts = options || {};
  let lastErr = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    let ownCtrl = null;
    try {
      if (!opts.signal) {
        ownCtrl = new AbortController();
        ownCtrl._t = setTimeout(() => ownCtrl.abort(), 20000);
      }
      const res = await net.fetch(url, ownCtrl ? { ...opts, signal: ownCtrl.signal } : opts);
      if (ownCtrl && ownCtrl._t) clearTimeout(ownCtrl._t);
      return res;
    } catch (err) {
      if (ownCtrl && ownCtrl._t) clearTimeout(ownCtrl._t);
      lastErr = err;
      const msg = String((err && err.message) || err);
      const timeoutHit = !!(ownCtrl && ownCtrl.signal.aborted);
      const transient = timeoutHit || /ERR_(CONNECTION|SSL|TLS|TIMED_OUT|INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|EMPTY_RESPONSE|ADDRESS_UNREACHABLE|SOCKS|PROXY_CONNECTION_FAILED|TOO_MANY_REDIRECTS)|handshake failed|Failed to fetch|fetch failed/i.test(msg);
      if (!transient || attempt >= 2) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (lastErr) console.error('[nfetch] ' + url + ' -> ' + ((lastErr && lastErr.message) || lastErr));
  throw lastErr;
}


async function cookieHeader() {
  const cookies = await session.defaultSession.cookies.get({ url: BASE });
  return cookies.filter(c => c.value).map(c => `${c.name}=${c.value}`).join('; ');
}

async function fetchJson(url, signal) {
  const cookie = await cookieHeader();
  const res = await nfetch(url, {
    headers: cookie ? { ...API_HEADERS, Cookie: cookie } : API_HEADERS,
    signal: signal || undefined
  });
  return res.json();
}

// 缩略图：网易云 CDN 支持 param=300y300，下载量从原图 ~2.8MB 降至 ~40KB（QQ 侧已用 T002R300x300M 缩略图）
function neCover(url) {
  if (!url) return '';
  const u = String(url);
  if (u.indexOf('music.126.net') < 0) return u;
  const sep = u.indexOf('?') >= 0 ? '&' : '?';
  return u.replace(/^http:/, 'https:') + sep + 'param=300y300';
}
function mapSong(node) {
  const artists = (node.ar || node.artists || []).map(a => a.name).join(' / ');
  const album = node.al || node.album || {};
  return {
    id: String(node.id),
    name: node.name || '未知歌曲',
    artist: artists || '未知歌手',
    album: album.name || '',
    dt: node.dt || node.duration || 0,
    cover: neCover(album.picUrl || ''),
    pop: node.pop || node.score || 0,
    fee: node.fee || 0
  };
}

async function fetchJsonPost(url, body) {
  const cookie = await cookieHeader();
  const res = await nfetch(url, {
    method: 'POST',
    body: JSON.stringify(body || {}),
    headers: cookie
      ? { ...API_HEADERS, 'Content-Type': 'application/json', Cookie: cookie }
      : { ...API_HEADERS, 'Content-Type': 'application/json' }
  });
  return res.json();
}

// ---------- 我的喜欢：多级回退（先找“我喜欢的音乐”歌单 → like/get 全量 id → 旧账号 uid 兜底） ----------
const likedPlaylistCache = new Map(); // uid -> { id, name, trackCount }
const LIKED_SONGS_TTL = 10 * 60 * 1000; // 「我的喜欢」歌曲详情缓存时长（10 分钟）
const likedSongsCache = new Map(); // uid -> { time, data }
let likedIdSet = new Set(); // 当前登录用户的喜欢歌曲 id 集合（用于收藏状态判断）

async function findLikedPlaylist(uid) {
  try {
    const data = await fetchJson(`${BASE}/api/user/playlist?uid=${encodeURIComponent(uid)}&limit=1000&offset=0`);
    const list = data.playlist || [];
    const liked = list.find((p) => p.specialType === 5 && p.creator && String(p.creator.userId) === String(uid))
      || list.find((p) => p.specialType === 5);
    if (liked) return { id: String(liked.id), name: liked.name || '我的喜欢', trackCount: liked.trackCount || 0 };
  } catch (err) { /* 继续回退 */ }
  return null;
}

async function fetchLikedIds(uid) {
  try {
    const data = await fetchJsonPost(`${BASE}/api/song/like/get`, { uid: Number(uid) });
    if (data.code === 200 && Array.isArray(data.ids)) return data.ids.map(String);
  } catch (err) { /* 继续回退 */ }
  return null;
}

async function fetchSongsByIds(ids) {
  if (!ids || !ids.length) return [];
  const songs = [];
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const c = JSON.stringify(chunk.map((id) => ({ id: Number(id) })));
    try {
      const data = await fetchJson(`${BASE}/api/v3/song/detail?c=${encodeURIComponent(c)}`);
      if (Array.isArray(data.songs)) songs.push(...data.songs);
    } catch (err) { /* 跳过该批 */ }
  }
  return songs.map(mapSong);
}

async function likedSongsFor(uid) {
  if (!uid) return { name: '我的喜欢', songs: [] };
  const remember = (songs) => {
    likedIdSet = new Set(songs.map((s) => String(s.id)));
    return songs;
  };
  // 1) 缓存命中
  const cached = likedPlaylistCache.get(String(uid));
  if (cached) {
    try {
      const data = await fetchJson(`${BASE}/api/v6/playlist/detail?id=${encodeURIComponent(cached.id)}&n=1000&s=8&total=true`);
      const pl = data.playlist || {};
      const songs = remember((pl.tracks || []).map(mapSong));
      return { name: cached.name, songs, trackCount: cached.trackCount, id: cached.id };
    } catch (err) { /* 缓存失效，继续回退 */ }
  }
  // 2) 用户歌单列表中找到“我喜欢的音乐”
  const liked = await findLikedPlaylist(uid);
  if (liked) {
    likedPlaylistCache.set(String(uid), liked);
    try {
      const data = await fetchJson(`${BASE}/api/v6/playlist/detail?id=${encodeURIComponent(liked.id)}&n=1000&s=8&total=true`);
      const pl = data.playlist || {};
      const songs = remember((pl.tracks || []).map(mapSong));
      return { name: liked.name, songs, trackCount: liked.trackCount, id: liked.id };
    } catch (err) { /* 继续回退 */ }
  }
  // 3) like/get 全量喜欢 id → 分批取歌曲详情
  const ids = await fetchLikedIds(uid);
  if (ids && ids.length) {
    const songs = remember(await fetchSongsByIds(ids));
    if (songs.length) return { name: '我的喜欢', songs, trackCount: songs.length, id: '' };
  }
  // 4) 旧账号：uid 即喜欢歌单 id
  try {
    const data = await fetchJson(`${BASE}/api/v6/playlist/detail?id=${encodeURIComponent(uid)}&n=1000&s=8&total=true`);
    const pl = data.playlist || {};
    const songs = remember((pl.tracks || []).map(mapSong));
    if (songs.length || pl.name) return { name: pl.name || '我的喜欢', songs, trackCount: pl.trackCount || songs.length, id: String(uid) };
  } catch (err) { /* 全部失败 */ }
  return { name: '我的喜欢', songs: [], error: '未能获取喜欢歌单，请确认已登录网易云' };
}

ipcMain.handle('search', async (_e, keyword, platform) => {
  if (platform === 'qq') return qqSearchCore(keyword);
  const url = `${BASE}/api/cloudsearch/pc?type=1&limit=30&offset=0&s=${encodeURIComponent(keyword)}`;
  const data = await fetchJson(url);
  const songs = (data.result && data.result.songs) || [];
  return songs.map(mapSong);
});

// ---------- 播放地址解析（eapi 加密，网易云官方 App 同款通道） ----------
const crypto = require('crypto');
const QRCode = require('qrcode');
const EAPI_KEY = Buffer.from('e82ckenh8dichen8', 'utf8');
const EAPI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const URL_CACHE = new Map(); // id -> { url, ts }（网易云直链有时效，缓存 4 分钟）

function eapiEncrypt(url, object) {
  const text = JSON.stringify(object);
  const digest = crypto.createHash('md5').update(`nobody${url}use${text}md5forencrypt`).digest('hex');
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null);
  return Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]).toString('hex').toUpperCase();
}

// ---------- weapi 加密（网易云官方 App 同款通道，用于收藏等需登录态接口） ----------
const WEAPI_AES_KEY = '0CoJUm6Qyw8W8jud';
const WEAPI_IV = '0102030405060708';
const WEAPI_MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const WEAPI_PUB_KEY = '010001';

function weapiAes(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(WEAPI_IV, 'utf8'));
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]).toString('base64');
}
function weapiRsa(secretKey) {
  const buffer = Buffer.concat([Buffer.alloc(128 - secretKey.length), secretKey]);
  const modulus = BigInt('0x' + WEAPI_MODULUS);
  const exponent = BigInt('0x' + WEAPI_PUB_KEY);
  let num = BigInt('0x' + buffer.toString('hex'));
  let result = 1n;
  let base = num % modulus;
  let exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exp >>= 1n;
  }
  return result.toString(16).padStart(256, '0');
}
function weapiEncrypt(object) {
  const text = JSON.stringify(object);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let secretKey = '';
  for (let i = 0; i < 16; i++) secretKey += chars[Math.floor(Math.random() * chars.length)];
  const params = weapiAes(weapiAes(text, WEAPI_AES_KEY), secretKey);
  const encSecKey = weapiRsa(Buffer.from(secretKey.split('').reverse().join(''), 'utf8'));
  return { params, encSecKey };
}

async function eapiResolveUrl(id, level, signal) {
  const cookies = await session.defaultSession.cookies.get({ url: BASE });
  const pick = (n) => (cookies.find(c => c.name === n) || {}).value || '';
  const header = {
    osver: '17,1,2', deviceId: '', appver: '8.10.05', versioncode: '140', mobilename: '',
    buildver: String(Date.now()).substr(0, 10), resolution: '1920x1080', __csrf: pick('__csrf'),
    os: 'android', channel: '', requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`
  };
  const mu = pick('MUSIC_U'); if (mu) header.MUSIC_U = mu;
  const ma = pick('MUSIC_A'); if (ma) header.MUSIC_A = ma;
  const hdrCookie = Object.keys(header).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(header[k])}`).join('; ');
  const params = eapiEncrypt('/api/song/enhance/player/url/v1', {
    ids: `[${id}]`, level, encodeType: 'flac', header
  });
  const res = await nfetch('https://interface.music.163.com/eapi/song/enhance/player/url/v1', {
    method: 'POST',
    signal: signal || undefined,
    headers: {
      'User-Agent': EAPI_UA, Referer: BASE + '/',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: hdrCookie
    },
    body: 'params=' + encodeURIComponent(params)
  });
  const text = await res.text();
  const j = JSON.parse(text);
  if (!j || j.code !== 200 || !Array.isArray(j.data) || !j.data[0]) return null;
  const item = j.data[0];
  if (!item || !item.url) return null;
  const usedLevel = (item.level && QUALITY_ORDER.includes(item.level)) ? item.level : (level || 'exhigh');
  return { url: String(item.url).replace(/^http:/, 'https:'), level: usedLevel };
}
// 网易云老接口播放地址（music.163.com 主域，eapi 域名不可达/超时时的备用通道）
const LEGACY_BR = { hires: 320000, lossless: 320000, exhigh: 320000, higher: 192000, standard: 128000 };
async function legacyResolveUrl(id, level) {
  const br = LEGACY_BR[level] || 320000;
  try {
    const cookie = await cookieHeader();
    const res = await nfetch(BASE + '/api/song/enhance/player/url?id=' + encodeURIComponent(id) + '&ids=[' + encodeURIComponent(id) + ']&br=' + br, {
      headers: cookie ? { ...API_HEADERS, Cookie: cookie } : API_HEADERS,
      signal: AbortSignal.timeout(8000)
    });
    const j = await res.json();
    if (!j || j.code !== 200) return null;
    const item = (Array.isArray(j.data) ? j.data : [])[0];
    if (item && item.url) return { url: String(item.url).replace(/^http:/, 'https:'), level: br >= 320000 ? 'exhigh' : (br >= 192000 ? 'higher' : 'standard') };
    return null;
  } catch (err) { return null; }
}

const QUALITY_ORDER = ['hires', 'lossless', 'exhigh', 'higher', 'standard'];
ipcMain.handle('resolve-url', async (_e, id, level, platform) => {
  if (platform === 'qq') return qqResolveUrlCore(id, level);
  const want = QUALITY_ORDER.includes(level) ? level : 'exhigh';
  const key = String(id) + ':' + want;
  const hit = URL_CACHE.get(key);
  if (hit && Date.now() - hit.ts < 6 * 60 * 1000) return { url: hit.url, level: hit.level };
  let url = null, usedLevel = want;
  try {
    // 1) 优先老接口（music.163.com 主域 173ms 即可返回）：解析快、稳定
    const lr = await legacyResolveUrl(id, want);
    if (lr && lr.url) { url = lr.url; usedLevel = lr.level; }
    // 2) 老接口失败时才试官方 eapi 通道（3s 超时，防止长时间卡住）
    if (!url) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try { const eu = await eapiResolveUrl(id, want, ctrl.signal); if (eu && eu.url) { url = eu.url; usedLevel = eu.level || want; } }
      catch (err) { /* 超时/失败忽略 */ }
      finally { clearTimeout(timer); }
    }
  } catch (err) { /* 接口异常时返回 null，由前端提示 */ }
  if (url) {
    URL_CACHE.set(key, { url, level: usedLevel, ts: Date.now() });
    if (URL_CACHE.size > 90) { const k = URL_CACHE.keys().next().value; URL_CACHE.delete(k); }
    return { url, level: usedLevel };
  }
  return null;
});

const LYRIC_CACHE = new Map(); // id -> { time, data } lyric cache 30min
const LYRIC_TTL = 30 * 60 * 1000;
// 快速歌词：只取普通 LRC（网易云直查 / QQ 一次接口），不等待逐字源，避免“歌已响、词空白”
ipcMain.handle('lyric-fast', async (_e, id, platform, extra) => {
  const song = extra || {};
  if (platform === 'qq') return qqLyricCore(song.songmid || id, song.songid, song);
  const url = BASE + '/api/song/lyric?id=' + id + '&lv=-1&kv=-1&tv=-1&yv=-1';
  const data = await fetchJson(url);
  return {
    lrc: (data.lrc && data.lrc.lyric) || '',
    tlyric: (data.tlyric && data.tlyric.lyric) || '',
    yrc: (data.yrc && data.yrc.lyric) || '',
    src: (data.yrc && data.yrc.lyric) ? 'ncm-yrc' : 'ncm'
  };
});

ipcMain.handle('lyric', async (_e, id, platform, extra) => {
  const song = extra || {};
  if (platform === 'qq') {
    const out = await qqLyricCore(song.songmid || id, song.songid, song);
    // 优先级（词曲对应准确性）：AMLL TTML DB（同 songmid/songid 精确匹配 + 社区修正）> QQ 官方 QRC/LRC
    const amll = await amllLyricForQq(song.songmid || song.songid).catch(() => null);
    if (amll && amll.yrc) {
      out.yrc = amll.yrc;
      out.src = 'amll';
      if (!out.lrc) out.lrc = amll.lrc;
    }
    return out;
  }
  const key = String(id);
  const hit = LYRIC_CACHE.get(key);
  if (hit && Date.now() - hit.time < LYRIC_TTL) return hit.data;
  const url = BASE + '/api/song/lyric?id=' + id + '&lv=-1&kv=-1&tv=-1&yv=-1';
  // 词曲对应准确性优先级：1) AMLL TTML DB（歌曲 ID 精确匹配 + 社区修正时间轴）
  //                         2) AMLL TTML DB（QQ songmid 兜底，社区修正逐字）
  //                         2.5) 网易云官方逐字 YRC（同源，版本绝对一致）
  //                         3) QQ QRC（跨源标题/歌手匹配，逐字但版本可能不一致，仅作逐字兜底）
  //                         4) 网易云官方行级 LRC（无逐字动画）
  const qqP = qqLyricForSong(song).catch(() => null);
  const amllP = amllLyricForNcm(id).catch(() => null);
  const data = await fetchJson(url);
  const out = {
    lrc: (data.lrc && data.lrc.lyric) || '',
    tlyric: (data.tlyric && data.tlyric.lyric) || '',
    yrc: (data.yrc && data.yrc.lyric) || '',
    src: (data.yrc && data.yrc.lyric) ? 'ncm-yrc' : 'ncm'
  };
  try {
    const amll = await amllP;
    if (amll && amll.yrc) {
      out.yrc = amll.yrc;
      out.src = 'amll';
      if (!out.lrc) out.lrc = amll.lrc;
    } else {
      const qq = await qqP;
      let amllQq = null;
      if (qq && qq._songmid) amllQq = await amllLyricForQq(qq._songmid).catch(() => null);
      if (amllQq && amllQq.yrc) {
        out.yrc = amllQq.yrc;
        out.src = 'amll';
        if (qq.tlyric && !out.tlyric) out.tlyric = qq.tlyric;
        if (!out.lrc) out.lrc = amllQq.lrc;
      } else if (!out.yrc && qq && qq.yrc) {
        out.yrc = qq.yrc;
        out.src = qq.src || 'qq-qrc';
        if (qq.tlyric && !out.tlyric) out.tlyric = qq.tlyric;
        if (!out.lrc) out.lrc = qq.lrc;
      }
    }
  } catch (err) { /* 逐字兜底失败可忽略 */ }
  LYRIC_CACHE.set(key, { time: Date.now(), data: out });
  if (!out.src) out.src = out.yrc ? 'ncm-yrc' : 'ncm';
  if (LYRIC_CACHE.size > 200) { const k = LYRIC_CACHE.keys().next().value; LYRIC_CACHE.delete(k); }
  return out;
});

// ================= QQ 音乐：musicu.fcg 社区接口 =================
const QQ_MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_HEADERS = { 'User-Agent': UA, Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' };
let qqGuid = 0;

async function qqCookieHeader() {
  const cookies = await session.defaultSession.cookies.get({ url: 'https://y.qq.com' });
  return cookies.filter(c => c.value).map(c => `${c.name}=${c.value}`).join('; ');
}

async function qqPost(payload) {
  const cookie = await qqCookieHeader();
  const res = await nfetch(QQ_MUSICU, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: cookie ? { ...QQ_HEADERS, 'Content-Type': 'application/json', Cookie: cookie } : { ...QQ_HEADERS, 'Content-Type': 'application/json' }
  });
  return res.json();
}

async function qqUin() {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: 'https://y.qq.com' });
    const pick = (n) => (cookies.find((c) => c.name === n) || {}).value || '';
    const uin = pick('uin') || pick('wxuin');
    return uin && uin !== '0' ? uin : '';
  } catch (err) { return ''; }
}

async function qqNickname(uin) {
  try {
    const qcookies = await session.defaultSession.cookies.get({ url: 'https://y.qq.com' });
    const qpick = (n) => (qcookies.find((c) => c.name === n) || {}).value || '';
    const qtok = qpick('psrf_qqaccess_token');
    const qopenid = qpick('psrf_qqopenid');
    if (qtok && qopenid) {
      const qres = await nfetch(`https://graph.qq.com/user/get_user_info?access_token=${encodeURIComponent(qtok)}&oauth_consumer_key=100497308&openid=${encodeURIComponent(qopenid)}&format=json`, {
        headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' }
      });
      const qj = await qres.json();
      if (qj && qj.ret === 0 && qj.nickname) {
        const qnick = String(qj.nickname).trim();
        if (qnick && !qnick.includes('\uFFFD')) return qnick;
      }
    }
  } catch (err) { /* 忽略 */ }
  try {
    const res = await nfetch(`https://users.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg?uins=${encodeURIComponent(uin)}`, {
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' }
    });
    const text = await res.text();
    const m = text.match(/\(\s*(\{[\s\S]*\})\s*\)/);
    if (m) {
      const j = JSON.parse(m[1]);
      const info = j && j[String(uin)];
      const nick = info && info[6];
      if (nick && !nick.includes('\uFFFD') && nick.trim()) return nick.trim();
    }
  } catch (err) { /* 忽略 */ }
  try {
    const nickWc = (qqLoginWindow && !qqLoginWindow.isDestroyed()) ? qqLoginWindow.webContents : (qqEmbedView && qqEmbedView.webContents ? qqEmbedView.webContents : null);
    if (nickWc) {
      const nick = await nickWc.executeJavaScript(`(() => {
        const sels = ['.mod_user_info .name', '.avatar_header .name', '.js_user_info .name', '.user_info .name', '.u_name', '.header-user-name', '.user_name'];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
        }
        return '';
      })()`);
      if (nick) return nick;
    }
  } catch (err) { /* 忽略 */ }
  return 'QQ用户' + uin;
}


// QQ 会员等级：VipLogin.VipLoginInter / vip_login_base（网页 cookie + qqmusic_key 即可）
let qqVipCache = { ts: 0, data: null };
async function qqVipInfo() {
  const uin = await qqUin();
  if (!uin) return { loggedIn: false, vipLevel: 0, vipLabel: '' };
  if (qqVipCache.data && Date.now() - qqVipCache.ts < 60 * 1000) return qqVipCache.data;
  try {
    const cookies = await session.defaultSession.cookies.get({ url: 'https://y.qq.com' });
    const authst = (cookies.find((c) => c.name === 'qqmusic_key') || {}).value || '';
    const j = await qqPost({
      comm: { ct: 24, cv: 0, uin: Number(uin) || 0, authst },
      req_0: { module: 'VipLogin.VipLoginInter', method: 'vip_login_base', param: {} }
    });
    const d = (j && j.req_0 && j.req_0.data) || {};
    const iden = d.identity || {};
    const svip = d.svip || iden.HugeVip || 0;
    const vip = d.vip || 0;
    const vipLevel = svip ? 2 : (vip ? 1 : 0);
    const out = {
      loggedIn: true,
      vipLevel,
      vipLabel: vipLevel === 2 ? '豪华绿钻' : (vipLevel === 1 ? '绿钻' : ''),
      overdate: d.overdate || '',
      icon: iden.icon || d.icon || '',
      level: iden.level || 0
    };
    qqVipCache = { ts: Date.now(), data: out };
    return out;
  } catch (err) { return { loggedIn: true, vipLevel: 0, vipLabel: '' }; }
}

async function qqLoginState() {
  try {
    const uin = await qqUin();
    if (!uin) return { loggedIn: false, platform: 'qq', nickname: '', userId: 0, avatar: '', vipType: 0, vipLevel: 0, vipLabel: '', vipOverdate: '', vipIcon: '' };
    const nick = await qqNickname(uin);
    const vip = await qqVipInfo().catch(() => ({ vipLevel: 0, vipLabel: '' }));
    return {
      loggedIn: true, platform: 'qq',
      nickname: nick, userId: String(uin),
      avatar: `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100`,
      vipType: vip.vipLevel === 2 ? 21 : (vip.vipLevel === 1 ? 11 : 0),
      vipLevel: vip.vipLevel || 0,
      vipLabel: vip.vipLabel || '',
      vipOverdate: vip.overdate || '',
      vipIcon: vip.icon || ''
    };
  } catch (err) { return { loggedIn: false, platform: 'qq', nickname: '', userId: 0, avatar: '', vipType: 0, vipLevel: 0, vipLabel: '', vipOverdate: '', vipIcon: '' }; }
}

ipcMain.handle('qq-login-state', async () => qqLoginState());

ipcMain.handle('qq-open-login', async () => {
  if (qqLoginWindow) { qqLoginWindow.focus(); return 'already-open'; }
  qqLoginWindow = new BrowserWindow({
    width: 1000, height: 760,
    icon: APP_ICON,
    title: 'QQ 音乐 · 网页登录',
    parent: mainWindow, modal: true, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  qqLoginWindow.loadURL('https://y.qq.com/');
  qqLoginWindow.webContents.on('did-finish-load', () => {
    let tries = 0;
    const tryClickLogin = () => {
      if (!qqLoginWindow || qqLoginWindow.isDestroyed()) return;
      qqLoginWindow.webContents.executeJavaScript(`(function () {
        var el = document.querySelector('.top_login__link');
        if (!el) return false;
        el.click();
        return true;
      })()`).then((ok) => {
        if (!ok && ++tries < 12) setTimeout(tryClickLogin, 800);
      }).catch(() => {
        if (++tries < 12) setTimeout(tryClickLogin, 800);
      });
    };
    tryClickLogin();
  });
  let qqLoadRetries = 0;
  qqLoginWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (isMainFrame && qqLoadRetries < 3 && qqLoginWindow && !qqLoginWindow.isDestroyed()) {
      qqLoadRetries++;
      setTimeout(() => { if (qqLoginWindow && !qqLoginWindow.isDestroyed()) qqLoginWindow.loadURL('https://y.qq.com/'); }, 1500);
    }
  });
  startQqPolling();
  qqLoginWindow.on('closed', () => {
    qqLoginWindow = null;
    if (qqLoginTimer) { clearInterval(qqLoginTimer); qqLoginTimer = null; }
  });
  return 'opened';
});

ipcMain.handle('qq-logout', async () => {
  const cookies = await session.defaultSession.cookies.get({ url: 'https://y.qq.com' });
  for (const c of cookies) {
    try { await session.defaultSession.cookies.remove('https://y.qq.com', c.name); } catch (err) { /* 忽略 */ }
  }
  return true;
});

function mapQqSong(s) {
  const mid = s.songmid || s.mid;
  const albumMid = s.albummid || ((s.album || {}).mid) || '';
  const pay = s.pay || {};
  return {
    platform: 'qq',
    id: mid,
    songmid: mid,
    songid: Number(s.songid || s.id || 0) || 0,
    name: s.songname || s.name || '未知歌曲',
    artist: (s.singer || []).map((a) => a.name).filter(Boolean).join(' / ') || '未知歌手',
    album: s.albumname || ((s.album || {}).name) || '',
    dt: (s.interval || 0) * 1000,
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '',
    pop: Number(s.score || s.pop || 0),
    vip: !!(pay.pay_play || pay.payplay),
    fee: (pay.pay_play || pay.payplay) ? 1 : 0
  };
}

async function qqSearchCore(keyword) {
  const res = await nfetch(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=30&w=${encodeURIComponent(String(keyword || ''))}&format=json&cr=1`, {
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' }
  });
  const text = await res.text();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  const j = JSON.parse(m[0]);
  const list = (((j.data || {}).song || {}).list) || [];
  return list.map(mapQqSong);
}

const QQ_URL_CACHE = new Map();
async function qqResolveUrlCore(songmid, level) {
  if (!songmid) return null;
  const key = String(songmid) + ':' + (level || 'standard');
  const hit = QQ_URL_CACHE.get(key);
  if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return { url: hit.url, level: hit.level };
  try {
    if (!qqGuid) qqGuid = Math.floor(100000000 + Math.random() * 900000000);
    const uin = await qqUin();
    const data = await qqPost({
      comm: { ct: 24, cv: 0, uin: uin || '0', guid: String(qqGuid) },
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: { guid: String(qqGuid), songmid: [String(songmid)], songtype: [0], uin: String(uin || '0'), loginflag: 1, platform: '20' }
      }
    });
    const list = ((data.req_0 || {}).data || {}).midurlinfo || [];
    const one = list.find((i) => i.songmid === String(songmid)) || list[0];
    if (one && one.purl) {
      const url = 'https://dl.stream.qqmusic.qq.com/' + one.purl;
      QQ_URL_CACHE.set(key, { url, level: level || 'standard', ts: Date.now() });
      if (QQ_URL_CACHE.size > 90) { const k = QQ_URL_CACHE.keys().next().value; QQ_URL_CACHE.delete(k); }
      return { url, level: level || 'standard' };
    }
    // 会员/版权限制：区分提示，避免误报“网络失败”
    if (one && (one.result === 104003 || one.pneedbuy || one.isbuy || one.needpay)) {
      return { error: 'vip', vip: true, level: level || 'standard' };
    }
  } catch (err) { /* 接口异常 */ }
  return null;
}
ipcMain.handle('qq-resolve-url', async (_e, songmid, level) => qqResolveUrlCore(songmid, level));

const QQ_LYRIC_CACHE = new Map();
const QQ_LYRIC_SEARCH = new Map();
function qqDecodeLyric(s) {
  if (!s) return '';
  try { return Buffer.from(String(s), 'base64').toString('utf8').replace(/^\uFEFF/, ''); } catch (err) { return ''; }
}
// QQ 音乐逐字歌词：musicu.fcg GetPlayLyricInfo（需登录 Cookie 才返回 qrc 字段）
function qqExtractQrcContent(decrypted) {
  if (!decrypted) return '';
  // QQ 加密歌词是 XML 包裹，逐字内容在 LyricContent 属性中（可能有多个语种条目）
  const parts = [];
  const re = /LyricContent\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(decrypted))) parts.push(m[1]);
  let out = parts.length ? parts.join('\n') : decrypted;
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // XML 实体还原
  return out.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// QRC（[startMs,durMs] 行 + (start,dur) 词）转普通 LRC，供旧渲染路径兜底
function qrcToLrc(qrcText) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return String(qrcText || '').split(/\r?\n/).map((line) => {
    const m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) return line;
    const startMs = parseInt(m[1], 10) || 0;
    const body = m[3].replace(/\(\d+,\d+(?:,\d+)?\)/g, '');
    const mm = Math.floor(startMs / 60000);
    const ss = Math.floor((startMs % 60000) / 1000);
    const xx = startMs % 1000;
    return '[' + pad2(mm) + ':' + pad2(ss) + '.' + String(xx).padStart(3, '0') + ']' + body;
  }).join('\n');
}

// QQ 逐字歌词：musicu.fcg GetPlayLyricInfo（qrc=1 免登录也返回加密逐字歌词，3DES+deflate 解密）
async function qqLyricCore(songmid, songid, songInfo) {
  if (!songmid) return { lrc: '', tlyric: '', yrc: '', qrc: '', src: 'none' };
  const key = String(songmid) + ':' + String(songid || '');
  const hit = QQ_LYRIC_CACHE.get(key);
  if (hit && Date.now() - hit.time < 30 * 60 * 1000) return hit.data;
  const out = { lrc: '', tlyric: '', yrc: '', qrc: '', src: 'qq-lrc' };
  try {
    const info = songInfo || {};
    const b64 = (str) => Buffer.from(String(str || ''), 'utf8').toString('base64');
    const param = {
      songMID: String(songmid),
      crypt: 1, ct: 19, cv: 2111,
      lrc_t: 0, qrc: 1, qrc_t: 0, roma: 1, roma_t: 0,
      trans: 1, trans_t: 0, type: 0,
      songName: b64(info.name || ''),
      singerName: b64(info.artist || ''),
      albumName: b64(info.album || ''),
      interval: Math.floor((info.dt || 0) / 1000) || 0
    };
    if (songid) param.songID = Number(songid);
    const data = await qqPost({
      comm: { ct: 24, cv: 0 },
      lyric: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param }
    });
    const d = data && data.lyric && data.lyric.data;

    const lyricRaw = qqExtractQrcContent(qqDecryptLyricContent(d && d.lyric));

    const transRaw = qqExtractQrcContent(qqDecryptLyricContent(d && d.trans));
    if (lyricRaw) {
      out.yrc = lyricRaw;                 // QRC 逐字（含 [start,dur] 行级 + (s,d) 词级）
      out.src = /\(\d+,\d+(?:,\d+)?\)/.test(lyricRaw) ? 'qq-qrc' : 'qq-lrc'; // 含词级时间戳才算逐字 QRC
      out.lrc = qrcToLrc(lyricRaw);       // 同源普通 LRC（行时间一致，逐字缺失时兜底）
    }
    if (transRaw) out.tlyric = qrcToLrc(transRaw);
  } catch (err) { /* 接口异常走旧接口 */ }
  if (!out.lrc) {
    // 旧接口兜底：普通 LRC（部分冷门歌未加密返回）
    try {
      const res = await nfetch('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' + encodeURIComponent(songmid) + '&format=json&nobase64=1', {
        headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' }
      });
      const text = await res.text();
      const mm = text.match(/\{[\s\S]*\}/);
      if (mm) {
        let j = null; try { j = JSON.parse(mm[0]); } catch (err) { j = null; }
        if (j && j.lyric) out.lrc = String(j.lyric);
        if (!out.yrc && j && j.yrc) { out.yrc = String(j.yrc); out.src = /\(\d+,\d+(?:,\d+)?\)/.test(String(j.yrc)) ? 'qq-qrc' : 'qq-lrc'; }
      }
    } catch (err) { /* 忽略 */ }
  }
  QQ_LYRIC_CACHE.set(key, { time: Date.now(), data: out });
  if (QQ_LYRIC_CACHE.size > 300) { const k = QQ_LYRIC_CACHE.keys().next().value; QQ_LYRIC_CACHE.delete(k); }
  return out;
}

// 网易云歌曲 → 用歌名/歌手搜到 QQ 曲目，再取 QQ 逐字歌词兜底
// 网易云歌曲 → 用歌名+歌手搜到 QQ 曲目，再取 QQ 逐字歌词（QRC，免登录）
function qqTitleNorm(t) {
  // 归一化歌名：去掉空白与常见装饰符（含半/全角括号、中英文标点、·、~、& 等），
  // 避免“一点(2026)”与“一点 (2026)”这种仅空格/括号差异导致版本匹配失败
  return String(t || '')
    .replace(/[()（）【】\[\]s，,。.!！?？、\-·~～&＆:：;；]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}
function qqPickBestSong(list, song) {
  const t1 = qqTitleNorm(song.name);
  const a1 = String(song.artist || '').toLowerCase();
  const songDt = Number(song.dt) || 0;
  let best = null, bestScore = -1;
  for (const s2 of list || []) {
    const t2 = qqTitleNorm(s2.name);
    const a2 = String(s2.artist || '').toLowerCase();
    let score = 0;
    if (t1 && t2) {
      if (t1 === t2) score += 4;
      else if (t2.includes(t1) || t1.includes(t2)) score += 2;
    }
    if (a1 && a2) {
      const ap = a1.split('/').map((x) => x.trim());
      const bp = a2.split('/').map((x) => x.trim());
      if (ap.some((x) => bp.includes(x))) score += 3;
      else if (ap.some((x) => bp.some((y) => y.includes(x) || x.includes(y)))) score += 1;
    }
    // 时长一致性：不同版本/合唱/DJ 混音时长差异大，明显不是同一版，降权避免选错版本
    const s2Dt = Number(s2.dt) || 0;
    if (songDt > 0 && s2Dt > 0) {
      const diffRatio = Math.abs(s2Dt - songDt) / songDt;
      if (diffRatio > 0.12) score -= 5;
      else if (diffRatio > 0.06) score -= 2;
    }
    if (score > bestScore) { bestScore = score; best = s2; }
  }
  // 要求至少“标题部分匹配 + 歌手匹配”（≥5 分），否则放弃逐字兜底，避免拿不相关歌曲的逐字当成本歌
  return bestScore >= 5 ? best : null;
}
async function qqLyricForSong(song) {
  if (!song) return null;
  let mid = song.songmid;
  let sid = song.songid;
  if (!mid) {
    const kw = (String(song.name || '') + ' ' + String(song.artist || '')).trim();
    if (!kw) return null;
    const ck = 'kw:' + kw;
    let hit = QQ_LYRIC_SEARCH.get(ck);
    if (!hit || Date.now() - hit.time > 10 * 60 * 1000) {
      let list = [];
      try { list = await qqSearchCore(kw); } catch (err) { list = []; }
      const found = qqPickBestSong(list, song);
      hit = { time: Date.now(), song: found };
      QQ_LYRIC_SEARCH.set(ck, hit);
      if (QQ_LYRIC_SEARCH.size > 300) { const k = QQ_LYRIC_SEARCH.keys().next().value; QQ_LYRIC_SEARCH.delete(k); }
    }
    if (!hit.song) return null;
    mid = hit.song.songmid;
    sid = hit.song.songid;
  }
  const out = await qqLyricCore(mid, sid, song);
  if (out && typeof out === 'object' && mid) out._songmid = mid;
  return out;
}
ipcMain.handle('qq-lyric', async (_e, songmid, songid) => qqLyricCore(songmid, songid));
ipcMain.handle('qq-search', async (_e, kw) => qqSearchCore(kw));

// ================= AMLL TTML DB（免登录逐字歌词） =================
// 官方域名托管在 Cloudflare（部分网络直连失败），失败时回退 jsdelivr CDN 镜像 GitHub 仓库（国内可达）
const AMLL_OFFICIAL = 'https://amll-ttml-db.stevexmh.net';
const AMLL_MIRRORS = [
  'https://gcore.jsdelivr.net/gh/steve-xmh/amll-ttml-db@main',
  'https://cdn.jsdelivr.net/gh/steve-xmh/amll-ttml-db@main',
  'https://fastly.jsdelivr.net/gh/steve-xmh/amll-ttml-db@main',
  'https://ghfast.top/https://raw.githubusercontent.com/steve-xmh/amll-ttml-db/main'
];
const AMLL_CACHE = new Map();

function ttmlTimeToMs(t) {
  const str = String(t || '').trim();
  if (!str) return 0;
  let m = str.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (m) return parseFloat(m[1]) || 0;
  m = str.match(/^(\d+(?:\.\d+)?)s$/i);
  if (m) return (parseFloat(m[1]) || 0) * 1000;
  m = str.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (m) return (+m[1]) * 60000 + (+m[2]) * 1000 + Math.round(+(String(m[3] || '0').padEnd(3, '0')));
  m = str.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (m) return (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + Math.round(+(String(m[4] || '0').padEnd(3, '0')));
  return 0;
}

function ttmlDecodeEntities(t) {
  return String(t || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// AMLL TTML → QRC/YRC 格式字符串（行级 [startMs,durMs] + 词级 (startMs,durMs)），复用渲染端 parseYrc
function ttmlToQrc(ttmlText) {
  if (!ttmlText || !/<tt[\s>]/i.test(ttmlText)) return '';
  const out = [];
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRe.exec(ttmlText))) {
    const attrs = pm[1] || '';
    const inner = pm[2] || '';
    const bm = attrs.match(/begin\s*=\s*"([^"]*)"/i);
    const em = attrs.match(/end\s*=\s*"([^"]*)"/i);
    const start = bm ? ttmlTimeToMs(bm[1]) : 0;
    const pend = em ? ttmlTimeToMs(em[1]) : 0;
    const dur = Math.max(0, pend - start);
    const words = [];
    const wRe = /<span\b([^>]*)>([^<]*)<\/span>/g;
    let wm;
    while ((wm = wRe.exec(inner))) {
      const wattrs = wm[1] || '';
      if (/\b(?:x-roman|roman)\b/i.test(wattrs)) continue; // 跳过罗马音
      const wb = wattrs.match(/begin\s*=\s*"([^"]*)"/i);
      const we = wattrs.match(/end\s*=\s*"([^"]*)"/i);
      const wstart = wb ? ttmlTimeToMs(wb[1]) : start;
      const wend = we ? ttmlTimeToMs(we[1]) : 0;
      const ch = ttmlDecodeEntities(wm[2]).trim();
      if (!ch) continue;
      const wdur = Math.max(1, wend > wstart ? wend - wstart : 1);
      words.push({ ch: ch, start: wstart, dur: wdur });
    }
    if (!words.length) continue;
    const text = words.map((w) => w.ch).join('');
    if (!text) continue;
    out.push('[' + Math.round(start) + ',' + Math.round(dur) + ']' + words.map((w) => '(' + Math.round(w.start) + ',' + Math.round(w.dur) + ')' + w.ch).join(''));
  }
  return out.join('\n');
}

function amllFetchOne(url, timeoutMs) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeoutMs);
    net.fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' } })
      .then((res) => {
        clearTimeout(tm);
        if (res.status === 404) return resolve({ miss: true });
        if (!res.ok) return resolve({ fail: true });
        return res.text().then((txt) => resolve({ ttml: txt && /<tt[\s>]/i.test(txt) ? txt : '' }));
      })
      .catch((err) => { clearTimeout(tm); resolve({ fail: true }); });
  });
}

// AMLL 所有源镜像同一仓库：命中(200+TTML)即返回；任一源 404 即判定未收录（留 600ms 宽限防镜像滞后误判）
async function amllTtml(platform, id) {
  if (!id) return '';
  const key = String(platform) + ':' + String(id);
  const hit = AMLL_CACHE.get(key);
  if (hit && Date.now() - hit.time < (hit.data ? 30 * 60 * 1000 : 5 * 60 * 1000)) return hit.data;
  const officialPath = platform === 'qq' ? '/qq/' + id + '?format=ttml' : '/ncm/' + id + '?format=ttml';
  const mirrorPath = platform === 'qq' ? '/qq-lyrics/' + id + '.ttml' : '/ncm-lyrics/' + id + '.ttml';
  const urls = [AMLL_OFFICIAL + officialPath].concat(AMLL_MIRRORS.map((m) => m + mirrorPath));
  const ttml = await new Promise((resolve) => {
    let pending = urls.length;
    let done = false;
    let missTimer = null;
    const finish = (v) => { if (!done) { done = true; if (missTimer) clearTimeout(missTimer); resolve(v); } };
    for (const u of urls) {
      amllFetchOne(u, 3500).then((r) => {
        if (done) return;
        if (r.ttml) { finish(r.ttml); return; }
        if (r.miss) {
          if (!missTimer) missTimer = setTimeout(() => finish(''), 600);
          return;
        }
        if (--pending === 0) finish('');
      });
    }
  });
  AMLL_CACHE.set(key, { time: Date.now(), data: ttml });
  if (AMLL_CACHE.size > 300) { const k = AMLL_CACHE.keys().next().value; AMLL_CACHE.delete(k); }
  return ttml;
}

async function amllLyricForNcm(id) {
  const ttml = await amllTtml('ncm', id);
  if (!ttml) return null;
  const yrc = ttmlToQrc(ttml);
  if (!yrc) return null;
  return { yrc: yrc, lrc: qrcToLrc(yrc) };
}

async function amllLyricForQq(songid) {
  const ttml = await amllTtml('qq', songid);
  if (!ttml) return null;
  const yrc = ttmlToQrc(ttml);
  if (!yrc) return null;
  return { yrc: yrc, lrc: qrcToLrc(yrc) };
}

function qqGtk(skey) {
  let gtk = 5381;
  for (let i = 0; i < String(skey || '').length; i++) gtk += (gtk << 5) + String(skey).charCodeAt(i);
  return gtk & 0x7fffffff;
}

async function qqCookieMap() {
  const ck = await session.defaultSession.cookies.get({ url: 'https://y.qq.com' });
  const m = {};
  for (const c of ck) m[c.name] = c.value;
  return m;
}

async function qqLikedDiag(uin) {
  const cm = await qqCookieMap();
  const skey = cm.skey || cm.p_skey || cm.qqmusic_key || '';
  const gtk = qqGtk(skey);
  const out = { skeyPresent: !!cm.skey, pskeyPresent: !!cm.p_skey, qqmusicKeyPresent: !!cm.qqmusic_key, gtk };
  const cookieStr = Object.entries(cm).map(([k, v]) => k + '=' + v).join('; ');
  const tryUrl = async (label, url, rawToo, withCookie) => {
    try {
      const hdrs = { ...QQ_HEADERS };
      if (withCookie) hdrs.Cookie = cookieStr;
      const res = await nfetch(url, { headers: hdrs });
      const text = await res.text();
      let j = null; try { j = JSON.parse(text); } catch (err) { /* non-json */ }
      const list = j && Array.isArray(j.songlist) ? j.songlist : [];
      const cdlist = j && Array.isArray(j.cdlist) ? j.cdlist : [];
      out[label] = { code: j && j.code, login: j && j.login, n: list.length, cdlen: cdlist.length, first: list[0] ? list[0].name : '', raw: rawToo ? text.slice(0, 260) : '' };
    } catch (err) { out[label] = { err: String(err && err.message || err) }; }
  };
  const base = `https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=1&new_format=1&disstid=201${uin}&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;
  await tryUrl('v_anon', base + `&g_tk=5381&loginUin=0&hostUin=0`);
  await tryUrl('v_logged', base + `&g_tk=${gtk}&loginUin=${uin}&hostUin=${uin}`);
  await tryUrl('v_logged_5381', base + `&g_tk=5381&loginUin=${uin}&hostUin=${uin}`);
  await tryUrl('v_raw', base + `&g_tk=${gtk}&loginUin=${uin}&hostUin=${uin}`, true, false);
  await tryUrl('v_raw_ck', base + `&g_tk=${gtk}&loginUin=${uin}&hostUin=${uin}`, true, true);
  await tryUrl('v_anon_ck', base + `&g_tk=5381&loginUin=0&hostUin=0`, true, true);
  // uniform_get_Dissinfo via musicu
  try {
    const guid = Math.floor(100000000 + Math.random() * 900000000);
    const p2 = {
      comm: { ct: 24, cv: 0, uin: uin, guid: String(guid), authst: cm.qqmusic_key || '' },
      req_0: { module: 'music.srfDissInfo.aiDissInfo', method: 'uniform_get_Dissinfo', param: { disstid: String('201' + uin), enc_host_uin: uin, tag: 1, userinfo: 1, userlabel: 1 } }
    };
    const res2 = await qqPost(p2);
    const d2 = (res2.req_0 || {}).data || {};
    const l2 = Array.isArray(d2.songlist) ? d2.songlist : [];
    out['dissinfo'] = { code: (res2.req_0 || {}).code, n: l2.length, first: l2[0] ? l2[0].name : '', keys: Object.keys(d2).slice(0, 8) };
  } catch (err) { out['dissinfo'] = { err: String(err && err.message || err) }; }
  // user playlist list
  try {
    const cookieStr = Object.entries(cm).map(([k, v]) => k + '=' + v).join('; ');
    const plUrl = `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=${uin}&sin=0&size=30&format=json&g_tk=${gtk}&loginUin=${uin}&hostUin=${uin}&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;
    const res = await nfetch(plUrl, { headers: { ...QQ_HEADERS, Cookie: cookieStr } });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch (err) { /* non-json */ }
    const d = (j || {}).data || {};
    const diss = Array.isArray(d.disslist) ? d.disslist : [];
    out['userPl'] = { code: j && j.code, n: diss.length, names: diss.slice(0, 15).map(x => JSON.stringify(x).slice(0, 220)) };
  } catch (err) { out['userPl'] = { err: String(err && err.message || err) }; }
  // v8 playlist endpoint
  const v8 = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?id=201${uin}&format=json&g_tk=${gtk}&loginUin=${uin}&hostUin=${uin}&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;
  await tryUrl('v8', v8, true);
  // musicu.fcg variant
  try {
    const guid = Math.floor(100000000 + Math.random() * 900000000);
    const payload = {
      comm: { ct: 24, cv: 0, uin: uin, guid: String(guid), authst: cm.qqmusic_key || cm.psrf_qqaccess_token || '' },
      req_0: { module: 'music.musiclist.MusicListSrv', method: 'GetMusicList', param: { disstid: Number('201' + uin), enc_host_uin: uin, tag: 1, userinfo: 1, userlabel: 1 } }
    };
    const res = await qqPost(payload);
    const d = (res.req_0 || {}).data || {};
    const list = Array.isArray(d.songlist) ? d.songlist : [];
    out['musicu'] = { code: (res.req_0 || {}).code, n: list.length, first: list[0] ? list[0].name : '', keys: Object.keys(d).slice(0, 8) };
  } catch (err) { out['musicu'] = { err: String(err && err.message || err) }; }
  return out;
}

// QQ 歌单歌曲列表：官方接口（onlysong=1 可匿名取详情）
async function qqPlaylistSongs(dissid) {
  const uin = await qqUin().catch(() => '');
  const cm = await qqCookieMap().catch(() => ({}));
  const gtk = qqGtk(cm.skey || cm.p_skey || cm.qqmusic_key || '');
  const cookieStr = Object.entries(cm).map(([k, v]) => k + '=' + v).join('; ');
  const url = `https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=1&new_format=1&disstid=${encodeURIComponent(dissid)}&format=json&g_tk=${gtk}&loginUin=${uin || 0}&hostUin=${uin || 0}&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;
  const res = await nfetch(url, { headers: uin ? { ...QQ_HEADERS, Cookie: cookieStr } : QQ_HEADERS });
  const j = await res.json();
  const list = Array.isArray(j.songlist) ? j.songlist : [];
  return list.map((s) => ({
    id: s.mid,
    platform: 'qq',
    name: s.name || s.title || '未知歌曲',
    artist: (s.singer || []).map((a) => a.name).join(' / ') || '未知歌手',
    album: (s.album && (s.album.name || s.album.title)) || '',
    dt: (s.interval || 0) * 1000,
    cover: s.album && s.album.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : ''
  }));
}

// 首页：QQ 音乐精选歌单
ipcMain.handle('qq-home', async () => {
  try {
    const url = 'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?categoryId=10000000&sortId=5&sin=0&ein=8&format=json&outCharset=utf-8';
    const res = await nfetch(url, { headers: QQ_HEADERS });
    const j = await res.json();
    const playlists = ((j.data && j.data.list) || []).map((p) => ({
      id: 'qqpl:' + p.dissid,
      name: p.dissname || '未知歌单',
      cover: String(p.imgurl || '').replace(/^http:/, 'https:'),
      playCount: p.listennum || 0,
      trackCount: 0
    }));
    return { playlists };
  } catch (err) {
    return { playlists: [], error: String(err && err.message || err) };
  }
});

ipcMain.handle('qq-playlist-detail', async (_e, id) => {
  try {
    const songs = await qqPlaylistSongs(String(id).replace(/^qqpl:/, ''));
    return { name: '', songs };
  } catch (err) {
    return { name: '', songs: [], error: String(err && err.message || err) };
  }
});

// QQ 我的喜欢：先查用户歌单列表找到「我喜欢」（dirid=201），再取歌曲
async function qqFindLikedDissid(uin) {
  try {
    const cm = await qqCookieMap();
    const gtk = qqGtk(cm.skey || cm.p_skey || cm.qqmusic_key || '');
    const cookieStr = Object.entries(cm).map(([k, v]) => k + '=' + v).join('; ');
    const url = `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=${uin}&sin=0&size=30&format=json&g_tk=${gtk}&loginUin=${uin}&hostUin=${uin}&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;
    const res = await nfetch(url, { headers: { ...QQ_HEADERS, Cookie: cookieStr } });
    const j = await res.json();
    const list = ((j.data || {}).disslist) || [];
    const liked = list.find((x) => x.dirid === 201 || /我喜欢/.test(x.diss_name || ''));
    return liked && liked.tid ? String(liked.tid) : '';
  } catch (err) { return ''; }
}

async function qqLikedCore() {
  try {
    const uin = await qqUin();
    if (!uin) return { name: '我的喜欢', songs: [], error: 'login' };
    const dissId = await qqFindLikedDissid(uin);
    let songs = [];
    if (dissId) songs = await qqPlaylistSongs(dissId);
    if (!songs.length) songs = await qqPlaylistSongs('201' + uin); // 兜底旧式 id
    return { name: '我的喜欢', songs };
  } catch (err) {
    return { name: '我的喜欢', songs: [], error: String(err && err.message || err) };
  }
}
ipcMain.handle('qq-liked', async () => qqLikedCore());

// QQ 喜欢歌曲状态缓存（按 id/songmid 映射），60s TTL
let qqLikedCache = { ts: 0, ids: null };
ipcMain.handle('qq-like-status', async (_e, ids) => {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String);
  const map = {};
  if (!list.length) return map;
  try {
    if (!qqLikedCache.ids || Date.now() - qqLikedCache.ts > 60000) {
      const res = await qqLikedCore();
      qqLikedCache.ids = new Set((res.songs || []).map((s) => String(s.id)));
      qqLikedCache.ts = Date.now();
    }
    list.forEach((id) => { map[id] = !!qqLikedCache.ids.has(id); });
  } catch (err) { /* 忽略 */ }
  return map;
});

// QQ 喜欢/取消喜欢：musicu.fcg batch_add/remove，dirid=201 我的喜欢
ipcMain.handle('qq-like-song', async (_e, mid, like) => {
  try {
    const uin = await qqUin();
    if (!uin) return { ok: false, needLogin: true, error: 'QQ 音乐未登录' };
    const cm = await qqCookieMap();
    const authst = cm.qqmusic_key || cm.psrf_qqaccess_token || '';
    if (!authst) return { ok: false, needLogin: true, error: 'QQ 登录态不完整，请重新扫码登录' };
    const payload = {
      comm: { ct: 24, cv: 0, uin: Number(uin) || 0, guid: String(qqGuid || (qqGuid = Math.floor(100000000 + Math.random() * 900000000))), authst },
      req_0: {
        module: 'music.musichall.song_list_report',
        method: like ? 'batch_add_song_to_list' : 'batch_remove_song_from_list',
        param: { song_list: [{ song_id: 0, song_type: 0, song_mid: String(mid) }], dirid: 201, from: 1 }
      }
    };
    const j = await qqPost(payload);
    const rc = (j.req_0 || {}).code;
    if (j.code === 0 && rc === 0) {
      if (qqLikedCache.ids) { if (like) qqLikedCache.ids.add(String(mid)); else qqLikedCache.ids.delete(String(mid)); }
      return { ok: true };
    }
    return { ok: false, code: rc, error: '收藏接口拒绝（code=' + rc + '，需在浏览器/QQ音乐完成完整登录）' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});


// ---------- 首页：推荐歌单 / 私人FM / 封面代理 ----------
ipcMain.handle('home', async () => {
  try {
    const data = await fetchJson(`${BASE}/api/personalized/playlist?limit=12&offset=0`);
    const playlists = (data.result || []).map((p) => ({
      id: String(p.id),
      name: p.name || '未知歌单',
      cover: neCover(p.picUrl || ''),
      playCount: p.playCount || 0,
      trackCount: p.trackCount || 0
    }));
    return { playlists };
  } catch (err) {
    return { playlists: [], error: String(err && err.message || err) };
  }
});

ipcMain.handle('playlist-detail', async (_e, id) => {
  const data = await fetchJson(`${BASE}/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=200&s=8`);
  const pl = data.playlist || {};
  const songs = (pl.tracks || []).map(mapSong);
  return { name: pl.name || '歌单', songs };
});

ipcMain.handle('liked-songs', async (_e, userId) => {
  try {
    return await likedSongsFor(userId);
  } catch (err) {
    return { name: '我的喜欢', songs: [], error: String(err && err.message || err) };
  }
});

// 「我的喜欢」缓存版：TTL 内直接返回，秒开列表与首曲
ipcMain.handle('liked-songs-cached', async (_e, userId) => {
  const key = String(userId);
  const hit = likedSongsCache.get(key);
  if (hit && Date.now() - hit.time < LIKED_SONGS_TTL) return hit.data;
  try {
    const data = await likedSongsFor(userId);
    likedSongsCache.set(key, { time: Date.now(), data });
    return data;
  } catch (err) {
    return { name: '我的喜欢', songs: [], error: String(err && err.message || err) };
  }
});

ipcMain.handle('liked-summary', async (_e, userId) => {
  if (!userId) return { name: '我的喜欢', trackCount: 0, id: '' };
  const cached = likedPlaylistCache.get(String(userId));
  if (cached) return cached;
  const liked = await findLikedPlaylist(userId);
  if (liked) { likedPlaylistCache.set(String(userId), liked); return liked; }
  const ids = await fetchLikedIds(userId);
  if (ids && ids.length) return { name: '我的喜欢', trackCount: ids.length, id: '' };
  return { name: '我的喜欢', trackCount: 0, id: String(userId) };
});

ipcMain.handle('fm', async () => {
  const data = await fetchJson(`${BASE}/api/v1/radio/get`);
  const songs = (data.data || []).map(mapSong);
  return { songs };
});

// 封面代理：主进程下载封面并转 base64，渲染端可安全取色（避免 canvas 跨域污染）
const COVER_CACHE = new Map(); // url -> { time, data } cover cache 2h
const COVER_TTL = 2 * 60 * 60 * 1000;
ipcMain.handle('fetch-cover', async (_e, url) => {
  if (!url) return '';
  const hit = COVER_CACHE.get(url);
  if (hit && Date.now() - hit.time < COVER_TTL) return hit.data;
  try {
    const hdrs = { 'User-Agent': UA };
    try { if (new URL(url).protocol === 'https:') hdrs.Referer = BASE + '/'; } catch (e) { /* 忽略非法 URL */ }
    const res = await nfetch(url, { headers: hdrs });
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = /\.png($|\?)/i.test(url) ? 'image/png' : 'image/jpeg';
    const data = 'data:' + mime + ';base64,' + buf.toString('base64');
    console.log('[fetch-cover] OK', url, 'bytes=' + buf.length, 'dataLen=' + data.length);
    COVER_CACHE.set(url, { time: Date.now(), data });
    if (COVER_CACHE.size > 400) { const k = COVER_CACHE.keys().next().value; COVER_CACHE.delete(k); }
    return data;
  } catch (err) {
    console.log('[fetch-cover] FAIL', url, err && err.message || err);
    return '';
  }
});
// ---------- 网页登录：内嵌浏览器登录后自动抓取全部 Cookie（含 HttpOnly） ----------
ipcMain.handle('open-login', async () => {
  if (loginWindow) { loginWindow.focus(); return 'already-open'; }
  loginWindow = new BrowserWindow({
    width: 960,
    height: 760,
    icon: APP_ICON,
    title: '网易云音乐 · 网页登录',
    parent: mainWindow,
    modal: true,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  loginWindow.loadURL(BASE + '/#/login');
  startLoginPolling();
  let loginLoadRetries = 0;
  loginWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (isMainFrame && loginLoadRetries < 3 && loginWindow && !loginWindow.isDestroyed()) {
      loginLoadRetries++;
      setTimeout(() => { if (loginWindow && !loginWindow.isDestroyed()) loginWindow.loadURL(BASE + '/#/login'); }, 1500);
    }
  });
  loginWindow.on('closed', () => { loginWindow = null; stopLoginPolling(); });
  return 'opened';
});

function startLoginPolling(closeOnSuccess) {
  stopLoginPolling();
  loginTimer = setInterval(async () => {
    try {
      const cookies = await session.defaultSession.cookies.get({ url: BASE });
      if (cookies.some(c => (c.name === 'MUSIC_U' || c.name === 'WM_NI' || c.name === 'WM_NIKE' || c.name === 'WM_TID') && c.value)) {
        stopLoginPolling();
        const st = await loginState();
        if (closeOnSuccess !== false && loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('login-success', st.nickname || '网易云用户', st.userId || 0);
        }
      }
    } catch (err) { /* 忽略轮询错误 */ }
  }, 2000);
}

function stopLoginPolling() {
  if (loginTimer) { clearInterval(loginTimer); loginTimer = null; }
}

function stopQqPolling() {
  if (qqLoginTimer) { clearInterval(qqLoginTimer); qqLoginTimer = null; }
}

function startQqPolling(closeOnSuccess) {
  stopQqPolling();
  qqLoginTimer = setInterval(async () => {
    try {
      const st = await qqLoginState();
      if (st.loggedIn) {
        stopQqPolling();
        if (closeOnSuccess !== false && qqLoginWindow && !qqLoginWindow.isDestroyed()) qqLoginWindow.close();
        if (qqEmbedView) closeQqEmbed();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('qq-login-success', st.nickname, String(st.userId), st.avatar);
        }
      }
    } catch (err) { /* 忽略 */ }
  }, 1500);
}

// ---------- 内嵌登录面板（iframe 轮询登录状态） ----------
ipcMain.handle('login-embed-start', async (_e, platform) => {
  if (platform === 'qq') { startQqPolling(false); return 'ok'; }
  startLoginPolling(false);
  return 'ok';
});
ipcMain.handle('login-embed-stop', async (_e, platform) => {
  if (platform === 'qq') stopQqPolling(); else stopLoginPolling();
  return 'ok';
});

// ---------- QQ 音乐内嵌登录：WebContentsView 内嵌真实网页，自动弹出登录浮层 ----------
let qqEmbedCloseCb = null;
function layoutQqEmbed() {
  if (!qqEmbedView || !mainWindow || mainWindow.isDestroyed()) return;
  const [cw, ch] = mainWindow.getContentSize();
  const ww = Math.min(1020, cw - 24);
  const wh = Math.min(780, ch - 90);
  qqEmbedView.setBounds({ x: Math.max(0, Math.floor((cw - ww) / 2)), y: 78, width: ww, height: Math.max(200, wh) });
}
function closeQqEmbed() {
  if (qqEmbedView) {
    try { mainWindow.contentView.removeChildView(qqEmbedView); } catch (e) { /* 忽略 */ }
    try { qqEmbedView.webContents.destroy(); } catch (e) { /* 忽略 */ }
    qqEmbedView = null;
  }
  stopQqPolling();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('qq-embed-closed');
}
function openQqEmbed() {
  if (qqEmbedView) { qqEmbedView.webContents.focus(); return 'opened'; }
  if (!mainWindow || mainWindow.isDestroyed()) return 'no-window';
  qqEmbedView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false } });
  mainWindow.contentView.addChildView(qqEmbedView);
  qqEmbedView.setBackgroundColor('#0a0c14');
  layoutQqEmbed();
  let loadRetries = 0;
  qqEmbedView.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (isMainFrame && loadRetries < 3 && qqEmbedView) {
      loadRetries++;
      setTimeout(() => { if (qqEmbedView) qqEmbedView.webContents.loadURL('https://y.qq.com/'); }, 1500);
    }
  });
  qqEmbedView.webContents.on('did-finish-load', () => {
    let tries = 0;
    const tryClick = () => {
      if (!qqEmbedView) return;
      qqEmbedView.webContents.executeJavaScript(`(function () {
        var el = document.querySelector('.top_login__link');
        if (!el) return false;
        el.click();
        return true;
      })()`).then((ok) => {
        if (!ok && ++tries < 12) setTimeout(tryClick, 800);
      }).catch(() => {
        if (++tries < 12) setTimeout(tryClick, 800);
      });
    };
    tryClick();
  });
  qqEmbedView.webContents.loadURL('https://y.qq.com/');
  startQqPolling(false);
  return 'opened';
}
ipcMain.handle('qq-embed-open', async () => openQqEmbed());
ipcMain.handle('qq-embed-close', async () => { closeQqEmbed(); return 'closed'; });

// ---------- 网易云扫码登录（weapi 公开接口） ----------
async function ncmWeapiPost(path, object, noCookie) {
  const { params, encSecKey } = weapiEncrypt(object || {});
  const cookie = noCookie ? '' : await cookieHeader();
  const res = await nfetch(BASE + path, {
    method: 'POST',
    headers: cookie
      ? { ...API_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }
      : { ...API_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'params=' + encodeURIComponent(params) + '&encSecKey=' + encodeURIComponent(encSecKey)
  });
  return res;
}

async function ncmSetCookiesFromResponse(res) {
  let list = [];
  try { if (res.headers && typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie(); } catch (e) { /* 忽略 */ }
  if (!list.length) {
    const single = res.headers && res.headers.get && res.headers.get('set-cookie');
    if (single) list = [single];
  }
  const set = (name, value, domain, path) => session.defaultSession.cookies.set({
    url: 'https://music.163.com',
    name: name, value: value,
    domain: domain || 'music.163.com',
    path: path || '/'
  }).catch(() => {});
  for (const sc of list) {
    const segs = sc.split(';');
    const first = segs.shift() || '';
    const eq = first.indexOf('=');
    if (eq < 1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    let domain = 'music.163.com', path = '/';
    for (const seg of segs) {
      const t = seg.trim();
      const m = /^domain=(.+)$/i.exec(t); if (m) { domain = m[1]; continue; }
      const mp = /^path=(.+)$/i.exec(t); if (mp) { path = mp[1]; }
    }
    await set(name, value, domain, path);
  }
}

function ncmParseCookieString(cookieStr) {
  const out = [];
  if (!cookieStr || typeof cookieStr !== 'string') return out;
  const blocks = String(cookieStr).replace(/\r?\n/g, ',').split(/,\s*(?=[A-Za-z_][A-Za-z0-9_]*\s*=)/);
  const ATTR = /^(max-age|expires|path|domain|httponly|samesite|secure|priority)$/i;
  for (const block of blocks) {
    const parts = String(block).split(';');
    let cur = null;
    for (const raw of parts) {
      const t = String(raw).trim();
      if (!t) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();
      if (ATTR.test(key)) {
        if (cur && /^domain$/i.test(key)) cur.domain = val;
        else if (cur && /^path$/i.test(key)) cur.path = val;
        continue;
      }
      if (cur) out.push(cur);
      cur = { name: key, value: val, domain: 'music.163.com', path: '/' };
    }
    if (cur) out.push(cur);
  }
  return out;
}

async function ncmSetCookiesFromString(cookieStr) {
  const list = ncmParseCookieString(cookieStr);
  for (const c of list) {
    try {
      await session.defaultSession.cookies.set({ url: 'https://music.163.com', name: c.name, value: c.value, domain: c.domain, path: c.path });
    } catch (e) { /* ignore single cookie */ }
  }
  return list.length;
}
let ncmQrPollTimer = null;
ipcMain.handle('ncm-qr-start', async () => {
  try {
    const res = await ncmWeapiPost('/weapi/login/qrcode/unikey', { type: 1 }, true);
    const j = await res.json();
    if (!j || j.code !== 200 || !j.unikey) return { ok: false, error: (j && j.message) || 'unikey 获取失败' };
    const qrUrl = 'https://music.163.com/login?codekey=' + j.unikey;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 2, width: 260, color: { dark: '#10141f', light: '#ffffff' } });
    return { ok: true, unikey: j.unikey, qrDataUrl: qrDataUrl };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('ncm-qr-check', async (_e, unikey) => {
  if (!unikey) return { code: 800, message: '' };
  try {
    const res = await ncmWeapiPost('/weapi/login/qrcode/client/login', { key: unikey, type: 1 }, true);
    const j = await res.json();
    if (j && j.code === 803) {
      if (j.cookie) await ncmSetCookiesFromString(j.cookie);
      await ncmSetCookiesFromResponse(res);
      let st = { loggedIn: false };
      for (let i = 0; i < 4 && !st.loggedIn; i++) {
        if (i) await new Promise((r) => setTimeout(r, 350));
        st = await loginState();
      }
      if (st.loggedIn) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('login-success', st.nickname, st.userId);
        }
        return { code: 803, loggedIn: true, message: '登录成功', nickname: st.nickname, userId: st.userId };
      }
      return { code: 803, loggedIn: false, message: '已授权但未能获取登录态，请重试' };
    }
    return { code: j && j.code, message: j && j.message };
  } catch (err) {
    return { code: -1, message: String(err && err.message || err) };
  }
});

// ---------- 网易云 VIP 信息：weapi 接口，缓存 10 分钟 ----------
const netVipCache = new Map();
const NET_VIP_TTL = 10 * 60 * 1000;
async function neteaseVipInfo(userId) {
  const key = 'v' + (userId || 0);
  const hit = netVipCache.get(key);
  if (hit && Date.now() - hit.time < NET_VIP_TTL) return hit.data;
  try {
    const ck = await cookieHeader();
    const csrf = ck.split('; ').map((x) => x.split('=')).filter((x) => x[0] === '__csrf').map((x) => x[1])[0] || '';
    const { params, encSecKey } = weapiEncrypt({ userId: String(userId || ''), csrf_token: csrf });
    const res = await nfetch(`${BASE}/weapi/music-vip-membership/front/vip/info`, {
      method: 'POST',
      headers: ck
        ? { ...API_HEADERS, Origin: BASE + '/', 'Content-Type': 'application/x-www-form-urlencoded', Cookie: ck + '; os=pc; appver=8.9.7' }
        : { ...API_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`
    });
    const j = await res.json();
    const d = j && j.data;
    if (!d) return { ok: false };
    const now = Date.now();
    const data = {
      ok: true,
      redVipLevel: d.redVipLevel || 0,
      svip: !!(d.redplus && d.redplus.expireTime > now),
      vip: !!(d.associator && d.associator.expireTime > now),
      musicPackage: !!(d.musicPackage && d.musicPackage.expireTime > now),
      svipExpire: (d.redplus && d.redplus.expireTime) || 0,
      vipExpire: (d.associator && d.associator.expireTime) || 0,
      icons: {
        svip: (d.redplus && (d.redplus.dynamicIconUrl || d.redplus.iconUrl)) || d.redVipLevelIcon || '',
        vip: (d.associator && (d.associator.dynamicIconUrl || d.associator.iconUrl)) || d.redVipLevelIcon || ''
      }
    };
    netVipCache.set(key, { time: Date.now(), data });
    return data;
  } catch (err) {
    return { ok: false };
  }
}

async function loginState() {
  try {
    const data = await fetchJson(`${BASE}/api/nuser/account/get`);
    if (data.code === 200 && data.account) {
      const p = data.profile || {};
      const account = data.account || {};
      // vipType 语义：account 侧 0/10/11/21；profile 侧 110 = 黑胶SVIP（新版编码，统一映射为 21）
      const rawVt = p.vipType || account.vipType || 0;
      let vt = rawVt === 110 ? 21 : rawVt;
      const vi = await neteaseVipInfo(p.userId || account.id);
      if (vi.ok) {
        if (vi.svip) vt = 21;
        else if (vi.vip) vt = 11;
        else if (vi.musicPackage) vt = 10;
        else vt = 0;
      }
      const svipActive = vt === 21;
      return {
        loggedIn: true, platform: 'netease',
        nickname: p.nickname || '网易云用户',
        userId: p.userId || 0,
        avatar: p.avatarUrl || '',
        vipType: vt,
        vipLevel: vi.ok ? vi.redVipLevel : 0,
        vipExpire: vi.ok ? (svipActive ? vi.svipExpire : vi.vipExpire) : 0,
        vipLabel: vt === 21 ? '黑胶SVIP' : (vt === 11 ? '黑胶VIP' : (vt === 10 ? '音乐包' : (rawVt > 0 ? 'VIP' : '普通用户'))),
        signature: p.signature || ''
      };
    }
  } catch (err) { /* 忽略 */ }
  return { loggedIn: false, platform: 'netease', nickname: '', userId: 0, avatar: '', vipType: 0, vipLevel: 0, vipExpire: 0, vipLabel: '', signature: '' };
}

ipcMain.handle('get-login-state', async () => loginState());

ipcMain.handle('logout', async () => {
  const cookies = await session.defaultSession.cookies.get({ url: BASE });
  for (const c of cookies) {
    try { await session.defaultSession.cookies.remove(BASE, c.name); } catch (err) { /* 忽略 */ }
  }
  return true;
});

ipcMain.handle('set-cookie', async (_e, text) => {
  const pairs = String(text || '').trim().replace(/^cookie:\s*/i, '').split(';');
  let n = 0;
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name || !value) continue;
    try {
      await session.defaultSession.cookies.set({
        url: BASE, name, value, path: '/',
        expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
      });
      n++;
    } catch (err) { /* 忽略 */ }
  }
  return n > 0 ? loginState() : { loggedIn: false, nickname: '' };
});

// ---------- 桌面歌词窗口（迷你置顶歌词，Folia 没有的差异化功能） ----------
function createLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) { lyricWindow.focus(); return; }
  const wa = (screen && screen.getPrimaryDisplay) ? screen.getPrimaryDisplay().workArea : { x: 0, y: 0, width: 1280, height: 720 };
  lyricWindow = new BrowserWindow({
    width: 480,
    height: 122,
    x: wa.x + wa.width - 500,
    y: wa.y + wa.height - 150,
    transparent: true,
    icon: APP_ICON,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-lyric.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  lyricWindow.loadFile(path.join(__dirname, 'renderer', 'lyric-window.html'));
  lyricWindow.once('ready-to-show', () => lyricWindow.show());
  lyricWindow.on('closed', () => { lyricWindow = null; });
}

ipcMain.handle('toggle-lyric-window', () => {
  if (lyricWindow && !lyricWindow.isDestroyed()) {
    lyricWindow.close();
    lyricWindow = null;
    return false;
  }
  createLyricWindow();
  return true;
});

ipcMain.on('lyric-window-close', () => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close();
  lyricWindow = null;
});

ipcMain.on('lyric-line', (_e, data) => {
  if (lyricWindow && !lyricWindow.isDestroyed()) {
    lyricWindow.webContents.send('lyric-line', data);
  }
});

// ---------- 迷你模式（置顶小窗） ----------
let miniWindow = null;
function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.focus(); return; }
  miniWindow = new BrowserWindow({
    width: 340,
    height: 104,
    icon: APP_ICON,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b0e16',
    webPreferences: {
      preload: path.join(__dirname, 'mini-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  miniWindow.loadFile(path.join(__dirname, 'renderer', 'mini.html'));
  miniWindow.on('closed', () => {
    miniWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mini-closed');
  });
}
ipcMain.handle('toggle-mini', () => {
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.close(); miniWindow = null; return false; }
  createMiniWindow();
  return true;
});
// 迷你窗 -> 主窗：控制命令（toggle/next/prev），close 关闭小窗
ipcMain.on('mini-command', (_e, cmd) => {
  if (cmd === 'close') {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
    miniWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mini-closed');
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media-command', cmd);
  }
});
// 主窗 -> 迷你窗：播放状态同步
ipcMain.on('mini-state', (_e, data) => {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('mini-state', data);
});

// ---------- 歌曲收藏 / 取消收藏 ----------
function buildWeapiCookie(ck) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let nmt = '';
  for (let i = 0; i < 32; i++) nmt += chars[Math.floor(Math.random() * chars.length)];
  return (ck || '')
    + '; os=pc'
    + '; appver=3.1.17.204416'
    + '; osver=Microsoft-Windows-10-Professional-build-19045-64bit'
    + '; channel=netease'
    + '; __remember_me=true'
    + '; WEVNSM=1.0.0'
    + '; WNMCID=' + nmt.slice(0, 6) + '.' + Date.now() + '.01.0'
    + '; NMTID=' + nmt;
}
ipcMain.handle('like-song', async (_e, id, like) => {
  if (!id) return { ok: false, error: 'no-id' };
  try {
    const cookie = await cookieHeader();
    const csrf = cookie.split('; ').map((x) => x.split('=')).filter((x) => x[0] === '__csrf').map((x) => x[1])[0] || '';
    const { params, encSecKey } = weapiEncrypt({
      alg: 'itembased',
      trackId: Number(id),
      like: !!like,
      time: '3',
      csrf_token: csrf
    });
    const res = await nfetch(`${BASE}/weapi/song/like`, {
      method: 'POST',
      headers: cookie
        ? { ...API_HEADERS, Origin: BASE + '/', 'Content-Type': 'application/x-www-form-urlencoded', Cookie: buildWeapiCookie(cookie) }
        : { ...API_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`
    });
    const j = await res.json();
    if (j.code === 200) {
      const key = String(id);
      if (like) likedIdSet.add(key); else likedIdSet.delete(key);
      // 喜欢状态变更：失效「我的喜欢」歌曲缓存与摘要缓存，保证列表/数量实时同步
      likedSongsCache.clear();
      likedPlaylistCache.clear();
      return { ok: true };
    }
    return { ok: false, needWeb: false, code: j.code, error: '登录态失效或接口拒绝（code=' + j.code + '）' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err), needWeb: false };
  }
});

ipcMain.handle('open-song-page', async (_e, id) => {
  try {
    const songUrl = BASE + '/#/song?id=' + encodeURIComponent(id);
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.loadURL(songUrl);
      loginWindow.focus();
      return true;
    }
    loginWindow = new BrowserWindow({
      width: 1100,
      height: 760,
      title: '网易云音乐 · 收藏歌曲',
      parent: mainWindow,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
    });
    loginWindow.loadURL(songUrl);
    loginWindow.on('closed', () => { loginWindow = null; stopLoginPolling(); });
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('like-status', async (_e, ids) => {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String);
  const map = {};
  if (!list.length) return map;
  // 懒加载：未缓存时先拉一次喜欢歌单（playlist/detail 接口可靠，无需 weapi）
  if (!likedIdSet.size) {
    try {
      const st = await loginState();
      if (st.userId) await likedSongsFor(st.userId);
    } catch (err) { /* 保持空集合 */ }
  }
  list.forEach((id) => { map[id] = likedIdSet.has(id); });
  return map;
});

// ---------- AI 助手：用户自定义 OpenAI 兼容接口 ----------
function normalizeAiBase(base) {
  let u = String(base || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
async function aiRequest(cfg, path, body, method) {
  const base = normalizeAiBase(cfg && cfg.base);
  if (!base) return { ok: false, error: '请先填写 AI 接口地址' };
  const headers = { 'Content-Type': 'application/json', 'User-Agent': UA };
  if (cfg && cfg.key) headers.Authorization = 'Bearer ' + String(cfg.key).trim();
  const url = base + path;
  const res = await nfetch(url, {
    method: method || 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000)
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  return { ok: res.ok, status: res.status, body: j, raw: text.slice(0, 600) };
}
ipcMain.handle('ai-test', async (_e, cfg) => {
  try {
    const t0 = Date.now();
    const m = await aiRequest(cfg, '/models', null, 'GET');
    if (m.ok && m.body && (Array.isArray(m.body.data) || Array.isArray(m.body.models))) {
      const models = Array.isArray(m.body.data) ? m.body.data : m.body.models;
      const modelList = models.map((x) => (typeof x === 'string' ? x : (x.id || x.name || ''))).filter(Boolean).slice(0, 12);
      const cfgModel = (cfg && cfg.model) || '';
      const match = cfgModel && modelList.find((x) => x === cfgModel);
      return { ok: true, ms: Date.now() - t0, mode: 'models', model: match || cfgModel || modelList[0] || '', models: modelList };
    }
    const chat = await aiRequest(cfg, '/chat/completions', {
      model: (cfg && cfg.model) || 'deepseek-chat',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8
    });
    if (chat.ok) return { ok: true, ms: Date.now() - t0, mode: 'chat', model: (cfg && cfg.model) || '' };
    const msg = (chat.body && chat.body.error && (chat.body.error.message || chat.body.error.code)) || chat.raw || ('HTTP ' + chat.status);
    return { ok: false, ms: Date.now() - t0, error: String(msg).slice(0, 200) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 200) };
  }
});
ipcMain.handle('ai-chat', async (_e, cfg, messages) => {
  try {
    const chat = await aiRequest(cfg, '/chat/completions', {
      model: (cfg && cfg.model) || 'deepseek-chat',
      messages: Array.isArray(messages) ? messages : [],
      temperature: (cfg && cfg.temperature) || 0.7
    });
    if (!chat.ok) {
      const msg = (chat.body && chat.body.error && chat.body.error.message) || chat.raw || ('HTTP ' + chat.status);
      return { ok: false, error: String(msg).slice(0, 300) };
    }
    const choice = chat.body && chat.body.choices && chat.body.choices[0];
    const content = (choice && choice.message && choice.message.content) || (choice && choice.text) || '';
    return { ok: true, content: String(content), model: chat.body && chat.body.model || (cfg && cfg.model) || '' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 300) };
  }
});
// AI 音乐上下文：我的喜欢 / 热曲排行 / 每日推荐
ipcMain.handle('ai-music-context', async () => {
  try {
    const st = await loginState();
    const out = { loggedIn: !!st.userId, nickname: st.nickname, vipType: st.vipType, vipLabel: st.vipLabel, liked: null, hot: null, daily: null };
    if (st.userId) {
      const liked = await likedSongsFor(st.userId).catch(() => null);
      if (liked && liked.songs) {
        out.liked = { name: liked.name, count: liked.songs.length, songs: liked.songs.slice(0, 60).map((x) => ({ name: x.name, artist: x.artist, album: x.album })) };
      }
      const daily = await fetchJson(`${BASE}/api/v3/discovery/recommend/songs`).catch(() => null);
      if (daily && daily.data && daily.data.dailySongs) {
        out.daily = daily.data.dailySongs.slice(0, 30).map(mapSong).map((x) => ({ name: x.name, artist: x.artist }));
      }
    }
    const charts = [['热歌榜', 3778678], ['飙升榜', 19723756], ['新歌榜', 3779629]];
    out.hot = [];
    for (const [name, id] of charts) {
      try {
        const d = await fetchJson(`${BASE}/api/v6/playlist/detail?id=${id}&n=15&s=8`);
        if (d && d.playlist && d.playlist.tracks) {
          out.hot.push({ name, songs: d.playlist.tracks.slice(0, 15).map(mapSong).map((x) => ({ name: x.name, artist: x.artist })) });
        }
      } catch (e) { /* 单个榜单失败不阻塞 */ }
    }
    return out;
  } catch (err) {
    return { loggedIn: false, liked: null, hot: null, daily: null, error: String(err && err.message || err) };
  }
});


// ---------- 系统托盘 + 全局媒体快捷键（桌面端差异化功能） ----------
let tray = null;
let trayLyricChecked = false;

function sendMediaCommand(cmd) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media-command', cmd);
  }
}

function createTray() {
  if (tray) return;
  try {
    const icon = nativeImage.createFromPath(APP_ICON);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('YuMusic · 网易云播放器');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 YuMusic', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: '播放 / 暂停', click: () => sendMediaCommand('toggle') },
      { label: '上一首', click: () => sendMediaCommand('prev') },
      { label: '下一首', click: () => sendMediaCommand('next') },
      { type: 'separator' },
      { label: '桌面歌词', type: 'checkbox', checked: trayLyricChecked, click: (item) => { trayLyricChecked = item.checked; sendMediaCommand('desk-lyric'); } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]));
    tray.on('click', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } });
    console.log('Tray created');
  } catch (err) {
    console.error('Tray failed:', err.message);
  }
}

function registerGlobalShortcuts() {
  const binds = [
    ['MediaPlayPause', 'toggle'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'prev'],
    ['Alt+Shift+Space', 'toggle'],
    ['Alt+Shift+Right', 'next'],
    ['Alt+Shift+Left', 'prev'],
    ['Alt+Shift+L', 'desk-lyric']
  ];
  let ok = 0;
  for (const [acc, cmd] of binds) {
    try { if (globalShortcut.register(acc, () => sendMediaCommand(cmd))) ok++; } catch (err) { /* 快捷键被占用时跳过 */ }
  }
  console.log('Global shortcuts registered:', ok + '/' + binds.length);
}

ipcMain.on('tray-lyric-state', (_e, on) => { trayLyricChecked = !!on; });
// ---------- Wallpaper Engine ?? ----------
const WE_APPID = '431960';
function steamLibraries() {
  const libs = new Set();
  const tryPaths = [];
  try {
    const out = require('child_process').execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8' });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) tryPaths.push(m[1].trim());
  } catch (err) { /* 忽略 */ }
  tryPaths.push('D:/Steam', 'C:/Program Files (x86)/Steam', 'C:/Program Files/Steam', 'D:/SteamLibrary');
  for (const sp of tryPaths) {
    const vdf = path.join(sp, 'steamapps', 'libraryfolders.vdf');
    try {
      const txt = fs.readFileSync(vdf, 'utf8');
      const re = /"path"\s+"([^"]+)"/g;
      let mm;
      while ((mm = re.exec(txt))) libs.add(mm[1].replace(/\\/g, '\\'));
    } catch (err) { /* 忽略 */ }
  }
  for (const sp of tryPaths) libs.add(sp);
  return Array.from(libs);
}
function findWeInstall() {
  const cfg = path.join('D:/Steam', 'steamapps', 'common', 'wallpaper_engine', 'config.json');
  try {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    if (j && j['?installdirectory']) return String(j['?installdirectory']);
  } catch (err) { /* 忽略 */ }
  for (const lib of steamLibraries()) {
    const dir = path.join(lib, 'steamapps', 'common', 'wallpaper_engine');
    try { if (fs.statSync(path.join(dir, 'wallpaper64.exe')).isFile()) return dir; } catch (err) { /* 忽略 */ }
  }
  return null;
}
function findWeWorkshop() {
  const install = findWeInstall();
  if (install) {
    const ws = path.join(path.dirname(path.dirname(install)), 'workshop', 'content', WE_APPID);
    try { if (fs.statSync(ws).isDirectory()) return ws; } catch (err) { /* 忽略 */ }
  }
  for (const lib of steamLibraries()) {
    const ws = path.join(lib, 'steamapps', 'workshop', 'content', WE_APPID);
    try { if (fs.statSync(ws).isDirectory()) return ws; } catch (err) { /* 忽略 */ }
  }
  return null;
}
function weLocalProjects() {
  const install = findWeInstall();
  if (!install) return [];
  const out = [];
  for (const sub of ['projects/myprojects', 'projects/defaultprojects']) {
    const dir = path.join(install, sub);
    let names;
    try { names = fs.readdirSync(dir); } catch (err) { continue; }
    for (const name of names) {
      const d = path.join(dir, name);
      try { if (fs.statSync(d).isDirectory()) out.push({ src: 'local', id: name, dir: d }); } catch (err) { /* 忽略 */ }
    }
  }
  return out;
}
function parseWeProject(d, fallbackId) {
  let title = fallbackId, type = '', file = '', preview = '';
  try {
    const j = JSON.parse(fs.readFileSync(path.join(d, 'project.json'), 'utf8'));
    title = j.title || fallbackId; type = j.type || ''; file = j.file || ''; preview = j.preview || '';
  } catch (err) { /* 忽略 */ }
  return { title: String(title), type: String(type), file, preview };
}
function listWallpapers() {
  const ws = findWeWorkshop();
  const install = findWeInstall();
  if (!ws && !install) return { ok: false, error: 'Wallpaper Engine ???' };
  const list = [];
  if (ws) {
    let ids;
    try { ids = fs.readdirSync(ws); } catch (err) { ids = []; }
    for (const id of ids) {
      const d = path.join(ws, id);
      try { if (!fs.statSync(d).isDirectory()) continue; } catch (err) { continue; }
      const p = parseWeProject(d, id);
      const low = String(p.type).toLowerCase();
      const isVideo = low === 'video' && p.file && /\.(mp4|webm|mov)$/i.test(p.file);
      const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(p.file);
      list.push({
        src: 'workshop', id, title: p.title, type: p.type,
        video: isVideo ? p.file : '',
        image: isImg ? p.file : '',
        preview: p.preview || 'preview.jpg'
      });
    }
  }
  for (const proj of weLocalProjects()) {
    const p = parseWeProject(proj.dir, proj.id);
    const low = String(p.type).toLowerCase();
    const isVideo = low === 'video' && p.file && /\.(mp4|webm|mov)$/i.test(p.file);
    const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(p.file);
    list.push({
      src: 'local', id: proj.id, title: '[WE] ' + p.title, type: p.type,
      video: isVideo ? p.file : '',
      image: isImg ? p.file : '',
      preview: p.preview || 'preview.jpg'
    });
  }
  return { ok: true, ws: ws || '', install: install || '', list };
}
function weActiveWallpaper() {
  try {
    const install = findWeInstall();
    if (!install) return { ok: false, error: 'Wallpaper Engine ???' };
    const j = JSON.parse(fs.readFileSync(path.join(install, 'config.json'), 'utf8'));
    let selected = null;
    for (const k of Object.keys(j)) {
      if (k === '?installdirectory') continue;
      const g = j[k] && j[k].general;
      if (!g) continue;
      const sw = g.wallpaperconfig && g.wallpaperconfig.selectedwallpapers;
      if (sw && typeof sw === 'object') {
        const monitors = Object.keys(sw);
        if (monitors.length) selected = sw[monitors[0]];
      }
      if (!selected && g.wallpaperconfigrecent && g.wallpaperconfigrecent.length) {
        const r = g.wallpaperconfigrecent[0].config && g.wallpaperconfigrecent[0].config.selectedwallpapers;
        if (r && typeof r === 'object') {
          const monitors = Object.keys(r);
          if (monitors.length) selected = r[monitors[0]];
        }
      }
      if (selected) break;
    }
    if (!selected || !selected.file) return { ok: false, error: '未找到 Wallpaper Engine 当前壁纸' };
    const filePath = String(selected.file);
    const ws = findWeWorkshop();
    if (ws) {
      const m = filePath.match(new RegExp('[\\/]431960[\\/]([^\\/]+)[\\/](.+)$'));
      if (m) return { ok: true, current: { src: 'workshop', id: m[1], file: m[2], full: filePath } };
    }
    for (const proj of weLocalProjects()) {
      const lower = filePath.toLowerCase();
      const projLower = proj.dir.toLowerCase();
      if (lower.startsWith(projLower + path.sep) || lower.startsWith(projLower + '/')) {
        const rel = filePath.slice(proj.dir.length + 1).replace(/\\/g, '/');
        return { ok: true, current: { src: 'local', id: proj.id, file: rel, full: filePath } };
      }
    }
    return { ok: true, current: { src: 'file', id: '', file: path.basename(filePath), full: filePath } };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}
function registerWallpaperProtocol() {
  try {
    protocol.handle('wallpaper', (req) => {
      try {
        const u = new URL(req.url);
        const host = u.hostname;
        const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        let base = null;
        if (host.indexOf('local-') === 0) {
          const name = decodeURIComponent(host.slice(6));
          const install = findWeInstall();
          if (!install) return new Response('Wallpaper Engine not found', { status: 404 });
          for (const sub of ['projects/myprojects', 'projects/defaultprojects']) {
            const cand = path.resolve(path.join(install, sub, name));
            try { if (fs.statSync(cand).isDirectory()) { base = cand; break; } } catch (err) { /* 忽略 */ }
          }
          if (!base) return new Response('project not found', { status: 404 });
        } else {
          const ws = findWeWorkshop();
          if (!ws) return new Response('Wallpaper Engine not found', { status: 404 });
          base = path.resolve(path.join(ws, host));
        }
        const target = path.resolve(path.join(base, rel));
        if (target !== base && !target.startsWith(base + path.sep)) return new Response('forbidden', { status: 403 });
        return net.fetch(pathToFileURL(target).toString());
      } catch (err) {
        return new Response('bad request', { status: 400 });
      }
    });
  } catch (err) { console.error('wallpaper protocol:', (err && err.message) || err); }
}
ipcMain.handle('wallpaper-engine-info', () => {
  const ws = findWeWorkshop();
  const install = findWeInstall();
  return { ok: !!(ws || install), ws: ws || '', install: install || '' };
});
ipcMain.handle('list-wallpapers', () => listWallpapers());
ipcMain.handle('we-active-wallpaper', () => weActiveWallpaper());

// ---------- 软件内自动更新（electron-updater → GitHub Releases）----------
const { autoUpdater } = require('electron-updater');
let updateState = { checking: false, available: false, downloading: false, downloaded: false, version: '', percent: 0, error: '' };
function sendUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('app-update', updateState); } catch (err) { /* 忽略 */ }
  }
}
function setupAutoUpdater(force) {
  if (!app.isPackaged && !force) return; // 开发模式不检查更新
  autoUpdater.autoDownload = false; // 先提示用户，确认后下载
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => { updateState.checking = true; console.log('[update] checking'); sendUpdateState(); });
  autoUpdater.on('update-available', (info) => {
    updateState.checking = false; updateState.available = true; updateState.downloading = false; updateState.downloaded = false;
    updateState.version = (info && info.version) || '';
    console.log('[update] available ' + updateState.version);
    sendUpdateState();
  });
  autoUpdater.on('update-not-available', () => {
    updateState.checking = false; updateState.available = false;
    console.log('[update] not available');
    sendUpdateState();
  });
  autoUpdater.on('download-progress', (p) => {
    updateState.downloading = true; updateState.percent = (p && Math.round(p.percent)) || 0;
    sendUpdateState();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState.downloading = false; updateState.downloaded = true;
    updateState.version = (info && info.version) || updateState.version;
    sendUpdateState();
  });
  autoUpdater.on('error', (err) => {
    updateState.checking = false; updateState.error = String((err && err.message) || err);
    console.log('[update] error ' + updateState.error);
    sendUpdateState();
  });
  // 启动 8 秒后后台静默检查，不阻塞首屏
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => { /* 忽略网络失败 */ }); }, 8000);
}
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return { ok: false, error: '开发模式下不支持在线检查更新，请使用打包版' };
  try {
    const checkP = autoUpdater.checkForUpdates().then(() => ({ ok: true })).catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
    const done = await Promise.race([
      checkP,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: '检查更新超时，请检查网络后重试' }), 35000))
    ]);
    return done;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('update-download', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('update-install', () => {
  setImmediate(() => { try { autoUpdater.quitAndInstall(false, true); } catch (err) { /* 忽略 */ } });
  return { ok: true };
});
// ---------- 生命周期 ----------
app.whenReady().then(registerWallpaperProtocol);
const dbgMode = ['--smoke', '--shot', '--dom', '--shot-home', '--shot-intro', '--mini-test', '--dom-test', '--qq-diag', '--net-vip-diag', '--ai-diag', '--play-diag', '--lyric-diag', '--amll-diag', '--stage-diag', '--wall-test', '--update-diag'].find((f) => process.argv.includes(f));
if (dbgMode) {
  app.whenReady().then(() => {
    if (dbgMode === '--update-diag') {
  const feedIdx = process.argv.indexOf('--update-feed');
  if (feedIdx >= 0 && process.argv[feedIdx + 1]) {
    try { autoUpdater.setFeedURL({ provider: 'generic', url: String(process.argv[feedIdx + 1]) }); } catch (err) { /* 忽略 */ }
  }
  setupAutoUpdater(true);
  autoUpdater.once('update-available', () => {
    console.log('[update] auto-downloading…');
    autoUpdater.downloadUpdate().catch((e) => { console.log('[update] download err ' + String(e && e.message || e)); app.quit(); });
  });
  autoUpdater.once('update-downloaded', () => { console.log('[update] downloaded OK'); app.quit(); });
  setTimeout(() => { console.log('[update] diag done (timeout)'); app.quit(); }, 90000);
}
    const demoIdx = process.argv.indexOf('--demo-mode');
    const tIdx = process.argv.indexOf('--demo-time');
    const query = { nosplash: dbgMode === '--shot-intro' ? '0' : '1' }; // 调试模式跳过首次启动封面，便于截图 / DOM 检查
    if (demoIdx >= 0 && process.argv[demoIdx + 1]) {
      query.demo = '1';
      query.mode = process.argv[demoIdx + 1];
      query.t = tIdx >= 0 ? process.argv[tIdx + 1] : '0';
      query.p = process.argv.includes('--demo-pause') ? '1' : '0';
      const presetIdx = process.argv.indexOf('--demo-preset');
      if (presetIdx >= 0 && process.argv[presetIdx + 1]) query.preset = process.argv[presetIdx + 1];
      const coverIdx = process.argv.indexOf('--demo-cover');
      if (coverIdx >= 0 && process.argv[coverIdx + 1]) query.cover = process.argv[coverIdx + 1];
      const switchIdx = process.argv.indexOf('--demo-switch-to');
      if (switchIdx >= 0 && process.argv[switchIdx + 1]) query.switchTo = process.argv[switchIdx + 1];
      const bgIdx = process.argv.indexOf('--demo-bg');
      if (bgIdx >= 0 && process.argv[bgIdx + 1]) query.bg = process.argv[bgIdx + 1];
      const panelIdx = process.argv.indexOf('--demo-panel');
      if (panelIdx >= 0 && process.argv[panelIdx + 1] === '1') query.panel = '1';
      const tabIdx = process.argv.indexOf('--demo-tab');
      if (tabIdx >= 0 && process.argv[tabIdx + 1]) query.tab = process.argv[tabIdx + 1];
      const arkIdx = process.argv.indexOf('--ark-theme');
      if (arkIdx >= 0 && process.argv[arkIdx + 1] === '1') query.ark = '1';
    }
    createMainWindow({ query });
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log('RENDERER[' + level + '] ' + sourceId + ':' + line + ' ' + message);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      if (dbgMode === '--shot') {
        const fs = require('fs');
        const out = process.argv[process.argv.indexOf('--shot') + 1] || 'shot.png';
        setTimeout(async () => {
          try {
            const styleIdx = process.argv.indexOf('--demo-btnstyle');
            if (styleIdx >= 0 && process.argv[styleIdx + 1]) {
              await mainWindow.webContents.executeJavaScript('if (window.__setBtnStyle) window.__setBtnStyle(' + JSON.stringify(process.argv[styleIdx + 1]) + '); true');
              await new Promise((r) => setTimeout(r, 250));
            }
            if (query && query.switchTo) {
              await new Promise((r) => setTimeout(r, 1500));
              await mainWindow.webContents.executeJavaScript('window.__mrSetPreset(' + JSON.stringify(query.switchTo) + '); true');
              await new Promise((r) => setTimeout(r, 2000));
            }
            if (query && query.mode === 'sonnet') {
              const t0 = Date.now();
              while (Date.now() - t0 < 6000) {
                const ready = await mainWindow.webContents.executeJavaScript(`!!window.__sonnetRt`);
                if (ready) {
                  await mainWindow.webContents.executeJavaScript(`window.__sonnetRt.renderOnce(); true`);
                  break;
                }
                await new Promise(r => setTimeout(r, 150));
              }
            }
            const state = await mainWindow.webContents.executeJavaScript(`(() => {
              const float = document.getElementById('lyricFloat');
              const act = float ? float.querySelector('.lyric-line') : null;
              const chars = act ? Array.from(act.querySelectorAll('.lyric-char, .fw-word')) : [];
              return JSON.stringify({
                stageVisible: !document.getElementById('stageView').classList.contains('hidden'),
                mode: document.getElementById('stageView').dataset.mode,
                lines: float ? float.querySelectorAll('.lyric-line').length : 0,
                activeText: act ? act.textContent.slice(0, 26) : '',
                charState: {
                  total: chars.length,
                  waiting: chars.filter(c => c.classList.contains('waiting')).length,
                  active: chars.filter(c => c.classList.contains('active')).length,
                  on: chars.filter(c => c.classList.contains('on')).length,
                  chorus: chars.filter(c => c.classList.contains('chorus')).length
                },
                ripples: act ? act.querySelectorAll('.char-ripple').length : 0,
                activeCharColor: act ? (() => { const ac = act.querySelector('.fw-word.active .fw-body, .lyric-char.active, .lyric-char.on'); return ac ? getComputedStyle(ac).color : ''; })() : '',
                floatChorus: float ? float.classList.contains('chorus') : false,
                pendFillW: act ? (act.querySelector('.pend-fill') || {}).style ? (act.querySelector('.pend-fill') || { style: {} }).style.webkitMaskImage.slice(0, 30) : '' : '',
                bassVar: getComputedStyle(document.documentElement).getPropertyValue('--bass'),
                kickVar: getComputedStyle(document.documentElement).getPropertyValue('--kick'),
                sonnet: (() => { const all = Array.from(document.getElementById('stageView').querySelectorAll('.lyric-line.sonnet')).filter(l => !l.classList.contains('stage-exit')); const a = all[all.length - 1]; return a ? Array.from(a.querySelectorAll('.sn-word')).map(w => ({ cls: w.className, tf: w.style.transform, op: w.style.opacity, text: w.textContent })) : []; })(),
                lyricDebug: window.__lyricDebug ? JSON.parse(JSON.stringify(window.__lyricDebug())) : null,
                fx: window.__fxDebug ? JSON.parse(JSON.stringify(window.__fxDebug())) : null,
                status: document.getElementById('statusLine').textContent,
                btnStyle: document.body.dataset.btnStyle || 'off',
                btnRect: (() => { const b = document.getElementById('playBtn'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); })(),
                panel: (() => { const pn = document.getElementById('bgPanel'); return { open: pn ? !pn.classList.contains('hidden') : false, tabs: Array.from(document.querySelectorAll('.bg-tab')).map(t => t.className), pages: Array.from(document.querySelectorAll('.bg-tab-page')).map(pg => pg.className), modeSeg: Array.from(document.querySelectorAll('#bgModeSeg button')).map(b => b.className) }; })(),
                mr: window.__mrDebug ? JSON.parse(JSON.stringify(window.__mrDebug())) : null,
                sw: window.MineradioSonicWorkshop && window.MineradioSonicWorkshop.getDebug ? JSON.parse(JSON.stringify(window.MineradioSonicWorkshop.getDebug())) : null,
                sonnetTiming: window.__qinSonnetTiming ? JSON.parse(JSON.stringify(window.__qinSonnetTiming())) : null,
                sre: (() => { const el = document.getElementById('sonnetRoleEmblem'); if (!el) return 'none'; const av = el.querySelector('.sre-av'); const rt = window.__sonnetRt; const theme = rt && rt.options && rt.options.theme ? rt.options.theme : null; return JSON.stringify({ op: getComputedStyle(el).opacity, kick: el.classList.contains('kick'), avBg: av ? (getComputedStyle(av).backgroundImage || '').slice(0, 64) : '', theme: theme ? (theme.primaryColor + '|' + theme.accentColor + '|' + theme.secondaryColor) : 'none' }); })(),
                orn: (() => { const orned = Array.from(document.querySelectorAll('#lyricFloat [data-orn="1"]')); const c = orned[0] || null; if (!c) return 'count:0|no-orn-char'; const cs = getComputedStyle(c, '::after'); return 'count:' + orned.length + '|' + (cs.content || '') + '|anim:' + (cs.animationName || '') + '|bg:' + (cs.backgroundImage || '').slice(0, 44); })(),
                mrPixels: window.__mrPixels ? JSON.parse(JSON.stringify(window.__mrPixels())) : null
              });
            })()`);
            console.log('DOM STATE: ' + state);
            if (query && query.mode === 'stage') {
              await mainWindow.webContents.executeJavaScript(`document.getElementById('stageView').classList.add('mr-only'); true`);
              await new Promise((r) => setTimeout(r, 350));
            }
            if (query && query.panel === '1') {
              await mainWindow.webContents.executeJavaScript(`document.getElementById('bgToggle').click(); true`);
              await new Promise((r) => setTimeout(r, 450));
            }
            if (query && query.tab) {
              await mainWindow.webContents.executeJavaScript(`(() => { const t = document.querySelector('.bg-tab[data-tab="' + ${JSON.stringify(query.tab)} + '"]'); if (t) t.click(); return true; })()`);
              await new Promise((r) => setTimeout(r, 400));
            }
            if (query && query.panel === '1') {
              const panelState = await mainWindow.webContents.executeJavaScript(`JSON.stringify((() => ({
                open: !document.getElementById('bgPanel').classList.contains('hidden'),
                tabs: Array.from(document.querySelectorAll('.bg-tab')).map(t => t.className),
                pages: Array.from(document.querySelectorAll('.bg-tab-page')).map(pg => pg.className),
                pageInfo: Array.from(document.querySelectorAll('.bg-tab-page')).map(pg => ({ page: pg.dataset.page, hidden: pg.classList.contains('hidden'), kids: pg.childElementCount, first: ((pg.firstElementChild || {}).textContent || '').trim().slice(0, 14) })),
                artRow: document.getElementById('bgArknightsRow').style.display,
                styleSeg: Array.from(document.querySelectorAll('#bgStyleSeg button')).map(b => b.className),
                btnStyle: document.body.dataset.btnStyle || 'off',
                themeAv: (document.getElementById('arkThemeAv').src || '').slice(-36),
                arkBgSrc: (document.getElementById('arkBg').style.backgroundImage || '').slice(0, 60),
                artThumbs: document.querySelectorAll('#bgArtSeg button').length,
                msLogo: !!document.querySelector('.ark-ms'),
                activityStrip: !!document.querySelector('.ark-activity-strip'),
                logoBg: (getComputedStyle(document.querySelector('.logo-mark')).backgroundImage || '').slice(0, 60),
                btnAvBefore: (() => { const b = document.querySelector('#bgModeSeg button.active'); return b ? (getComputedStyle(b, '::before').backgroundImage || '').slice(0, 64) : 'none'; })(),
                btnAvMode: (() => { const b = document.querySelector('#lyricModeBar .mode-btn.active'); return b ? (getComputedStyle(b, '::before').backgroundImage || '').slice(0, 64) : 'none'; })(),
                btnAvNav: (() => { const b = document.querySelector('.nav-btn.active'); return b ? (getComputedStyle(b, '::before').backgroundImage || '').slice(0, 64) : 'none'; })(),
                btnAvCtl: (() => { const b = document.getElementById('playBtn'); return b ? (getComputedStyle(b, '::after').backgroundImage || '').slice(0, 64) : 'none'; })(),
                btnAvMini: (() => { const b = document.getElementById('likeBtn'); return b ? (getComputedStyle(b, '::after').backgroundImage || '').slice(0, 64) : 'none'; })(),
                wrap: (() => { const sel = ['#bgPanel .bg-row','#bgPanel .seg button','#bgPanel .mode-btn','#bgPanel .bg-label','#bgPanel .bg-tab','#bgPanel .char-card','#bgPanel .ai-preset','#bgPanel .mr-param > span','#bgPanel .preset-grid button','#bgPanel .ai-card','#bgPanel .ai-input','#bgPanel .we-wall-item','#extraPanel .extra-row','#extraPanel .extra-label','#extraPanel .seg button'].join(','); return Array.from(document.querySelectorAll(sel)).filter(function (el) { return el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2; }).map(function (el) { return (el.id || el.className || el.tagName) + ':' + (el.textContent || '').trim().slice(0, 16) + '[' + el.clientWidth + '/' + el.scrollWidth + 'x' + el.clientHeight + '/' + el.scrollHeight + ']'; }); })(),
                geo: (() => {
                  const panel = document.getElementById('bgPanel');
                  const pr = panel.getBoundingClientRect();
                  const page = panel.querySelector('.bg-tab-page:not(.hidden)');
                  if (!page) return 'none';
                  const rows = Array.from(page.querySelectorAll('.bg-row, .ai-card, .bg-divider, .bg-section, .preset-grid, .seg, .ai-actions, .we-wall-grid, .we-wall-head, .art-grid, .char-grid, .bg-row-inline')).map(function (el) {
                    const r = el.getBoundingClientRect();
                    return (el.id || (typeof el.className === 'string' ? el.className.split(' ')[0] : '') || el.tagName).slice(0, 22) + '|' + Math.round(r.left - pr.left) + ',' + Math.round(r.top - pr.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
                  });
                  return 'W' + Math.round(pr.width) + 'xH' + Math.round(pr.height) + ' scroll:' + page.scrollHeight + '/' + page.clientHeight + ' :: ' + rows.join(' ~ ');
                })()
              }))())`);
              console.log('PANEL STATE: ' + panelState);
            }
            if (process.argv.includes('--badge-test')) {
              try {
                await mainWindow.webContents.executeJavaScript("window.__qinLoadLyrics(186016, 'netease', { name: 'qingtian', artist: '' }); true");
                await new Promise((r) => setTimeout(r, 3500));
                const st = await mainWindow.webContents.executeJavaScript("JSON.stringify((() => { const b = document.getElementById('lyricSrcBadge'); return b ? { text: b.textContent, cls: b.className, hidden: b.classList.contains('hidden') } : 'missing'; })())");
                console.log('BADGE TEST: ' + st);
              } catch (err) { console.log('BADGE TEST FAILED: ' + err); }
            }
            if (process.argv.includes('--open-account')) {
              try {
                await mainWindow.webContents.executeJavaScript("document.querySelector('#loginBtn').dispatchEvent(new MouseEvent('mouseenter')); true");
                await new Promise((r) => setTimeout(r, 420));
              } catch (err) { /* 忽略 */ }
            }
            if (process.argv.includes('--open-extra')) {
              try {
                await mainWindow.webContents.executeJavaScript("document.getElementById('fxBtn').click(); true");
                await new Promise((r) => setTimeout(r, 420));
              } catch (err) { /* 忽略 */ }
            }
            if (process.argv.includes('--open-ai')) {
              try {
                await mainWindow.webContents.executeJavaScript("document.getElementById('aiToggle').click(); true");
                await new Promise((r) => setTimeout(r, 420));
              } catch (err) { /* 忽略 */ }
            }
            mainWindow.setSize(1362, 862);
            await new Promise((r) => setTimeout(r, 250));
            mainWindow.setSize(1360, 860);
            await new Promise((r) => setTimeout(r, 250));
            const image = await mainWindow.webContents.capturePage();
            fs.writeFileSync(out, image.toPNG());
            console.log('SHOT SAVED: ' + out);
          } catch (err) {
            console.log('SHOT FAILED: ' + err);
          }
          app.quit();
        }, 2200);
      } else if (dbgMode === '--shot-home') {
        const fs = require('fs');
        const out = process.argv[process.argv.indexOf('--shot-home') + 1] || 'home-shot.png';
        setTimeout(async () => {
          try {
            await mainWindow.webContents.executeJavaScript(`document.getElementById('homeView').classList.remove('hidden'); true`);
            const styleIdx = process.argv.indexOf('--demo-btnstyle');
            if (styleIdx >= 0 && process.argv[styleIdx + 1]) {
              await mainWindow.webContents.executeJavaScript('if (window.__setBtnStyle) window.__setBtnStyle(' + JSON.stringify(process.argv[styleIdx + 1]) + '); true');
            }
            await new Promise(r => setTimeout(r, 700));
            const state = await mainWindow.webContents.executeJavaScript(`JSON.stringify({
              cards: document.getElementById('playlistGrid').children.length,
              hero: (document.querySelector('.hero-title') || {}).textContent,
              liked: (document.querySelector('.liked-card .pl-name') || {}).textContent,
              arkTheme: document.body.classList.contains('ark-theme'),
              activityStrip: !!document.querySelector('.ark-activity-strip'),
              activityItems: document.querySelectorAll('.ark-activity-item').length,
              themeAv: (document.getElementById('arkThemeAv').src || '').slice(-40),
              logoBg: (getComputedStyle(document.querySelector('.logo-mark')).backgroundImage || '').slice(0, 60),
              acc: (() => { const g = (sel) => { const el = document.querySelector(sel); return el ? (el.className || '').toString() : 'none'; }; const vis = (id) => { const el = document.getElementById(id); return el ? (el.classList.contains('hidden') ? 'hidden' : 'shown') : 'missing'; }; return JSON.stringify({ netPlat: g('.ap-plat[data-p="netease"]'), qqPlat: g('.ap-plat[data-p="qq"]'), netVipRow: vis('apVipRow'), qqVipRow: vis('apQqVipRow'), netVipText: (document.getElementById('apVipText')||{}).textContent || '', qqVipText: (document.getElementById('apQqVipText')||{}).textContent || '' }); })(),
              btnStyle: document.body.dataset.btnStyle || '',
              topbar: (() => { const tb = document.getElementById('topbar'); if (!tb) return 'none'; const btns = Array.from(document.querySelectorAll('.nav-btn, .pill, .login-btn, .ark-theme-btn, .gradient-btn')); return JSON.stringify({ clientW: tb.clientWidth, scrollW: tb.scrollWidth, wrap: btns.filter(b => b.scrollHeight > b.clientHeight + 2).map(b => (b.textContent || '').trim()) }); })(),
              c1h: getComputedStyle(document.documentElement).getPropertyValue('--c1h').trim()
            })`);
            console.log('HOME STATE: ' + state);
            mainWindow.setSize(1362, 862);
            await new Promise((r) => setTimeout(r, 250));
            mainWindow.setSize(1360, 860);
            await new Promise((r) => setTimeout(r, 250));
            const image = await mainWindow.webContents.capturePage();
            fs.writeFileSync(out, image.toPNG());
            console.log('HOME SHOT SAVED: ' + out);
          } catch (err) { console.log('SHOT FAILED: ' + err); }
          app.quit();
        }, 3600);
      } else if (dbgMode === '--dom') {
        setTimeout(async () => {
          try {
            const texts = await mainWindow.webContents.executeJavaScript(`(async function(){
              const st0 = await window.api.getLoginState();
              const liked = st0 && st0.userId ? await window.api.likedSongsCached(st0.userId).catch(() => null) : null;
              const s0 = liked && liked.songs && liked.songs[0];
              const t0 = Date.now();
              const u = s0 ? await window.api.resolveUrl(s0.id).catch(() => null) : null;
              return JSON.stringify({
                placeholder: document.getElementById('searchInput').placeholder,
                searchBtn: document.getElementById('searchBtn').textContent,
                loginBtn: document.getElementById('loginBtn').textContent,
                emptyTitle: document.querySelector('.empty-title').textContent,
                logoSub: document.querySelector('.logo-sub').textContent,
                fmTitle: (document.querySelector('#fmBtn') || {}).textContent,
                activeNav: document.querySelector('.nav-btn.active').textContent,
                playlistCount: document.getElementById('playlistGrid').children.length,
                status: document.getElementById('statusLine').textContent,
                likedCached: liked ? { name: liked.name, n: (liked.songs || []).length, err: !!liked.error } : null,
                resolveProbe: { song: s0 ? s0.id : null, ms: Date.now() - t0, url: u && u.url ? u.url.slice(0, 64) : (u ? String(u).slice(0, 64) : null), len: u && u.url ? u.url.length : (u ? String(u).length : 0), level: u && u.level ? u.level : null },
                loginState: await window.api.getLoginState(),
                features: {
                  speed: (document.getElementById('speedBtn') || {}).textContent,
                  timer: !!document.getElementById('timerBtn'),
                  fx: !!document.getElementById('fxBtn'),
                  mini: !!document.getElementById('miniBtn'),
                  panel: !!document.getElementById('extraPanel'),
                  speedSegBtns: document.querySelectorAll('#speedSeg button').length,
                  fxSwitches: document.querySelectorAll('#fxBassSw,#fxTrebleSw,#fxSpaceSw').length
                }
              });
            })()`);
            console.log('DOM TEXTS: ' + texts);
            try { console.log('INIT COUNT: ' + (await mainWindow.webContents.executeJavaScript('window.__aiInitCount || 0'))); } catch (err) { /* 忽略 */ }
            try { console.log('SCRIPT CHECK: ' + (await mainWindow.webContents.executeJavaScript('JSON.stringify({ scripts: Array.from(document.querySelectorAll("script")).map(function(s){ return s.getAttribute("src") || "inline"; }), bodyChild: document.body.children.length })'))); } catch (err) { /* 忽略 */ }
          } catch (err) {
            console.log('DOM CHECK FAILED: ' + err);
          }
          app.quit();
        }, 1200);
      } else if (dbgMode === '--shot-intro') {
        const fs = require('fs');
        const out = process.argv[process.argv.indexOf('--shot-intro') + 1] || 'intro-shot.png';
        setTimeout(async () => {
          try {
            const styleIdx = process.argv.indexOf('--demo-btnstyle');
            if (styleIdx >= 0 && process.argv[styleIdx + 1]) {
              await mainWindow.webContents.executeJavaScript('if (window.__setBtnStyle) window.__setBtnStyle(' + JSON.stringify(process.argv[styleIdx + 1]) + '); true');
            }
            await new Promise(r => setTimeout(r, 1400));
            const state = await mainWindow.webContents.executeJavaScript(`JSON.stringify({
              intro: !!document.getElementById('introSplash'),
              introLogoBg: (() => { const el = document.querySelector('.intro-logo'); return el ? (getComputedStyle(el).backgroundImage || '').slice(0, 70) : 'none'; })(),
              introLogoQ: (() => { const el = document.querySelector('.intro-logo'); return el ? el.textContent : ''; })(),
              introArk: !!document.querySelector('.intro-ark'),
              introTitle: (() => { const el = document.querySelector('.intro-title'); return el ? el.textContent : ''; })(),
              logoBg: (getComputedStyle(document.querySelector('.logo-mark')).backgroundImage || '').slice(0, 70),
              btnStyle: document.body.dataset.btnStyle || ''
            })`);
            console.log('INTRO STATE: ' + state);
            mainWindow.setSize(1362, 862);
            await new Promise((r) => setTimeout(r, 250));
            mainWindow.setSize(1360, 860);
            await new Promise((r) => setTimeout(r, 250));
            const image = await mainWindow.webContents.capturePage();
            fs.writeFileSync(out, image.toPNG());
            console.log('SHOT SAVED: ' + out);
          } catch (err) { console.log('SHOT INTRO FAILED: ' + err); }
          app.quit();
        }, 1800);
      } else if (dbgMode === '--mini-test') {
        setTimeout(async () => {
          try {
            await mainWindow.webContents.executeJavaScript('window.api.toggleMini()');
            await mainWindow.webContents.executeJavaScript("document.getElementById('fmBtn').click(); true");
            await new Promise(r => setTimeout(r, 5500));
            const miniTexts = (miniWindow && !miniWindow.isDestroyed())
              ? await miniWindow.webContents.executeJavaScript(`JSON.stringify({ title: document.getElementById('title').textContent, artist: document.getElementById('artist').textContent, playing: document.getElementById('eq').classList.contains('on'), bar: document.getElementById('barFill').style.width, cur: document.getElementById('cur').textContent })`)
              : 'NO MINI WINDOW';
            console.log('MINI LIVE: ' + miniTexts);
            const mainTexts = await mainWindow.webContents.executeJavaScript(`JSON.stringify({ fmActive: document.getElementById('statusLine').textContent, title: document.getElementById('pbTitle').textContent, miniOn: document.getElementById('miniBtn').classList.contains('on') })`);
            console.log('MAIN LIVE: ' + mainTexts);
          } catch (err) { console.log('MINI TEST FAILED: ' + err); }
          app.quit();
        }, 1600);
      } else if (dbgMode === '--net-vip-diag') {
        setTimeout(async () => {
          const out = {};
          try {
            const st = await loginState();
            out.loginState = { loggedIn: st.loggedIn, nickname: st.nickname, userId: st.userId, vipType: st.vipType, vipLabel: st.vipLabel, vipLevel: st.vipLevel, vipExpire: st.vipExpire };
            const ctx = await (async () => {
              try {
                const s2 = await loginState();
                const r = { loggedIn: !!s2.userId, likedN: 0, hotN: 0, dailyN: 0 };
                if (s2.userId) {
                  const liked = await likedSongsFor(s2.userId).catch(() => null);
                  r.likedN = liked && liked.songs ? liked.songs.length : -1;
                  const daily = await fetchJson(`${BASE}/api/v3/discovery/recommend/songs`).catch(() => null);
                  r.dailyN = daily && daily.data && daily.data.dailySongs ? daily.data.dailySongs.length : -1;
                }
                const d = await fetchJson(`${BASE}/api/v6/playlist/detail?id=3778678&n=5&s=8`).catch(() => null);
                r.hotN = d && d.playlist && d.playlist.tracks ? d.playlist.tracks.length : -1;
                return r;
              } catch (e) { return { err: String(e && e.message || e) }; }
            })();
            out.ctx = ctx;
          } catch (err) { out.err = String(err && err.message || err); }
          console.log('NETVIPDIAG: ' + JSON.stringify(out));
          app.quit();
        }, 1500);
      } else if (dbgMode === '--lyric-diag') {
        setTimeout(async () => {
          try {
            const out = await mainWindow.webContents.executeJavaScript(`(async function () {
              var res = {};
              function rcheck(label, yrc, lrc) {
                try { res[label] = window.__lyricParseDiag(yrc || '', lrc || ''); }
                catch (e) { res[label] = { err: String(e && e.message || e) }; }
              }
              try {
                var qq = await window.api.lyric('003UkWuI0E8U0l', 'qq', { name: '孤勇者', artist: '陈奕迅', songmid: '003UkWuI0E8U0l', songid: 331839675 });
                res.qq = { lrcLen: (qq.lrc || '').length, yrcLen: (qq.yrc || '').length, src: qq.src || '', yrcHead: (qq.yrc || '').slice(0, 60) };
                rcheck('renderQQ', qq.yrc, qq.lrc);
                var wy = await window.api.lyric(347230, 'netease', { name: '海阔天空', artist: 'Beyond' });
                res.wy = { lrcLen: (wy.lrc || '').length, yrcLen: (wy.yrc || '').length, src: wy.src || '', yrcHead: (wy.yrc || '').slice(0, 60) };
                rcheck('renderWY', wy.yrc, wy.lrc);
                var wy2 = await window.api.lyric(186016, 'netease', { name: '晴天', artist: '周杰伦' });
                res.wy2 = { lrcLen: (wy2.lrc || '').length, yrcLen: (wy2.yrc || '').length, src: wy2.src || '', yrcHead: (wy2.yrc || '').slice(0, 60) };
                rcheck('renderWY2', wy2.yrc, wy2.lrc);
                var wy3 = await window.api.lyric(483671599, 'netease', { name: '追光者', artist: '岑宁儿' });
                res.wy3 = { lrcLen: (wy3.lrc || '').length, yrcLen: (wy3.yrc || '').length, src: wy3.src || '', yrcHead: (wy3.yrc || '').slice(0, 60) };
                rcheck('renderWY3', wy3.yrc, wy3.lrc);
                var wyf = await window.api.lyricFast(385781, 'netease', { name: '突然好想你', artist: '五月天' });
                res.wyFast = { lrcLen: (wyf.lrc || '').length, yrcLen: (wyf.yrc || '').length, src: wyf.src || '' };
              } catch (e) { res.err = String(e && e.message || e); }
              return JSON.stringify(res);
            })()`);
            console.log('LYRICDIAG: ' + out);
          } catch (err) { console.log('LYRICDIAG FAILED: ' + err); }
          app.quit();
        }, 1500);
      } else if (dbgMode === '--amll-diag') {
        setTimeout(async () => {
          try {
            const ids = [186016, 1901371647, 449818741, 347230, 1330348068, 32507038, 66842, 3404940564, 65529, 185827, 185806, 417792847, 33926906, 569213220, 33211670, 523042066, 416584949, 30859891, 189429, 27628465];
            const probeUrls = [
              'https://amll-ttml-db.stevexmh.net/ncm/65529?format=ttml',
              'https://gcore.jsdelivr.net/gh/steve-xmh/amll-ttml-db@main/ncm-lyrics/65529.ttml',
              'https://fastly.jsdelivr.net/gh/steve-xmh/amll-ttml-db@main/ncm-lyrics/65529.ttml',
              'https://ghfast.top/https://raw.githubusercontent.com/steve-xmh/amll-ttml-db/main/ncm-lyrics/65529.ttml'
            ];
            const probe = {};
            for (const u of probeUrls) {
              const t0 = Date.now();
              try {
                const ctrl = new AbortController();
                const tm = setTimeout(() => ctrl.abort(), 6000);
                const res = await net.fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' } });
                clearTimeout(tm);
                const txt = res.ok ? await res.text() : '';
                probe[u.split('/')[2]] = (Date.now() - t0) + 'ms ' + res.status + ' len=' + txt.length + ' ttml=' + /<tt[\s>]/i.test(txt);
              } catch (err) { probe[u.split('/')[2]] = (Date.now() - t0) + 'ms ERR ' + String(err && err.message || err).slice(0, 60); }
            }
            const out = { probe: probe, ids: {} };
            for (const id of ids) {
              const t0 = Date.now();
              const ttml = await amllTtml('ncm', id);
              out.ids[id] = { ok: !!ttml, ms: Date.now() - t0, len: ttml ? ttml.length : 0 };
            }
            console.log('AMLLDIAG: ' + JSON.stringify(out));
          } catch (err) { console.log('AMLLDIAG FAILED: ' + err); }
          app.quit();
        }, 800);
      } else if (dbgMode === '--stage-diag') {
        setTimeout(async () => {
          try {
            const js = (code) => mainWindow.webContents.executeJavaScript(code);
            await js("window.__qinSetStageMode('stage'); window.__mrSetPreset(0); true");
            await new Promise((r) => setTimeout(r, 2600));
            const before = await js('window.__mrStageDiag()');
            await js("if (window.__mrSetStageParams) window.__mrSetStageParams({ density: 1.15, point: 1.6, speed: 1.4, twist: 0.12, color: 1.4, bloom: 0.9, zoom: 5.2, spinSens: 1.5, mousePush: 1.2, audioSens: 1.3, timeScale: 1.2, lyricFollow: true }); true");
            await new Promise((r) => setTimeout(r, 1400));
            const after = await js('window.__mrStageDiag()');
            const dom = await js('(() => {\n' + "const row = document.getElementById('mrParamRow');\nconst list = document.getElementById('mrParamList');\nconst sliders = list ? Array.from(list.querySelectorAll('input[data-p]')).map(function (i2) { return i2.dataset.p + '=' + i2.value; }) : [];\nreturn { rowExists: !!row, rowHidden: row ? row.classList.contains('hidden') : null, sliders: sliders, toggleCls: (function () { var ft = document.getElementById('mrLyricFollowToggle'); return ft ? ft.className : null; })() };"+ '\n})()');
            await js("const cv = document.getElementById('mrStage');\nconst rect = cv.getBoundingClientRect();\nconst cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;\nconst ev = (t, x, y) => new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });\ncv.dispatchEvent(ev('mousedown', cx, cy));\nwindow.dispatchEvent(ev('mousemove', cx + 140, cy - 60));\nwindow.dispatchEvent(ev('mousemove', cx + 260, cy - 130));\ntrue");
            await new Promise((r) => setTimeout(r, 3200));
            const moved = await js('window.__mrStageDiag()');
            await js("window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 })); true");
            await js("var ft = document.getElementById('mrLyricFollowToggle'); if (ft) ft.click(); true");
            await new Promise((r) => setTimeout(r, 900));
            const toggledOff = await js('window.__mrStageDiag()');
            await js("var ft = document.getElementById('mrLyricFollowToggle'); if (ft) ft.click(); true");
            await new Promise((r) => setTimeout(r, 900));
            const toggledOn = await js('window.__mrStageDiag()');
            console.log('STAGEDIAG: ' + JSON.stringify({ before, after, moved, toggledOff, toggledOn, dom }));
          } catch (err) { console.log('STAGEDIAG FAILED: ' + err); }
          app.quit();
        }, 1500);
      } else if (dbgMode === '--ai-diag') {      } else if (dbgMode === '--ai-diag') {
        setTimeout(async () => {
          try {
            await mainWindow.webContents.executeJavaScript(`document.getElementById('stageView').classList.remove('hidden'); true`);
            const out = await mainWindow.webContents.executeJavaScript(`JSON.stringify((() => {
              const lb = document.getElementById('loginBtn');
              const vr = document.getElementById('apVipRow');
              const qt = Array.from(document.querySelectorAll('.bg-tab')).map(t => t.dataset.tab);
              const aiP = document.getElementById('aiPanel');
              const aiT = document.getElementById('aiToggle');
              return {
                loginBtnClasses: lb ? lb.className : '',
                loginBtnText: lb ? lb.textContent : '',
                vipRowClasses: vr ? vr.className : '',
                vipText: document.getElementById('apVipText') ? document.getElementById('apVipText').textContent : '',
                bgTabs: qt,
                aiPanelExists: !!aiP, aiToggleExists: !!aiT,
                aiToggleVisible: aiT ? aiT.classList.contains('visible') : false
              };
            })())`);
            console.log('AIDIAG: ' + out);
            try {
              const errors = [];
              const onErr = (_e, level, msg) => { if (level === 'error' || /uncaught|typeerror|referenceerror|syntaxerror/i.test(msg || '')) errors.push(String(msg).slice(0, 200)); };
              mainWindow.webContents.on('console-message', onErr);
              const flow = await mainWindow.webContents.executeJavaScript(`(async function () {
                var log = {};
                try {
                  log.loginBtn = document.getElementById('loginBtn').className;
                  localStorage.setItem('qin-ai-config', JSON.stringify({ base: 'http://127.0.0.1:18888/v1', key: 'sk-mock', model: 'mock-model', enabled: true }));
                  document.getElementById('aiToggle').click();
                  await new Promise(function (r) { setTimeout(r, 250); });
                  log.aiPanelOpen = !document.getElementById('aiPanel').classList.contains('hidden');
                  log.aiPanelClsAfter = document.getElementById('aiPanel').className;
                  log.aiToggleCls = document.getElementById('aiToggle').className;
                  log.hasToggle = typeof window.__toggleAiPanel === 'function';
                  log.initCount = window.__aiInitCount || 0;
                  log.initLog = JSON.stringify(window.__aiInitLog || []).slice(0, 400);
                  log.resources = JSON.stringify((performance.getEntriesByType('resource') || []).filter(function (r) { return r.name.indexOf('app.js') >= 0; }).map(function (r) { return r.name.slice(-20); })).slice(0, 300);
                  log.clickLog0 = (window.__aiClickLog || []).slice();
                  document.getElementById('aiToggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  await new Promise(function (r) { setTimeout(r, 120); });
                  log.clickLog1 = (window.__aiClickLog || []).slice();
                  log.aiPanelClsAfterDispatch = document.getElementById('aiPanel').className;
                  log.samePanel = window.__aiPanelEl === document.getElementById('aiPanel');
                  if (log.hasToggle) { window.__toggleAiPanel(); await new Promise(function (r) { setTimeout(r, 120); }); log.aiPanelClsAfter2 = document.getElementById('aiPanel').className; window.__toggleAiPanel(); }
                  var chip = document.querySelector('.ai-chip[data-ctx="liked"]');
                  chip.click();
                  await new Promise(function (r) { setTimeout(r, 2600); });
                  var msgs = Array.from(document.querySelectorAll('#aiMessages .ai-msg-bubble')).map(function (b) { return b.textContent; });
                  log.msgCount = msgs.length;
                  log.last = (msgs[msgs.length - 1] || '').slice(0, 100);
                  document.getElementById('aiPanelClose').click();
                  document.getElementById('bgToggle').click();
                  await new Promise(function (r) { setTimeout(r, 250); });
                  var aiTab = document.querySelector('.bg-tab[data-tab="ai"]');
                  aiTab.click();
                  await new Promise(function (r) { setTimeout(r, 250); });
                  log.aiTabActive = document.querySelector('.bg-tab[data-tab="ai"]').classList.contains('active');
                  log.aiPageShown = !document.querySelector('.bg-tab-page[data-page="ai"]').classList.contains('hidden');
                  log.basePrefill = document.getElementById('aiBaseInput').value;
                  document.querySelector('.ai-preset[data-base="https://api.deepseek.com"]').click();
                  log.baseAfterPreset = document.getElementById('aiBaseInput').value;
                  document.getElementById('aiTestBtn').click();
                  await new Promise(function (r) { setTimeout(r, 1500); });
                  log.testResult = document.getElementById('aiTestResult').textContent.slice(0, 80);
                  document.getElementById('bgPanelClose').click();
                  document.getElementById('loginBtn').dispatchEvent(new MouseEvent('mouseenter'));
                  await new Promise(function (r) { setTimeout(r, 350); });
                  log.vipText = document.getElementById('apVipText').textContent;
                  log.vipRowCls = document.getElementById('apVipRow').className;
                } catch (e) { log.flowThrow = String(e && e.message || e); }
                return JSON.stringify(log);
              })()`);
              console.log('AIFLOW: ' + flow);
              await new Promise((r) => setTimeout(r, 400));
              console.log('AIERRORS: ' + JSON.stringify(errors.slice(0, 8)));
              mainWindow.webContents.removeListener('console-message', onErr);
            } catch (e) { console.log('AIFLOW_ERR: ' + e); }
            try {
              const likeTest = await mainWindow.webContents.executeJavaScript(`(async function () {
                var st = await window.api.getLoginState();
                if (!st || !st.userId) return 'no-login';
                var liked = await window.api.likedSongsCached(st.userId).catch(function () { return null; });
                var first = liked && liked.songs && liked.songs[0];
                if (!first) return 'no-liked-song';
                var r = await window.api.likeSong(first.id, true).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
                return JSON.stringify(r);
              })().then(function (s) { return s; })`);
              console.log('LIKE_TEST: ' + likeTest);
            } catch (e) { console.log('LIKE_TEST_ERR: ' + e); }
          } catch (err) { console.log('AIDIAG ERR: ' + err); }
          app.quit();
        }, 1800);
      } else if (dbgMode === '--qq-diag') {
        setTimeout(async () => {
          const out = {};
          try {
            const ck = await session.defaultSession.cookies.get({ url: 'https://y.qq.com' });
            out.cookieNames = ck.map(c => c.name).filter(n => /uin|skey|p_skey|qqmusic|tme|psrf/.test(n));
            const uin = await qqUin();
            out.uin = uin;
            const st = await qqLoginState();
            out.loginState = { loggedIn: st.loggedIn, userId: st.userId, nickname: st.nickname, vipType: st.vipType };
            out.qqVip = await qqVipInfo();
            // free song
            const free1 = await qqResolveUrlCore('002xTzGb2UBQRk', 'standard');
            out.freeLoggedIn = free1 ? (free1.url ? 'OK' : JSON.stringify(free1)) : 'NULL';
            // vip song
            const vip1 = await qqResolveUrlCore('0039MnYb0qxYhV', 'standard');
            out.vipLoggedIn = vip1 ? (vip1.url ? 'OK' : JSON.stringify(vip1)) : 'NULL';
            // liked playlist variants
            if (uin) {
              out.liked = await qqLikedDiag(uin).catch(e => ({ err: String(e && e.message || e) }));
              const dissId = await qqFindLikedDissid(uin);
              let lk = [];
              if (dissId) lk = await qqPlaylistSongs(dissId);
              if (!lk.length) lk = await qqPlaylistSongs('201' + uin);
              out.likedFlow = { dissId, n: lk.length, first: lk[0] ? lk[0].name + '|' + lk[0].artist : '' };
              if (lk[0]) {
                const rr = await qqResolveUrlCore(lk[0].id, 'standard');
                out.likedPlay = rr ? (rr.url ? 'OK' : JSON.stringify(rr)) : 'NULL';
              }
            } else {
              out.liked = 'NO UIN';
            }
          } catch (err) { out.err = String(err && err.message || err); }
          console.log('QQDIAG: ' + JSON.stringify(out));
          app.quit();
        }, 1500);
      } else if (dbgMode === '--play-diag') {
        setTimeout(async () => {
          const out = { t: [] };
          try {
            out.t.push('t0');
            out.history = await Promise.race([
              mainWindow.webContents.executeJavaScript(`(function(){
                try { return JSON.stringify((JSON.parse(localStorage.getItem('qin-history') || '[]') || []).slice(0, 3).map(h => ({ id: h.id, platform: h.platform || '', name: (h.name || '').slice(0, 18) }))); } catch(e) { return 'ERR'; }
              })()`),
              new Promise(r => setTimeout(() => r('H-TIMEOUT'), 8000))
            ]);
            out.t.push('t1');
            out.netease = await Promise.race([
              mainWindow.webContents.executeJavaScript(`api.resolveUrl('1886366521', 'exhigh', 'netease').then(r => r && r.url ? 'OK' : JSON.stringify(r)).catch(e => 'ERR ' + e.message)`),
              new Promise(r => setTimeout(() => r('N-TIMEOUT'), 40000))
            ]);
            out.t.push('t2');
            out.qq = await Promise.race([
              mainWindow.webContents.executeJavaScript(`api.resolveUrl('002xTzGb2UBQRk', 'exhigh', 'qq').then(r => r && r.url ? 'OK' : JSON.stringify(r)).catch(e => 'ERR ' + e.message)`),
              new Promise(r => setTimeout(() => r('Q-TIMEOUT'), 20000))
            ]);
            out.t.push('t3');
          } catch (err) { out.err = String(err && err.message || err); }
          console.log('PLAYDIAG: ' + JSON.stringify(out));
          app.quit();
        }, 3500);
      } else if (dbgMode === '--wall-test') {
        setTimeout(async () => {
          try {
            const wantId = process.argv[process.argv.indexOf('--wall-test') + 1] || '';
            const list = await mainWindow.webContents.executeJavaScript(`window.api.listWallpapers().then(r => JSON.stringify(r && r.list || []))`);
            const arr = JSON.parse(list);
            let pick = arr.find((x) => String(x.id) === String(wantId));
            if (!pick) pick = arr.find((x) => x.video) || arr[0] || null;
            const setRes = pick ? await mainWindow.webContents.executeJavaScript(`window.__setWallpaperTest(${JSON.stringify(pick)})`) : 'NO-ITEM';
            await new Promise((r) => setTimeout(r, 3000));
            const diag = await mainWindow.webContents.executeJavaScript(`window.__wallDiag()`);
            console.log('WALLTEST: pick=' + JSON.stringify(pick ? { id: pick.id, src: pick.src, video: pick.video, image: pick.image, preview: pick.preview } : null) + ' set=' + setRes + ' diag=' + diag);
          } catch (err) { console.log('WALLTEST FAILED: ' + err); }
          app.quit();
        }, 1500);
      } else if (dbgMode === '--dom-test') {
        setTimeout(async () => {
          try {
            const res = await mainWindow.webContents.executeJavaScript(`(async function(){
              const sleep = (ms) => new Promise(r => setTimeout(r, ms));
              const out = { neteaseCards: 0, qqCards: 0, qqFirstCard: '', qqHero: '', qqGate: false, rows: 0, badges: {}, status: '', qqSongs: 0, qqRowSrc: 0, qqRowFirst: '', qqStatus: '' };
              await sleep(300);
              out.neteaseCards = document.getElementById('playlistGrid').children.length;
              out.neteaseHero = (document.querySelector('.hero-tag')||{}).textContent || '';
              document.querySelector('.pill[data-platform="qq"]').click();
              await sleep(3500);
              out.qqCards = document.getElementById('playlistGrid').children.length;
              out.qqHero = (document.querySelector('.hero-tag')||{}).textContent || '';
              const firstQq = document.querySelector('#playlistGrid .playlist-card');
              out.qqFirstCard = firstQq ? (firstQq.querySelector('.pl-name')||{}).textContent || '' : '';
              out.qqLikedCards = Array.from(document.querySelectorAll('#playlistGrid .liked-card')).map(c => (c.querySelector('.pl-name')||{}).textContent || '');
out.qqGate = !!out.qqLikedCards.find(t => t.indexOf('登录') >= 0);
              const inp = document.getElementById('searchInput');
              inp.value = '晴天';
              document.getElementById('searchBtn').click();
              await sleep(4000);
              out.rows = document.querySelectorAll('#songList .song-row').length;
              const badges = Array.from(document.querySelectorAll('#songList .song-src')).map(b => b.textContent);
              out.badges = badges.reduce((m,t)=>{m[t]=(m[t]||0)+1;return m;},{});
              out.status = document.getElementById('statusLine').textContent;
              out.mix = Array.from(document.querySelectorAll('#songList .song-row')).slice(0, 14).map(r => (r.querySelector('.song-src')||{}).textContent || '?').join(',');
              out.vipTags = document.querySelectorAll('#songList .song-vip').length;
              out.vipBlocked = document.querySelectorAll('#songList .song-row.vip-blocked').length;
              const qqCard = Array.from(document.querySelectorAll('#playlistGrid .playlist-card')).find(c => (c.querySelector('.pl-name')||{}).textContent && c.querySelector('.pl-name').textContent.indexOf('登录') < 0 && c.querySelector('.pl-name').textContent !== '我的喜欢');
              if (qqCard) {
                qqCard.click();
                await sleep(3500);
                out.qqSongs = document.querySelectorAll('#songList .song-row').length;
                out.qqRowSrc = document.querySelectorAll('#songList .song-src.qq').length;
                const f = document.querySelector('#songList .song-row');
                out.qqRowFirst = f ? f.textContent.slice(0, 46) : '';
                out.qqStatus = document.getElementById('statusLine').textContent;
              }
              return JSON.stringify(out);
            })()`);
            console.log('DOMTEST RESULT: ' + res);
          } catch (err) { console.log('DOMTEST FAILED: ' + err); }
          app.quit();
        }, 1200);
      } else if (dbgMode === '--update-diag') {
        console.log('[update] window loaded, waiting for update check…');
      } else {
        console.log('SMOKE OK');
        setTimeout(() => app.quit(), 800);
      }
    });
  });
} else {
  app.whenReady().then(() => {
    createMainWindow();
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log('RENDERER[' + level + '] ' + sourceId + ':' + line + ' ' + message);
    });
    createTray();
    setupAutoUpdater();
    registerGlobalShortcuts();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (err) { /* 忽略 */ }
});
