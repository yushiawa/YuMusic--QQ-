import * as THREE from 'three';
import { MineradioStage } from './mineradio-stage.js';
import { WallpaperLayer } from './wallpaper.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

const searchInput = $('searchInput'), searchBtn = $('searchBtn');
const songList = $('songList'), emptyState = $('emptyState');
const statusLine = $('statusLine');
const audio = $('audio');
const playBtn = $('playBtn'), prevBtn = $('prevBtn'), nextBtn = $('nextBtn');
const progress = $('progress');
const curTime = $('curTime'), totalTime = $('totalTime'), volume = $('volume');
const pbTitle = $('pbTitle'), pbArtist = $('pbArtist'), pbCover = $('pbCover');
const stageTitle = $('stageTitle'), stageArtist = $('stageArtist'), stageStatus = $('stageStatus');
const lyricsEl = $('lyrics');
const stageGlow = $('stageGlow');
const loginBtn = $('loginBtn'), fileInput = $('fileInput');
const playlistGrid = $('playlistGrid');
const views = { home: $('homeView'), search: $('searchView'), stage: $('stageView') };

// ================= 播放状态 =================
let currentSong = null;
let queue = [];        // 播放队列（搜索歌单）
let queueIndex = -1;
let queuePanelOpen = false; // 队列面板打开时暂停高开销 3D 更新（滚动不掉帧）
let displayedList = []; // 当前列表（渲染用）
let displayedListKind = ''; // 当前列表类型：'netease-liked' / 'qq-liked' / ''
let fmActive = false;   // 私人FM 模式
let fmQueue = [];
let fmIndex = -1;
let lyricsLines = [];
let yrcLines = [];
let homeLoaded = false;

// ================= 3D 场景 =================
let scene, camera, renderer, particles, particleVel, stars, rings = [];
let fxGroup, discGroup, spectrumBars = [], beams = [], shockwaves = [];
let stream, streamVel, bokeh = [], waveLine = null;
let analyser, audioCtx, freqData = null, bass = 0, discAngle = 0;
let lowMid = 0, mid = 0, vocal = 0, treble = 0, audioPower = 0; // 5 段频带（Folia broadband energy）
let webglOk = true;
let mouseX = 0, mouseY = 0;
// 极光着色器背景（Folia latent MeshGradient 思路）
let shaderRenderer = null, shaderScene = null, shaderUniforms = null, shaderBgOk = false, shaderCamera = null;
let mrStage = null;
let wallpaperLayer = null;
let weWallpapers = [];
// ===== 星河（Mineradio star-river 移植）：GPU 粒子河在歌词后方流淌 =====
const STAR_RIVER_VS = `
precision highp float;
attribute float seed, lane, depthSeed;
uniform float uTime, uPixel, uBass, uBeat, uChorus, uWidth, uHeight;
varying float vSeed, vLane, vGlow;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float laneBand = floor(lane * 5.0);
  float laneLocal = fract(lane * 5.0);
  float speed = 0.030 + hash(seed * 1.71) * 0.055 + laneBand * 0.005 + uChorus * 0.020;
  float flow = fract(hash(seed * 2.13) + uTime * speed);
  float x = (flow - 0.5) * uWidth * (1.08 + hash(seed * 5.1) * 0.18);
  float curve = sin(flow * 6.2831853 * (0.92 + hash(seed * 4.0) * 0.46) + seed * 0.071 + uTime * 0.34);
  float breath = sin(uTime * (0.42 + hash(seed * 6.9) * 0.42) + seed * 0.093);
  float y = (laneBand - 2.0) * uHeight * 0.135 + curve * uHeight * (0.20 + hash(seed * 9.0) * 0.18) + (laneLocal - 0.5) * uHeight * 0.16 + breath * uHeight * 0.10;
  float z = -0.08 + (depthSeed - 0.5) * 0.44 + sin(uTime * (0.18 + hash(seed) * 0.24) + seed) * 0.08;
  vec3 pos = vec3(x, y, z);
  float edge = smoothstep(0.0, 0.18, flow) * (1.0 - smoothstep(0.82, 1.0, flow));
  vSeed = seed;
  vLane = lane;
  vGlow = edge * (0.62 + 0.38 * sin(uTime * (0.9 + hash(seed * 8.0) * 0.7) + seed));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = max(0.45, -mv.z);
  float size = (0.058 + hash(seed * 12.0) * 0.062 + vGlow * 0.040 + uBeat * 0.018) * (1.0 + uBass * 0.18 + uChorus * 0.10);
  gl_PointSize = clamp(size * uPixel * 120.0 / dist, 1.2, 15.0);
  gl_Position = projectionMatrix * mv;
}`;
const STAR_RIVER_FS = `
precision highp float;
uniform sampler2D uMap;
uniform vec3 uColorA, uColorB, uColorC;
uniform float uOpacity, uTime, uBeat, uChorus;
varying float vSeed, vLane, vGlow;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.02) discard;
  float tw = pow(0.5 + 0.5 * sin(uTime * (0.55 + fract(vSeed) * 0.35) + vSeed), 4.0);
  vec3 col = mix(uColorA, uColorB, smoothstep(0.12, 0.92, vLane) * 0.45 + tw * 0.42 + vGlow * 0.26);
  col = mix(col, uColorC, uChorus * (0.32 + tw * 0.34));
  float alpha = tex.a * uOpacity * (0.30 + vGlow * 0.85 + tw * 0.36 + uBeat * 0.14);
  gl_FragColor = vec4(col * (0.82 + vGlow * 0.72 + tw * 0.32), alpha);
}`;
let starRiver = null;
const starRiverTmpA = new THREE.Color(), starRiverTmpB = new THREE.Color(), starRiverTmpC = new THREE.Color();
function ensureMrStage() {
  if (mrStage) {
    if (stageMode === 'stage') mrStage.setVisible(true);
    return mrStage;
  }
  const cv = document.getElementById('mrStage');
  if (!cv) return null;
  try {
    mrStage = new MineradioStage(cv);
    mrStage.setPreset(savedMrPreset(), { silent: true, noSave: true });
    applyMrParamsToStage();
    mrStage.setVisible(stageMode === 'stage');
    return mrStage;
  } catch (err) {
    console.error('Mineradio stage failed:', err);
    mrStage = null;
    return null;
  }
}
function ensureStarRiver() {
  if (starRiver) return starRiver;
  try {
    const count = 1400;
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count);
    const lanes = new Float32Array(count);
    const depths = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seeds[i] = Math.random() * 1000;
      lanes[i] = Math.random();
      depths[i] = Math.random();
    }
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('lane', new THREE.BufferAttribute(lanes, 1));
    geo.setAttribute('depthSeed', new THREE.BufferAttribute(depths, 1));
    const dotCv = document.createElement('canvas');
    dotCv.width = dotCv.height = 64;
    const dotG = dotCv.getContext('2d');
    const dotR = dotG.createRadialGradient(32, 32, 0, 32, 32, 32);
    dotR.addColorStop(0, 'rgba(255,255,255,0.95)');
    dotR.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    dotR.addColorStop(1, 'rgba(255,255,255,0)');
    dotG.fillStyle = dotR;
    dotG.fillRect(0, 0, 64, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: (renderer ? renderer.getPixelRatio() : 1) * 1500 },
        uBass: { value: 0 },
        uBeat: { value: 0 },
        uChorus: { value: 0 },
        uWidth: { value: 900 },
        uHeight: { value: 230 },
        uOpacity: { value: 0 },
        uMap: { value: new THREE.CanvasTexture(dotCv) },
        uColorA: { value: new THREE.Color().setHSL(0.55, 0.95, 0.72) },
        uColorB: { value: new THREE.Color().setHSL(0.75, 0.9, 0.7) },
        uColorC: { value: new THREE.Color().setHSL(0.08, 0.95, 0.72) }
      },
      vertexShader: STAR_RIVER_VS,
      fragmentShader: STAR_RIVER_FS,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 30;
    points.position.set(0, 0, 60);
    scene.add(points);
    starRiver = points;
  } catch (err) { starRiver = null; }
  return starRiver;
}
// 歌词行尺寸缓存：仅在换行时读取一次 offsetWidth/offsetHeight，避免逐帧强制同步布局（星海河流卡顿根因）
let _lineMetricIdx = -1, _lineMetricW = 0, _lineMetricH = 0;
function refreshStageLineMetric() {
  _lineMetricIdx = stageLineIdx;
  const el = stageLineEl;
  _lineMetricW = el ? el.offsetWidth : 0;
  _lineMetricH = el ? el.offsetHeight : 0;
}
function stageLineMetricW() {
  if (_lineMetricIdx !== stageLineIdx) refreshStageLineMetric();
  return _lineMetricW;
}
function stageLineMetricH() {
  if (_lineMetricIdx !== stageLineIdx) refreshStageLineMetric();
  return _lineMetricH;
}
function updateStarRiver(dt, t) {
  if (REMOVED_STAGE_MODES.indexOf(stageMode) >= 0) return;
  const river = ensureStarRiver();
  if (!river || !river.material || !river.material.uniforms) return;
  const on = stageMode === 'star-river' && !stageViewEl.classList.contains('hidden');
  const u = river.material.uniforms;
  const targetOp = on ? 1.25 : 0;
  u.uOpacity.value += (targetOp - u.uOpacity.value) * Math.min(1, dt * (on ? 3.2 : 2.2));
  if (!on && u.uOpacity.value < 0.012) { river.visible = false; return; }
  river.visible = true;
  u.uTime.value = t;
  u.uBass.value = bass;
  u.uBeat.value = beatKick;
  u.uChorus.value = chorusLevel;
  // 河面宽度贴合当前歌词行（Mineradio：river 随歌词排版伸缩）
  const visH = 2 * (camera.position.z - 60) * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const visW = visH * camera.aspect;
  const lineW = stageLineMetricW();
  const lineH = stageLineMetricH();
  const tw = lineW > 20 ? (lineW / Math.max(1, innerWidth)) * visW * 1.14 : visW * 0.6;
  const th = visH * 0.25 + (lineH ? (lineH / Math.max(1, innerHeight)) * visH * 0.9 : 0);
  const targetW = Math.max(420, Math.min(1600, tw));
  const targetH = Math.max(150, Math.min(360, th));
  u.uWidth.value += (targetW - u.uWidth.value) * Math.min(1, dt * 5);
  u.uHeight.value += (targetH - u.uHeight.value) * Math.min(1, dt * 4.5);
  // 主题色随封面取色流动
  starRiverTmpA.setHSL(curHue / 360, 0.95, 0.72);
  starRiverTmpB.setHSL(((curHue + 70) % 360) / 360, 0.9, 0.68);
  starRiverTmpC.setHSL(((curHue + 26) % 360) / 360, 0.95, 0.73);
  u.uColorA.value.lerp(starRiverTmpA, Math.min(1, dt * 3));
  u.uColorB.value.lerp(starRiverTmpB, Math.min(1, dt * 3));
  u.uColorC.value.lerp(starRiverTmpC, Math.min(1, dt * 3));
  // 整条星河轻缓漂移（Mineradio camera drift）
  river.position.y = Math.sin(t * 0.31) * 10 + Math.cos(t * 0.79) * 4;
  river.position.z = 60 + Math.sin(t * 0.22) * 6;
  river.rotation.z = Math.sin(t * 0.17) * 0.008;
}

// ===== 星河前置粒子层：粒子在歌词之上加色流动（Mineraudio renderOrder=45 位于歌词之上） =====
let srFrontCtx = null, srFrontCanvas = null, srFrontParts = [];
let srFrontW = 0, srFrontH = 0, srFrontLast = 0, srFrontOrbs = [];
function ensureSrFront() {
  if (srFrontCtx) return srFrontCtx;
  srFrontCanvas = document.getElementById('sparkCanvas');
  if (!srFrontCanvas) return null;
  srFrontCtx = srFrontCanvas.getContext('2d');
  resizeSrFront();
  addEventListener('resize', resizeSrFront);
  srFrontParts = [];
  for (let i = 0; i < 300; i++) {
    const bright = i >= 250;
    srFrontParts.push({
      flow: Math.random(),
      speed: 0.030 + Math.random() * 0.060 + (i % 5) * 0.008,
      lane: Math.random(),
      phase: Math.random() * Math.PI * 2,
      size: bright ? 4.5 + Math.random() * 3.5 : 1.6 + Math.random() * 2.6,
      alpha: bright ? 0.75 + Math.random() * 0.25 : 0.30 + Math.random() * 0.45,
      tw: Math.random() * 1000,
      hueOff: (Math.random() - 0.5) * 70,
      depth: Math.random(),
      bright
    });
  }
  srFrontOrbs = [];
  for (let i = 0; i < 8; i++) {
    srFrontOrbs.push({
      x: Math.random(),
      y: 0.35 + Math.random() * 0.3,
      vx: (Math.random() - 0.5) * 0.02,
      vy: (Math.random() - 0.5) * 0.012,
      r: 26 + Math.random() * 42,
      alpha: 0.10 + Math.random() * 0.14,
      hueOff: (Math.random() - 0.5) * 90,
      tw: Math.random() * 1000
    });
  }
  return srFrontCtx;
}
function resizeSrFront() {
  if (!srFrontCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  srFrontW = srFrontCanvas.clientWidth || innerWidth;
  srFrontH = srFrontCanvas.clientHeight || innerHeight;
  srFrontCanvas.width = Math.round(srFrontW * dpr);
  srFrontCanvas.height = Math.round(srFrontH * dpr);
  if (srFrontCtx) srFrontCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const srTrailCacheMap = new Map();
function srTrailSprite(hueN, lightBucket) {
  const bucket = ((Math.round(hueN / 6) % 60) + 60) % 60;
  let arr = srTrailCacheMap.get(bucket);
  if (!arr) {
    arr = [];
    for (let l = 0; l < 3; l++) {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 16;
      const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0, 8, 128, 8);
      grad.addColorStop(0, 'hsla(' + (bucket * 6) + ', 90%, 66%, 0)');
      grad.addColorStop(1, 'hsla(' + (bucket * 6) + ', 92%, ' + (66 + l * 7) + '%, 1)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 16);
      arr.push(cv);
    }
    if (srTrailCacheMap.size > 96) srTrailCacheMap.clear();
    srTrailCacheMap.set(bucket, arr);
  }
  return arr[lightBucket];
}
function updateSrFront(t, dt) {
  // 星河 star-river 模式已移除：跳过前置粒子画布，避免全屏 2D 画布长期占用 GPU 内存
  if (stageMode !== 'star-river' || stageViewEl.classList.contains('hidden')) return;
  const ctx = ensureSrFront();
  if (!ctx) return;
  ctx.clearRect(0, 0, srFrontW, srFrontH);
  const lineW = stageLineMetricW() || Math.min(srFrontW * 0.6, 900);
  const bandW = Math.min(srFrontW * 0.98, Math.max(480, lineW * 2.0 + 280));
  const x0 = (srFrontW - bandW) / 2;
  const lineH = stageLineMetricH();
  const bandH = Math.min(srFrontH * 0.46, 210 + (lineH ? lineH * 2.6 : 160));
  const yC = srFrontH * 0.5;
  const h1 = Math.round(curHue || 200);
  const h2 = (h1 + 70) % 360;
  const kick = beatKick, chorus = chorusLevel;
  ctx.globalCompositeOperation = 'lighter';
  for (const orb of srFrontOrbs) {
    orb.x += orb.vx * dt; orb.y += orb.vy * dt;
    if (orb.x < -0.06) orb.x = 1.06; if (orb.x > 1.06) orb.x = -0.06;
    if (orb.y < 0.24) orb.y = 0.24; if (orb.y > 0.76) orb.y = 0.76;
    const ox = orb.x * srFrontW, oy = orb.y * srFrontH;
    const orbHue = ((curHue || 200) + orb.hueOff) % 360;
    const orbA = orb.alpha * (0.7 + 0.3 * Math.sin(t * 0.4 + orb.tw)) * (0.75 + kick * 0.5 + chorus * 0.35);
    const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, orb.r);
    og.addColorStop(0, 'hsla(' + ((orbHue % 360 + 360) % 360).toFixed(0) + ', 92%, 72%, ' + Math.min(0.4, orbA).toFixed(3) + ')');
    og.addColorStop(1, 'hsla(' + ((orbHue % 360 + 360) % 360).toFixed(0) + ', 90%, 60%, 0)');
    ctx.fillStyle = og;
    ctx.beginPath();
    ctx.arc(ox, oy, orb.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const now = t * 1000;
  if (srFrontLast === 0) srFrontLast = now;
  for (const p of srFrontParts) {
    p.flow += dt * p.speed;
    if (p.flow > 1) { p.flow -= 1; p.lane = Math.random(); p.phase = Math.random() * Math.PI * 2; }
    const fx = p.flow * bandW;
    const curve = Math.sin(p.flow * Math.PI * 2 * (0.8 + p.lane * 0.8) + p.phase) * bandH * 0.24;
    const y = yC + (p.lane - 0.5) * bandH * 0.60 + curve;
    const twinkle = 0.55 + 0.45 * Math.sin(t * (0.8 + p.lane) + p.tw);
    const boost = 0.6 + kick * 0.8 + chorus * 0.35;
    const alpha = Math.min(0.95, p.alpha * twinkle * boost);
    const size = p.size * (1 + kick * 0.5) * (0.85 + p.depth * 0.5);
    const hue = (p.hueOff > 0 ? h2 : h1) + p.hueOff * 0.5;
    const hueN = ((hue % 360) + 360) % 360;
    // 拖尾光丝：沿流动方向拉出短轨迹，形成"河水流动"感
    const trail = Math.max(6, p.speed * bandW * 0.30) * (0.7 + p.depth * 0.6) * (1 + kick * 0.5);
    const lineW = Math.max(0.8, size * 0.42);
    // 拖尾光丝：预渲染色板精灵替代逐帧 createLinearGradient（消除每帧 300+ 渐变对象分配导致的偶发 GC 卡顿）
    const lightB = p.depth > 0.66 ? 2 : (p.depth > 0.33 ? 1 : 0);
    ctx.save();
    ctx.translate(fx, y);
    ctx.rotate(0.0997); // 原渐变方向角 atan(0.10)，恒定
    ctx.globalAlpha = Math.min(0.85, alpha);
    ctx.drawImage(srTrailSprite(hueN, lightB), -trail, -lineW / 2, trail, lineW);
    ctx.restore();
    // 亮星核心
    ctx.fillStyle = 'hsla(' + hueN.toFixed(0) + ', 92%, ' + (70 + p.depth * 18).toFixed(0) + '%, ' + Math.min(0.95, alpha * 1.1).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(fx, y, Math.max(0.8, size * 0.6), 0, Math.PI * 2);
    ctx.fill();
    // 光晕
    const haloR = size * (p.bright ? 2.8 : 1.8);
    ctx.fillStyle = 'hsla(' + hueN.toFixed(0) + ', 90%, 74%, ' + Math.min(0.55, alpha * (p.bright ? 0.55 : 0.30)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(fx, y, Math.max(1.2, haloR), 0, Math.PI * 2);
    ctx.fill();
  }
  srFrontLast = now;
}

function init3D() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('bg3d'), antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 4000);
    camera.position.set(0, 0, 900);

    // —— 粒子星系（带绕轴漩涡）——
    const COUNT = 1500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const cA = new THREE.Color('#22d3ee'), cB = new THREE.Color('#a78bfa');
    particleVel = [];
    for (let i = 0; i < COUNT; i++) {
      const r = 250 + Math.random() * 550;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i*3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
      pos[i*3+2] = r * Math.cos(phi);
      const t = Math.random();
      const c = cA.clone().lerp(cB, t);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      // 切向速度 形成星系漩涡
      const s = 0.0005 * (250 + Math.random() * 400);
      particleVel.push({
        vx: (Math.random()-0.5)*0.12 - pos[i*3+2] * s,
        vy: (Math.random()-0.5)*0.12,
        vz: (Math.random()-0.5)*0.12 + pos[i*3] * s
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pmat = new THREE.PointsMaterial({
      size: 3, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    particles = new THREE.Points(geo, pmat);
    scene.add(particles);

    // —— 远处星层（增加景深）——
    const starCount = 500;
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 1300 + Math.random() * 800;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      sPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
      sPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      sPos[i*3+2] = r * Math.cos(phi);
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    stars = new THREE.Points(sGeo, new THREE.PointsMaterial({
      color: 0x9aa7d8, size: 1.2, transparent: true, opacity: 0.5, depthWrite: false
    }));
    scene.add(stars);

    // —— 光轨圆环 ——
    rings = [];
    for (let i = 0; i < 3; i++) {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(260 + i * 110, 1.6, 8, 96),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.16, wireframe: true })
      );
      scene.add(torus);
      rings.push(torus);
    }

    // —— 流动粒子河（向镜头涌动，Mineradio 风格）——
    const STREAM_N = 800;
    const stGeo = new THREE.BufferGeometry();
    const stPos = new Float32Array(STREAM_N * 3);
    streamVel = new Float32Array(STREAM_N);
    for (let i = 0; i < STREAM_N; i++) {
      stPos[i*3] = (Math.random() - 0.5) * 2200;
      stPos[i*3+1] = (Math.random() - 0.5) * 1300;
      stPos[i*3+2] = 300 + Math.random() * 1300;
      streamVel[i] = 60 + Math.random() * 140;
    }
    stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
    stream = new THREE.Points(stGeo, new THREE.PointsMaterial({
      color: 0x22d3ee, size: 2.4, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    scene.add(stream);

    // —— 漂浮光斑（bokeh 辉光）——
    const bokehTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bokehTex, color: 0x88ccff, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      const s = 30 + Math.random() * 90;
      sp.scale.set(s, s, 1);
      sp.position.set((Math.random()-0.5)*1800, (Math.random()-0.5)*1200, -200 - Math.random()*900);
      sp.userData = { vy: 8 + Math.random()*20, ph: Math.random()*Math.PI*2, base: 0.15 + Math.random()*0.2 };
      scene.add(sp);
      bokeh.push(sp);
    }

    // —— 舞台特效组（唱片 / 频谱环 / 光束 / 冲击波）——
    fxGroup = new THREE.Group();

    // 3D 唱片
    const discBody = new THREE.Mesh(
      new THREE.CylinderGeometry(120, 120, 22, 64),
      new THREE.MeshPhongMaterial({ map: coverTextureFromImage(null), color: 0xffffff })
    );
    discBody.rotation.x = Math.PI / 2;
    const centerHole = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 24, 32),
      new THREE.MeshBasicMaterial({ color: 0x0a0c12 })
    );
    centerHole.rotation.x = Math.PI / 2;
    const glowRing = new THREE.Mesh(
      new THREE.TorusGeometry(128, 3, 12, 64),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 })
    );
    discGroup = new THREE.Group();
    discGroup.add(discBody, centerHole, glowRing);
    discGroup.position.set(0, -40, -260);
    discGroup.scale.setScalar(1.5);

    // 频谱环：48 根 3D 音柱环绕唱片
    spectrumBars = [];
    const barGroup = new THREE.Group();
    const barGeo = new THREE.BoxGeometry(5, 8, 5);
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 });
      const bar = new THREE.Mesh(barGeo, mat);
      const a = (i / 48) * Math.PI * 2;
      bar.position.set(Math.cos(a) * 150, 0, Math.sin(a) * 150);
      bar.rotation.y = -a;
      bar.scale.y = 0.15;
      barGroup.add(bar);
      spectrumBars.push(bar);
    }
    barGroup.position.set(0, -40, -260);

    // 舞台光束
    beams = [];
    const beamGroup = new THREE.Group();
    beamGroup.position.set(0, -40, -260);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.ConeGeometry(24, 620, 10, 1, true);
      g.translate(0, -310, 0);
      const m = new THREE.MeshBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: 0.07,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const cone = new THREE.Mesh(g, m);
      cone.rotation.x = Math.PI / 2 + 0.22;
      cone.rotation.y = (i / 3) * Math.PI * 2;
      beamGroup.add(cone);
      beams.push(cone);
    }

    // 鼓点冲击波
    shockwaves = [];
    const swGeo = new THREE.TorusGeometry(1, 3, 10, 72);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(swGeo, m);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(0, -40, -260);
      mesh.visible = false;
      fxGroup.add(mesh);
      shockwaves.push({ mesh, life: 0 });
    }
    // —— 地面波形线（FFT 驱动）——
    const wGeo = new THREE.BufferGeometry();
    const wPos = new Float32Array(97 * 3);
    for (let i = 0; i <= 96; i++) {
      wPos[i*3] = (i / 96 - 0.5) * 560;
      wPos[i*3+1] = 0;
      wPos[i*3+2] = 0;
    }
    wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
    waveLine = new THREE.Line(wGeo, new THREE.LineBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.55
    }));
    waveLine.position.set(0, -330, -260);
    fxGroup.add(waveLine);
    fxGroup.add(discGroup, barGroup, beamGroup);
    scene.add(fxGroup);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(200, 400, 600);
    scene.add(dir);

    addEventListener('resize', () => {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    });
    addEventListener('mousemove', (e) => {
      mouseX = (e.clientX / innerWidth - 0.5) * 2;
      mouseY = (e.clientY / innerHeight - 0.5) * 2;
    });
    requestAnimationFrame(animate);
  } catch (err) {
    webglOk = false;
    console.error('WebGL init failed:', err);
  }
}

function coverTextureFromImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#1c2434'); grad.addColorStop(1, '#0d1017');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  if (img && img.width > 0) {
    ctx.drawImage(img, 0, 0, 256, 256);
  } else {
    ctx.fillStyle = 'rgba(34,211,238,0.35)';
    ctx.font = 'bold 90px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('♪', 128, 140);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ================= 封面取色与氛围 =================
let baseHue = 200, lyricOffset = 0, curHue = 200, targetHue = 200;
const moodColor = new THREE.Color('#22d3ee');

function applyMood() {
  targetHue = (((baseHue + lyricOffset) % 360) + 360) % 360;
}

let lastGlowHue = -999;
function updateMood(dt) {
  curHue += (targetHue - curHue) * Math.min(1, dt * 2.2);
  if (Math.abs(curHue - targetHue) < 0.3) curHue = targetHue;
  moodColor.setHSL(curHue / 360, 0.85, 0.58);
  // 只在色相明显变化时重绘全屏渐变，其余帧只更新 opacity（合成器友好，消除逐帧重栅格化）
  if (Math.abs(curHue - lastGlowHue) > 1.5) {
    lastGlowHue = curHue;
    stageGlow.style.background =
      `radial-gradient(circle at 50% 55%, hsla(${curHue.toFixed(0)}, 85%, 55%, 0.20), transparent 62%)`;
  }
  stageGlow.style.opacity = (0.55 + chorusLevel * 0.45).toFixed(3);
  const step = Math.min(1, dt * 2.2);
  rings.forEach((ring) => ring.material.color.lerp(moodColor, step));
  beams.forEach((b) => b.material.color.lerp(moodColor, step));
  shockwaves.forEach((sw) => sw.mesh.material.color.lerp(moodColor, step));
  if (discGroup) {
    const glow = discGroup.children[2];
    if (glow) glow.material.color.lerp(moodColor, step);
  }
}

function extractHue(img) {
  if (bgSettings && CHAR_THEME[bgSettings.btnStyle]) return;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let hSum = 0, sSum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      if (r + g + b < 60) continue;
      const hsl = rgbToHsl(r, g, b);
      hSum += hsl[0]; sSum += hsl[1]; n++;
    }
    if (n > 0) {
      baseHue = hSum / n;
      if (sSum / n < 0.18) baseHue = 200; // 灰色封面回归默认色
      applyMood();
      const rst = document.documentElement.style;
      rst.setProperty('--c1h', baseHue.toFixed(0));
      rst.setProperty('--c2h', ((baseHue + 70) % 360).toFixed(0));
      rst.setProperty('--c3h', ((baseHue + 160) % 360).toFixed(0));
      syncAcidBanner();
    }
  } catch (err) { /* 忽略 */ }
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s * 100];
}

// ================= 极光着色器背景（Folia latent MeshGradient 思路） =================
const AURORA_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}`;

const AURORA_FS = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uKick;
uniform float uChorus;
uniform float uPower;
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;
float blob(vec2 p, vec2 c, float r) {
  vec2 d = p - c;
  return exp(-dot(d, d) / (r * r));
}
void main() {
  vec2 uv = vUv;
  float ar = uRes.x / max(1.0, uRes.y);
  vec2 p = (uv - 0.5) * vec2(ar, 1.0);
  float tm = uTime * (0.05 + uPower * 0.30 + uKick * 0.45);
  float k = uKick;
  float pulse = 1.0 + k * 0.30 + uBass * 0.16;
  vec2 c1 = vec2(sin(tm * 0.9) * 0.88, cos(tm * 0.72) * 0.52);
  vec2 c2 = vec2(cos(tm * 0.62 + 1.7) * 0.94, sin(tm * 0.8 + 0.6) * 0.58);
  vec2 c3 = vec2(sin(tm * 0.5 + 3.1) * 1.0, cos(tm * 0.6 + 2.2) * 0.62);
  vec2 c4 = vec2(cos(tm * 0.42 + 0.9) * 1.12, sin(tm * 0.5 + 4.0) * 0.72);
  float r1 = (0.55 + k * 0.22) * pulse;
  float r2 = (0.46 + uBass * 0.12) * pulse;
  float r3 = (0.42 + uChorus * 0.20) * pulse;
  float r4 = 0.5 * pulse;
  vec3 col =
    uC1 * blob(p, c1, r1) * 1.3 +
    uC2 * blob(p, c2, r2) * 1.1 +
    uC3 * blob(p, c3, r3) * 0.95 +
    uC4 * blob(p, c4, r4) * 0.75;
  col += vec3(0.015, 0.02, 0.04);
  col = col / (col * 1.7 + 0.95);
  col += uChorus * vec3(0.05, 0.045, 0.028);
  col += k * 0.06 * (uC1 + uC2);
  float g = fract(sin(dot(uv, vec2(123.4, 234.5))) * 43758.5453);
  col += (g - 0.5) * 0.02;
  float vg = smoothstep(1.45, 0.5, length((uv - 0.5) * vec2(ar, 1.0)));
  col *= mix(0.85, 1.15, vg);
  col += uChorus * vec3(0.06, 0.055, 0.035);
  gl_FragColor = vec4(col, mix(1.0, 0.85, vg));
}`;

function initShaderBg() {
  const cv = $('shaderBg');
  if (!cv) return;
  try {
    shaderRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true, premultipliedAlpha: false });
    // 极光是抽象光斑，dpr 1.0 即可，省一半像素
    shaderRenderer.setPixelRatio(1);
    shaderRenderer.setSize(innerWidth, innerHeight);
    shaderScene = new THREE.Scene();
    shaderCamera = new THREE.Camera();
    shaderUniforms = {
      uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uTime: { value: 0 },
      uBass: { value: 0 },
      uKick: { value: 0 },
      uChorus: { value: 0 },
      uPower: { value: 0 },
      uC1: { value: new THREE.Color('#0e4a5e') },
      uC2: { value: new THREE.Color('#6b2f8f') },
      uC3: { value: new THREE.Color('#1b5e7a') },
      uC4: { value: new THREE.Color('#3d1d5e') }
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: AURORA_VS, fragmentShader: AURORA_FS,
      uniforms: shaderUniforms, depthTest: false, depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    shaderScene.add(quad);
    addEventListener('resize', () => {
      shaderRenderer.setSize(innerWidth, innerHeight);
      shaderUniforms.uRes.value.set(innerWidth, innerHeight);
    });
    shaderBgOk = true;
  } catch (err) {
    console.error('Shader bg init failed:', err);
  }
}

// ================= 鼓点检测（低音专用 bin + 上升沿 + 自适应阈值） =================
let lastBeatAt = 0;
let stagePulse = 0;
let beatKick = 0;        // 快速起音冲击量（0..1，指数衰减，驱动卡点冲击）
let bassAvg = 0;         // 低频能量滑动平均（自适应阈值基准）
let beatTimes = [];      // 已检测节拍的时间点（逐字卡点用）
let lastRawBass = 0;     // 上一帧低频能量（上升沿判定）
const BASS_W = [1, 0.92, 0.82, 0.72, 0.6, 0.48, 0.38, 0.3]; // 2048 FFT 下前 8 个 bin（21.5-172Hz），真低频打击 // 只取前 4 个 bin（≈0-700Hz），打击乐器集中在低频
function detectBeat() {
  if (!analyser || !freqData) return;
  const n = Math.min(8, freqData.length);
  let sum = 0, wn = 0;
  for (let i = 0; i < n; i++) { sum += freqData[i] * BASS_W[i]; wn += BASS_W[i]; }
  const raw = sum / (wn * 255);
  bassAvg = bassAvg * 0.96 + raw * 0.04;
  const now = performance.now();
  const thr = Math.max(0.42, bassAvg * 1.55);
  const rising = raw > lastRawBass * 1.22;
  lastRawBass = raw;
  const isKick = (raw > thr && rising) || raw > thr * 1.5;
  if (isKick && now - lastBeatAt > 180) {
    lastBeatAt = now;
    beatKick = 1;
    const bt = demoMode ? demoTime : (audio.currentTime || 0);
    if (bt > 0.05) {
      beatTimes.push(bt);
      if (beatTimes.length > 240) beatTimes.shift();
      snapNextCharToBeat(bt);
    }
    onBeat();
  }
}

function onBeat() {
  stagePulse = 1;
  beatFovKick = 1;
  const sw = shockwaves.find((s) => s.life <= 0);
  if (sw) { sw.life = 1; sw.mesh.visible = true; }
}

// 实时卡点：把当前行里最近一个还没亮起的字吸附到鼓点上
function snapNextCharToBeat(bt) {
  if (!lyricMeta.length || stageLineIdx < 0) return;
  const meta = lyricMeta[stageLineIdx];
  if (!meta || bt < meta.time || bt > meta.end) return;
  if (meta.wordTimed) return; // 词级时间戳已精确，不再做鼓点吸附
  let target = null, bestD = Infinity;
  for (const ch of meta.chars) {
    if (ch.start <= bt + 0.02 || ch.snapped) continue;
    const d = ch.start - bt;
    // 只吸附 160ms 内即将亮起的字，且最多提前 35ms：鼓点仅轻微引导，避免字被拖得过早
    if (d < bestD && d < 0.16) { bestD = d; target = ch; }
  }
  if (target) {
    target.start = Math.min(target.end - 0.05, Math.max(bt + 0.03, target.start - 0.035));
    target.snapped = true;
  }
}

function setCssVarIfChanged(name, val) {
  const st = document.documentElement.style;
  if (st.getPropertyValue(name) !== val) st.setProperty(name, val);
}

// ================= 渲染循环 =================
// 帧率上限：30 / 60 / 120 FPS（设置面板可调，localStorage 持久化）
const FRAME_CAPS = [30, 60, 120];
let frameCap = parseInt(localStorage.getItem('qin-frame-cap') || '60', 10) || 60;
if (!FRAME_CAPS.includes(frameCap)) frameCap = 60;
let lastFrameT = 0;
let lastT = performance.now();
function animate(ts) {
  requestAnimationFrame(animate);
  const now = performance.now();
  if (document.hidden) { lastFrameT = now; lastT = now; return; } // 窗口隐藏/最小化时暂停渲染，恢复立即续帧
  if (now - lastFrameT < (1000 / frameCap)) return; // 按所选帧率节流：统一用 performance.now()，避免与 rAF 时间戳混用导致帧间隔抖动
  lastFrameT = now;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;
  if (demoMode && !demoPaused) {
    demoTime += dt;
    bass = Math.max(0.18, Math.abs(Math.sin(t * 1.35)) * 0.85 + 0.12);
    audioPower = Math.max(0.2, Math.abs(Math.sin(t * 0.9)) * 0.55 + 0.18);
    // 演示节拍：约 1.8 个/秒（接近真实鼓点），用于验证逐字卡点
    if (Math.sin(t * 11.3) > 0.93 && t - demoLastBeat > 0.5) {
      demoLastBeat = t;
      beatKick = 1;
      if (beatTimes.length > 240) beatTimes.shift();
      beatTimes.push(demoTime);
      snapNextCharToBeat(demoTime);
      onBeat();
    }
  } else if (!demoMode) {
    // 逐帧平滑 5 段频带能量（bass/lowMid/mid/vocal/treble，Folia broadband energy 思路）
    if (analyser && freqData) {
      const n = freqData.length;
      const band = (a, b) => { let s = 0, c = 0; for (let i = a; i < b && i < n; i++) { s += freqData[i]; c++; } return c ? s / c / 255 : 0; };
      const tBass = Math.min(1, band(1, 8) * 1.3 + band(8, 16) * 0.25); // 2048FFT: 21.5-344Hz
      const tLow = band(8, 20), tMid = band(20, 56), tVoc = band(56, 180), tTre = band(180, Math.min(n, 900)); // 2048FFT 分频: 172-430 / 430-1200 / 1200-3870 / 3870Hz+
      bass += (tBass - bass) * Math.min(1, dt * 6);
      lowMid += (tLow - lowMid) * Math.min(1, dt * 4);
      mid += (tMid - mid) * Math.min(1, dt * 4);
      vocal += (tVoc - vocal) * Math.min(1, dt * 4);
      treble += (tTre - treble) * Math.min(1, dt * 4);
      const pw = Math.pow(0.22 * bass + 0.18 * lowMid + 0.22 * mid + 0.28 * vocal + 0.1 * treble, 0.55);
      audioPower += (Math.min(1, pw) - audioPower) * Math.min(1, dt * 5);
    } else {
      bass = Math.max(0, bass - dt * 1.2);
      audioPower = Math.max(0, audioPower - dt * 0.8);
    }
  }
  beatKick = Math.max(0, beatKick - dt * 3.2);
  const boost = 1 + bass * 3 + beatKick * 2;

  if (analyser) {
    if (!freqData || freqData.length !== analyser.frequencyBinCount) {
      freqData = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(freqData);
    if (window) window.frequencyData = freqData; // 供 Mineradio Sonic Workshop 读取真实频谱
    detectBeat(); // 逐帧鼓点检测（60Hz，延迟从 100ms 降至 ~16ms）
  }
  if (demoMode && window && window.frequencyData) {
    // demo 合成频谱：低频随 bass 呼吸、中频随 beat 抖动，让 Sonic Workshop 演示真实可感
    const df = window.frequencyData, dlen = df.length;
    for (let di = 0; di < dlen; di++) {
      const ff = di / dlen;
      df[di] = Math.max(0, Math.min(255,
        70 * Math.exp(-ff * 3.4) * (0.5 + 0.5 * bass) +
        30 * Math.exp(-ff * 1.2) * (0.5 + 0.5 * Math.sin(t * 2.6 + di * 0.11)) +
        16 * Math.random() * (0.35 + 0.65 * audioPower) +
        (beatKick > 0.4 ? 95 * Math.exp(-ff * 9) * beatKick : 0)
      ));
    }
  }
  if (webglOk) {
    // 演出台视图下 bg3d 已隐藏，跳过高开销粒子更新以节省性能
    const bg3dVisible = !document.body.classList.contains('stage-mode') && !document.body.classList.contains('folia-mode');
    if (bg3dVisible) {
    const posAttr = particles.geometry.attributes.position;
    const arr = posAttr.array;
    const spd = dt * 60; // 帧率归一化：30/60/120fps 下粒子速度保持一致
    if (!queuePanelOpen) { // 队列面板打开时暂停高开销粒子更新
    for (let i = 0; i < arr.length; i += 3) {
      const v = particleVel[i / 3];
      arr[i] += v.vx * boost * spd;
      arr[i+1] += v.vy * boost * spd;
      arr[i+2] += v.vz * boost * spd;
      if (arr[i]*arr[i] + arr[i+1]*arr[i+1] + arr[i+2]*arr[i+2] > 1000000) {
        arr[i] *= 0.8; arr[i+1] *= 0.8; arr[i+2] *= 0.8;
      }
    }
    }
    posAttr.needsUpdate = true;
    particles.rotation.y = t * 0.02;
    stars.rotation.y = -t * 0.008;
    particles.material.size = 3 * (1 + bass * 0.4 + chorusLevel * 0.2);
    particles.material.opacity = (0.7 + bass * 0.25 + chorusLevel * 0.15) * (stageMode === 'star-river' ? 0.20 : 1);

    rings.forEach((ring, i) => {
      ring.rotation.x = t * (0.1 + i * 0.04);
      ring.rotation.y = t * (0.05 + i * 0.03);
      ring.material.opacity = (0.10 + bass * 0.4) * (stageMode === 'star-river' ? 0.35 : 1);
    });

    if (fxGroup.visible) {
      discAngle += dt * (0.6 + bass * 2.2);
      discGroup.rotation.y = discAngle;
      discGroup.scale.setScalar(1.5 * (1 + bass * 0.08));
      beamGroupSpin += dt * 0.05;
      beams.forEach((b) => { b.rotation.z = beamGroupSpin; });

      if (!queuePanelOpen) {
      // 频谱环（实时 FFT / 空闲正弦）
      for (let i = 0; i < spectrumBars.length; i++) {
        let v;
        if (analyser && freqData) {
          const idx = Math.floor((i / spectrumBars.length) * freqData.length);
          v = freqData[idx] / 255;
        } else {
          v = 0.12 + 0.1 * Math.abs(Math.sin(t * 0.8 + i * 0.35));
        }
        const bar = spectrumBars[i];
        const target = 10 + v * 110 + beatKick * 34;
        bar.scale.y += (target - bar.scale.y) * 0.25;
        bar.material.opacity = 0.25 + v * 0.65;
        bar.material.color.lerp(moodColor, 0.06);
      }

      // 冲击波扩散
      shockwaves.forEach((sw) => {
        if (sw.life > 0) {
          sw.life -= dt * 0.8;
          const k = 1 + (1 - Math.max(0, sw.life)) * 2.4;
          sw.mesh.scale.set(k, k, 1);
          sw.mesh.material.opacity = Math.max(0, sw.life) * 0.6;
          if (sw.life <= 0) sw.mesh.visible = false;
        }
      });
      }
    }

      if (!queuePanelOpen) {
      // 流动粒子河
      const stAttr = stream.geometry.attributes.position;
      const stArr = stAttr.array;
      for (let i = 0; i < stArr.length; i += 3) {
        stArr[i+2] -= streamVel[i / 3] * boost * dt * 3;
        stArr[i] += Math.sin(t * 0.4 + i) * dt * 6;
        if (stArr[i+2] < -700) {
          stArr[i+2] = 1500;
          stArr[i] = (Math.random() - 0.5) * 2200;
          stArr[i+1] = (Math.random() - 0.5) * 1300;
        }
      }
      stAttr.needsUpdate = true;
      stream.material.color.lerp(moodColor, Math.min(1, dt * 2));
      stream.material.opacity = (0.45 + bass * 0.3 + chorusLevel * 0.15) * (stageMode === 'star-river' ? 0.15 : 1);

      // 漂浮光斑
      bokeh.forEach((sp, i) => {
        sp.position.y += sp.userData.vy * dt * (1 + bass);
        if (sp.position.y > 700) sp.position.y = -700;
        sp.material.opacity = (sp.userData.base + bass * 0.25 + Math.sin(t * 0.5 + sp.userData.ph) * 0.08) * (stageMode === 'star-river' ? 0.22 : 1);
        sp.material.color.lerp(moodColor, Math.min(1, dt * 1.5));
      });

      // 地面波形线（FFT 驱动）
      updateStarRiver(dt, t);
      updateSrFront(t, dt);

      if (waveLine) {
        const wArr = waveLine.geometry.attributes.position.array;
        for (let i = 0; i <= 96; i++) {
          let v = 0;
          if (analyser && freqData) {
            const idx = Math.floor((i / 96) * freqData.length);
            v = freqData[idx] / 255;
          } else {
            v = 0.15 + 0.1 * Math.sin(t * 1.6 + i * 0.4);
          }
          wArr[i*3+1] = v * 150 * (0.5 + bass);
        }
        waveLine.geometry.attributes.position.needsUpdate = true;
        waveLine.material.color.lerp(moodColor, Math.min(1, dt * 2));
      }
      }

    const tx = Math.sin(t * 0.05) * 70 + mouseX * 90;
    const ty = Math.cos(t * 0.04) * 46 + mouseY * 70;
    camera.position.x += (tx - camera.position.x) * 0.03;
    camera.position.y += (ty - camera.position.y) * 0.03;
    const camZoom = 1 + bass * 0.06 + chorusLevel * 0.12 + stagePulse * 0.03 + beatKick * 0.05;
    camera.position.z = 900 / camZoom;
    camera.rotation.z = Math.sin(t * 0.13) * 0.02 + bass * 0.012;
    beatFovKick = Math.max(0, beatFovKick - dt * 3);
    camera.fov += (60 + beatFovKick * 5 - camera.fov) * 0.12;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    } // end bg3dVisible gate

    // 极光背景：GPU 着色器随音乐/鼓点/副歌流动（仅漫游模式渲染）
    if (shaderBgOk && fxGroup.visible && bgSettings.mode === 'roam') {
      const su = shaderUniforms;
      su.uTime.value = t;
      su.uBass.value = bgSettings.beat ? bass : 0;
      su.uKick.value = bgSettings.beat ? beatKick : 0;
      su.uChorus.value = chorusLevel;
      su.uPower.value = audioPower;
      su.uC1.value.setHSL(curHue / 360, 0.85, 0.62);
      su.uC2.value.setHSL(((curHue + 70) % 360) / 360, 0.8, 0.56);
      su.uC3.value.setHSL(((curHue + 315) % 360) / 360, 0.75, 0.5);
      su.uC4.value.setHSL(((curHue + 160) % 360) / 360, 0.7, 0.44);
      if (stageMode === 'star-river') { su.uPower.value *= 0.4; su.uBass.value *= 0.5; su.uKick.value *= 0.4; }
      shaderRenderer.render(shaderScene, shaderCamera);
    }
  }

  updateMood(dt);
  chorusLevel += (chorusLevelTarget - chorusLevel) * Math.min(1, dt * 1.6);
  stagePulse = Math.max(0, stagePulse - dt * 3);
  // folia 式微运镜：特效模式整体随音乐呼吸（低频/副歌/人声驱动缩放，缓慢上下漂移）
  const isStatic = stageMode === 'sonnet';
  const camBreath = isStatic ? stagePulse * 0.018 : (bass * 0.014 + chorusLevel * 0.022 + audioPower * 0.012 + stagePulse * 0.018);
  const panY = isStatic ? 0 : (Math.sin(t * 0.22) * 4 + bass * 5);
  const stageTF = 'scale(' + (1 + camBreath).toFixed(4) + ') translateY(' + panY.toFixed(1) + 'px)';
  if (stageLyricsEl.__tf !== stageTF) { stageLyricsEl.__tf = stageTF; stageLyricsEl.style.transform = stageTF; }
  setCssVarIfChanged('--bass', bass.toFixed(3));
  setCssVarIfChanged('--pulse', stagePulse.toFixed(3));
  setCssVarIfChanged('--hue', curHue.toFixed(0));
  setCssVarIfChanged('--chorus', chorusLevel.toFixed(3));
  setCssVarIfChanged('--kick', beatKick.toFixed(3));
  updateStage(t, dt);
  updateGifFx(t, dt);
  if (wallpaperLayer && wallpaperLayer.active) wallpaperLayer.render(t, bass, audioPower);
  // 中央呼吸光晕（Folia 风格柔和光核：随音乐/鼓点/副歌呼吸，替代低端烟花）
  if (stageBreatheEl && !stageViewEl.classList.contains('hidden')) {
    const bPulse = beatKick * 0.35 + bass * 0.18 + audioPower * 0.22 + chorusLevel * 0.2;
    const breatheMul = stageMode === 'star-river' ? 0.45 : 1;
    const bOp = ((0.26 + bPulse * 0.66) * breatheMul).toFixed(2);
    if (stageBreatheEl.__op !== bOp) { stageBreatheEl.__op = bOp; stageBreatheEl.style.opacity = bOp; }
    const bTF = 'translate(-50%, -50%) scale(' + (0.7 + bPulse * 0.5).toFixed(3) + ')';
    if (stageBreatheEl.__tf !== bTF) { stageBreatheEl.__tf = bTF; stageBreatheEl.style.transform = bTF; }
  }
}

let beamGroupSpin = 0;

// ================= 音频分析 + 音效增强 =================
// 音效状态（低音 / 高音 / 空间感），localStorage 持久化
let fxBass = localStorage.getItem('qin-fx-bass') === '1';
let fxTreble = localStorage.getItem('qin-fx-treble') === '1';
let fxSpace = localStorage.getItem('qin-fx-space') === '1';
let fxBassNode = null, fxTrebleNode = null, fxSpaceWet = null;

function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048; // 与官方 Mineradio FFT_SIZE=2048 一致，保证低频分辨率和 Sonic Workshop 频谱质量
    analyser.smoothingTimeConstant = 0.62;
    // 音效链路：src -> 低音(低架) -> 高音(高架) -> 干声 -> 分析器 -> 输出
    //            \________________________\-> 延迟(空间感湿声) -> 分析器
    fxBassNode = audioCtx.createBiquadFilter();
    fxBassNode.type = 'lowshelf';
    fxBassNode.frequency.value = 200;
    fxBassNode.gain.value = 0;
    fxTrebleNode = audioCtx.createBiquadFilter();
    fxTrebleNode.type = 'highshelf';
    fxTrebleNode.frequency.value = 3200;
    fxTrebleNode.gain.value = 0;
    const dry = audioCtx.createGain();
    dry.gain.value = 1;
    const delay = audioCtx.createDelay(1);
    delay.delayTime.value = 0.045;
    const fb = audioCtx.createGain();
    fb.gain.value = 0.3;
    fxSpaceWet = audioCtx.createGain();
    fxSpaceWet.gain.value = 0;
    const src = audioCtx.createMediaElementSource(audio);
    src.connect(fxBassNode);
    fxBassNode.connect(fxTrebleNode);
    fxTrebleNode.connect(dry);
    dry.connect(analyser);
    fxTrebleNode.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(fxSpaceWet);
    fxSpaceWet.connect(analyser);
    analyser.connect(audioCtx.destination);
    applyFx();
  } catch (err) {
    console.error('Audio analyser init failed:', err);
  }
}

// 应用音效参数（开关切换时实时生效，无需重建音频图）
function applyFx() {
  if (fxBassNode) fxBassNode.gain.value = fxBass ? 7 : 0;
  if (fxTrebleNode) fxTrebleNode.gain.value = fxTreble ? 5 : 0;
  if (fxSpaceWet) fxSpaceWet.gain.value = fxSpace ? 0.2 : 0;
}

// ================= 内联 SVG 图标系统（精致 UI） =================
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.8-4.8"/>',
  play: '<path d="M8.5 5.8v12.4c0 .9 1 1.5 1.8 1L20 13c.8-.5.8-1.6 0-2.1L10.3 4.8c-.8-.5-1.8.1-1.8 1Z"/>',
  pause: '<rect x="7" y="5.5" width="3.6" height="13" rx="1.2"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1.2"/>',
  prev: '<path d="M6 5.5v13M18.5 6.6c0-.9-1-1.4-1.7-.9l-8.4 5.4c-.7.4-.7 1.4 0 1.9l8.4 5.4c.7.4 1.7-.1 1.7-.9V6.6Z"/>',
  next: '<path d="M18 5.5v13M5.5 6.6c0-.9 1-1.4 1.7-.9l8.4 5.4c.7.4.7 1.4 0 1.9l-8.4 5.4c-.7.4-1.7-.1-1.7-.9V6.6Z"/>',
  volume: '<path d="M4 9.5v5h3.2l4.3 3.5V6L7.2 9.5H4Z"/><path d="M15.5 9a4.6 4.6 0 0 1 0 6M18 6.8a8 8 0 0 1 0 10.4"/>',
  heart: '<path d="M12 20.3S4.2 16 2.4 11.6C1.2 8.6 3.2 5.4 6.3 5.4c1.9 0 3.6 1 4.6 2.6l1.1 1.7 1.1-1.7c1-1.6 2.7-2.6 4.6-2.6 3.1 0 5.1 3.2 3.9 6.2C19.8 16 12 20.3 12 20.3Z"/>',
  deskLyric: '<rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M9.5 21h5M12 17.5V21"/><path d="M7 9.5h7M7 12.5h10"/>',
  settings: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="1.8"/><circle cx="10" cy="16" r="1.8"/>',
  back: '<path d="M15 5.5 8.5 12l6.5 6.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  fm: '<circle cx="12" cy="12" r="2.2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.8 5.8a8.5 8.5 0 0 0 0 12.4M18.2 5.8a8.5 8.5 0 0 1 0 12.4"/>',
  note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  modeOrder: '<path d="M4 7h11M4 12h11M4 17h11"/><path d="m18 10 3 2-3 2"/>',
  modeRepeat: '<path d="M17 3l4 4-4 4"/><path d="M21 7H9a5 5 0 0 0-5 5v1"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h12a5 5 0 0 0 5-5v-1"/>',
  modeRepeatOne: '<path d="M17 3l4 4-4 4"/><path d="M21 7H9a5 5 0 0 0-5 5v1"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h12a5 5 0 0 0 5-5v-1"/><path d="M12 9.5v5"/>',
  modeShuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
  speed: '<path d="M12 5v7l4.5 2.5"/><circle cx="12" cy="12" r="8.5"/><path d="M4 4l2.2 2.2M20 4l-2.2 2.2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l3 1.8"/><path d="M9.5 2.5h5M12 2.5v2"/>',
  fx: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8.5" cy="7" r="1.6"/><circle cx="15.5" cy="12" r="1.6"/><circle cx="11" cy="17" r="1.6"/>',
  mini: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 9.5h16M8.5 5v4.5M4 12.5h16"/>',
  waves: '<path d="M3.5 12a8.5 8.5 0 0 1 17 0"/><path d="M7 12a5 5 0 0 1 10 0"/><path d="M10 12a2 2 0 0 1 4 0"/>'
};
function svgIcon(name, size, cls) {
  const p = ICON_PATHS[name] || '';
  const c = cls ? ' ' + cls : '';
  return '<svg class="ico' + c + '" viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

// ================= 视图切换 =================
function showView(name) {
  if (name === 'stage') {
    prevStageView = lastNonStageView || 'home';
  } else {
    lastNonStageView = name;
  }
  Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  document.body.classList.toggle('stage-mode', name === 'stage');
  if (gifFxLayerEl) gifFxLayerEl.classList.toggle('hidden', name !== 'stage' || !gifFxOn);
  if (fxGroup) fxGroup.visible = name === 'stage';
  document.querySelectorAll('.nav-btn[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'stage') { requestAnimationFrame(initWave); }
  if (name === 'home' && !homeLoaded) { homeLoaded = true; loadHome(); }
}

// ================= 首页：推荐歌单 + 私人FM =================
let loginChecked = false;
let likedSummaryCache = null;
async function loadHome() {
  if (!loginChecked) { loginChecked = true; try { await refreshLogin(); } catch (err) { /* 忽略 */ } }
  playlistGrid.innerHTML = '';
  playlistGrid.appendChild(li('加载推荐歌单中…', 'loading-row'));
  const heroTag = document.querySelector('.hero-tag');
  const heroSub = document.querySelector('.hero-sub');
  try {
    if (activePlatform === 'qq') {
      if (heroTag) heroTag.textContent = 'QQ MUSIC · IMMERSIVE';
      if (heroSub) heroSub.textContent = 'YuMusic 同步接入 QQ 音乐，喜欢歌单与精选歌单随时开播，歌词随节奏流动。';
      const res = await api.qqHome();
      playlistGrid.innerHTML = '';
      renderAiPlaylistCards();
      if (qqLogin.loggedIn && qqLogin.userId) {
        const liked = await api.qqLiked().catch(() => null);
        if (liked && !liked.error && liked.songs && liked.songs.length) {
          likedSummaryCache = { name: '我的喜欢', trackCount: liked.songs.length };
          playlistGrid.appendChild(makeLikedCard(likedSummaryCache, 'qq'));
        } else {
          playlistGrid.appendChild(makeQqLikedGate(true));
        }
      } else {
        playlistGrid.appendChild(makeQqLikedGate(false));
      }
      const likedHero = $('likedHeroBtn');
      if (likedHero) likedHero.textContent = qqLogin.loggedIn && qqLogin.userId ? '♥ 我的喜欢 · QQ音乐' : '♥ 我的喜欢';
      if (!res.playlists || !res.playlists.length) {
        playlistGrid.appendChild(li('暂无推荐歌单（' + (res.error || '网络异常') + '）', 'loading-row'));
        return;
      }
      res.playlists.forEach((p) => playlistGrid.appendChild(makePlaylistCard(p, 'qq')));
      return;
    }
    if (heroTag) heroTag.textContent = 'NETEASE CLOUD MUSIC · IMMERSIVE';
    if (heroSub) heroSub.textContent = 'YuMusic 将网易云音乐、QQ 音乐与汽水音乐融为一体，歌词随节奏流动，特效随情绪漫游。';
    const [res, liked] = await Promise.all([
      api.home(),
      loginUserId ? api.likedSummary(loginUserId).catch(() => null) : Promise.resolve(null)
    ]);
    likedSummaryCache = liked;
    // 后台预热「我的喜欢」歌曲详情缓存：点击时秒开列表，首曲免等待
    if (loginUserId) api.likedSongsCached(loginUserId).catch(() => {});
    const likedHero = $('likedHeroBtn');
    if (likedHero) likedHero.textContent = (liked && liked.trackCount > 0)
      ? '♥ 我的喜欢 · ' + liked.trackCount
      : '♥ 我的喜欢';
    playlistGrid.innerHTML = '';
    renderAiPlaylistCards();
    if (loginUserId) playlistGrid.appendChild(makeLikedCard(likedSummaryCache, 'netease'));
    if (!res.playlists || !res.playlists.length) {
      playlistGrid.appendChild(li('暂无推荐歌单（' + (res.error || '网络异常') + '）', 'loading-row'));
      return;
    }
    res.playlists.forEach((p) => playlistGrid.appendChild(makePlaylistCard(p, 'netease')));
  } catch (err) {
    playlistGrid.innerHTML = '';
    renderAiPlaylistCards();
    playlistGrid.appendChild(li('加载失败：' + (err.message || err), 'loading-row'));
  }
}

function makePlaylistCard(p, platform) {
  const card = document.createElement('div');
  card.className = 'playlist-card';
  const imgWrap = document.createElement('div');
  imgWrap.className = 'pl-cover';
  if (p.cover) {
    const img = new Image();
    img.onload = () => { imgWrap.appendChild(img); };
    img.src = p.cover;
  }
  const badge = document.createElement('div');
  badge.className = 'pl-badge';
  badge.innerHTML = svgIcon('play', 11) + ' ' + fmtCount(p.playCount);
  const name = document.createElement('div');
  name.className = 'pl-name';
  name.textContent = p.name;
  imgWrap.appendChild(badge);
  card.append(imgWrap, name);
  card.addEventListener('click', () => openPlaylist(p, platform));
  return card;
}

function makeLikedCard(summary, platform) {
  const isQq = platform === 'qq';
  const card = document.createElement('div');
  card.className = 'playlist-card liked-card';
  const imgWrap = document.createElement('div');
  imgWrap.className = 'pl-cover liked-cover';
  const heart = document.createElement('span');
  heart.className = 'liked-heart';
  heart.innerHTML = svgIcon('heart', 15);
  imgWrap.appendChild(heart);
  if (summary && summary.trackCount > 0) {
    const badge = document.createElement('div');
    badge.className = 'pl-badge';
    badge.textContent = summary.trackCount + ' 首';
    imgWrap.appendChild(badge);
  }
  const name = document.createElement('div');
  name.className = 'pl-name';
  name.textContent = summary && summary.name ? summary.name : '我的喜欢';
  if (summary && summary.trackCount > 0) {
    const sub = document.createElement('div');
    sub.className = 'pl-sub';
    sub.textContent = isQq ? '来自QQ音乐 · 点击播放' : '来自网易云 · 点击播放';
    name.appendChild(sub);
  }
  card.append(imgWrap, name);
  card.addEventListener('click', () => openLiked(isQq ? 'qq' : 'netease'));
  return card;
}

function makeQqLikedGate(loggedIn) {
  const card = document.createElement('div');
  card.className = 'playlist-card liked-card';
  const imgWrap = document.createElement('div');
  imgWrap.className = 'pl-cover liked-cover';
  const heart = document.createElement('span');
  heart.className = 'liked-heart';
  heart.innerHTML = svgIcon('heart', 15);
  imgWrap.appendChild(heart);
  const name = document.createElement('div');
  name.className = 'pl-name';
  name.textContent = loggedIn ? '我的喜欢 · 暂无歌曲' : '登录后查看我的喜欢';
  const sub = document.createElement('div');
  sub.className = 'pl-sub';
  sub.textContent = loggedIn ? 'QQ音乐 · 点击查看' : 'QQ音乐 · 登录后展示';
  name.appendChild(sub);
  card.append(imgWrap, name);
  card.addEventListener('click', () => {
    if (loggedIn) openLiked('qq');
    else api.qqOpenLogin();
  });
  return card;
}

async function openLiked(platform) {
  if (platform === 'qq' || activePlatform === 'qq') {
    if (!qqLogin.loggedIn || !qqLogin.userId) {
      showToast('请先登录 QQ 音乐再查看我的喜欢', 'warn');
      statusLine.textContent = '请先登录 QQ 音乐再查看我的喜欢';
      return;
    }
    statusLine.textContent = '加载 QQ 音乐喜欢歌单…';
    showView('search');
    emptyState.classList.add('hidden');
    songList.innerHTML = '';
    songList.appendChild(li('加载我的喜欢中…', 'song-row loading'));
    try {
      const res = await api.qqLiked();
      if (res.error || !res.songs || !res.songs.length) {
        songList.innerHTML = '';
        songList.appendChild(li(res.error === 'login' ? '请先登录 QQ 音乐' : (res.error || '我的喜欢暂无歌曲'), 'song-row loading'));
        statusLine.textContent = '我的喜欢暂无歌曲';
        return;
      }
      const songs = res.songs.map((s) => Object.assign({ source: 'qq' }, s));
      renderSongs(songs);
      displayedListKind = 'qq-liked';
      setListHeader('我的喜欢', 'QQ MUSIC · 我的喜欢', songs.length + ' 首歌曲 · 双击播放');
      statusLine.textContent = 'QQ音乐 · 我的喜欢 ' + songs.length + ' 首，双击歌曲播放';
    } catch (err) {
      songList.innerHTML = '';
      songList.appendChild(li('加载失败：' + (err.message || err), 'song-row loading'));
    }
    return;
  }
  if (!loginUserId) {
    showToast('请先登录网易云再查看我的喜欢', 'warn');
    statusLine.textContent = '请先登录网易云再查看我的喜欢';
    return;
  }
  statusLine.textContent = '加载我的喜欢…';
  showView('search');
  emptyState.classList.add('hidden');
  songList.innerHTML = '';
  songList.appendChild(li('加载我的喜欢中…', 'song-row loading'));
  try {
    const res = await api.likedSongsCached(loginUserId);
    if (!res.songs || !res.songs.length) {
      songList.innerHTML = '';
      songList.appendChild(li('我的喜欢暂无歌曲', 'song-row loading'));
      statusLine.textContent = '我的喜欢暂无歌曲';
      return;
    }
    renderSongs(res.songs);
    displayedListKind = 'netease-liked';
    setListHeader('我的喜欢', 'NETEASE · 我的喜欢', res.songs.length + ' 首歌曲 · 双击播放');
    statusLine.textContent = '我的喜欢 · ' + res.songs.length + ' 首，双击歌曲播放';
  } catch (err) {
    songList.innerHTML = '';
    songList.appendChild(li('加载失败：' + (err.message || err), 'song-row loading'));
  }
}
// 喜欢/取消喜欢后：实时同步「我的喜欢」列表与首页卡片
async function syncLikedAfterChange(platform, id, liked) {
  const pf = platform === 'qq' ? 'qq' : 'netease';
  const idStr = String(id);
  const kind = pf + '-liked';
  if (displayedListKind === kind) {
    const idx = displayedList.findIndex((s) => String(s.id) === idStr && (s.source || 'netease') === pf);
    if (!liked && idx >= 0) {
      displayedList.splice(idx, 1);
      renderSongs(displayedList);
    } else if (liked && idx < 0) {
      try {
        const res = pf === 'qq' ? await api.qqLiked() : await api.likedSongsCached(loginUserId);
        if (res && Array.isArray(res.songs) && res.songs.length) {
          renderSongs(pf === 'qq' ? res.songs.map((s) => Object.assign({ source: 'qq' }, s)) : res.songs);
        }
      } catch (err) { /* 忽略 */ }
    }
  }
  refreshLikedHomeCard(pf);
}

async function refreshLikedHomeCard(pf) {
  const hero = $('likedHeroBtn');
  const card = document.querySelector('#playlistGrid .liked-card');
  try {
    if (pf === 'qq') {
      if (!qqLogin.loggedIn || !qqLogin.userId) return;
      const liked = await api.qqLiked().catch(() => null);
      if (!liked || liked.error || !liked.songs) return;
      likedSummaryCache = { name: '我的喜欢', trackCount: liked.songs.length };
      if (hero) hero.textContent = '♥ 我的喜欢 · QQ音乐';
      updateLikedCardBadge(card, liked.songs.length);
      return;
    }
    if (!loginUserId) return;
    const summary = await api.likedSummary(loginUserId).catch(() => null);
    likedSummaryCache = summary;
    const n = (summary && summary.trackCount) || 0;
    if (hero) hero.textContent = n > 0 ? '♥ 我的喜欢 · ' + n : '♥ 我的喜欢';
    updateLikedCardBadge(card, n);
  } catch (err) { /* 忽略 */ }
}

function updateLikedCardBadge(card, n) {
  if (!card) return;
  let badge = card.querySelector('.pl-badge');
  if (n > 0) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'pl-badge';
      const cover = card.querySelector('.pl-cover');
      if (cover) cover.appendChild(badge);
    }
    badge.textContent = n + ' 首';
  } else if (badge) {
    badge.remove();
  }
}

function setListHeader(title, tag, sub) {
  const lh = $('listHeader');
  if (!lh) return;
  $('listHeaderTitle').textContent = title;
  $('listHeaderTag').textContent = tag;
  $('listHeaderSub').textContent = sub;
  lh.classList.remove('hidden');
}

async function openPlaylist(p, platform) {
  const isQq = platform === 'qq' || String(p.id).startsWith('qqpl:');
  statusLine.textContent = '加载歌单《' + p.name + '》…';
  showView('search');
  emptyState.classList.add('hidden');
  songList.innerHTML = '';
  songList.appendChild(li('加载歌单中…', 'song-row loading'));
  try {
    const res = isQq ? await api.qqPlaylistDetail(p.id) : await api.playlistDetail(p.id);
    const songs = isQq ? res.songs.map((s) => Object.assign({ source: 'qq' }, s)) : res.songs;
    renderSongs(songs);
    displayedListKind = (isQq ? 'qq' : 'netease') + '-pl';
    setListHeader(res.name || p.name, isQq ? 'QQ MUSIC · 歌单' : 'NETEASE · 歌单', songs.length + ' 首歌曲 · 双击播放');
    if (!songs.length) {
      statusLine.textContent = '歌单《' + (res.name || p.name) + '》暂无歌曲' + (res.error ? '（' + res.error + '）' : '');
      return;
    }
    statusLine.textContent = '歌单《' + (res.name || p.name) + '》共 ' + songs.length + ' 首，双击歌曲播放';
  } catch (err) {
    songList.innerHTML = '';
    songList.appendChild(li('加载歌单失败：' + (err.message || err), 'song-row loading'));
  }
}

$('fmBtn').addEventListener('click', startFm);
$('likedHeroBtn').addEventListener('click', () => openLiked(activePlatform === 'qq' ? 'qq' : 'netease'));
$('listPlayAllBtn').addEventListener('click', () => {
  if (!displayedList.length) return;
  playFromQueue(displayedList, 0);
});

async function startFm() {
  fmActive = true;
  statusLine.textContent = '私人FM · 加载推荐歌曲…';
  stageStatus.textContent = '私人FM · 加载中…';
  try {
    const res = await api.fm();
    if (!res.songs || !res.songs.length) {
      fmActive = false;
      stageStatus.textContent = '私人FM 暂无内容（可能需要登录网易云）';
      statusLine.textContent = '私人FM 暂无内容，请先登录';
      return;
    }
    fmQueue = res.songs;
    fmIndex = 0;
    queue = [];
    queueIndex = -1;
    nextBtn.disabled = false;
    prevBtn.disabled = true;
    prefetchListUrls(fmQueue); // 预取 FM 队列播放地址
    statusLine.textContent = '私人FM · 为你推荐 ' + fmQueue.length + ' 首';
    playSong(fmQueue[0]);
    stageStatus.textContent = '私人FM · 正在播放';
  } catch (err) {
    fmActive = false;
    stageStatus.textContent = '私人FM 加载失败：' + (err.message || err);
    statusLine.textContent = '私人FM 加载失败：' + (err.message || err);
  }
}

async function playNextFm() {
  fmIndex++;
  if (fmIndex >= fmQueue.length) {
    statusLine.textContent = '私人FM · 加载更多…';
    try {
      const res = await api.fm();
      if (res.songs && res.songs.length) fmQueue = fmQueue.concat(res.songs);
    } catch (err) { /* 忽略，循环播放现有队列 */ }
    if (fmIndex >= fmQueue.length) fmIndex = 0;
  }
  playSong(fmQueue[fmIndex]);
}

// ================= 搜索 / 列表 =================
// 热度：网易云用官方 pop（0-100）；QQ 无热度字段，用搜索结果位次作代理热度
function heatOf(s, idx, count) {
  const n = Number(s.pop || s.score || s.hot || 0);
  if (n > 0) return n;
  return Math.max(0, Math.round(100 - (idx / Math.max(count - 1, 1)) * 88));
}
// 按热度分桶、桶内双平台交错合并：网易云与 QQ 均匀混排，不再全是网易云在最上面
function mergeByHeat(listA, listB) {
  const buckets = new Map();
  const push = (s, src) => {
    let b = buckets.get(s._heat);
    if (!b) { b = { n: [], q: [] }; buckets.set(s._heat, b); }
    b[src].push(s);
  };
  listA.forEach((s) => push(s, 'n'));
  listB.forEach((s) => push(s, 'q'));
  const out = [];
  for (const h of Array.from(buckets.keys()).sort((a, b) => b - a)) {
    const { n, q } = buckets.get(h);
    let i = 0, j = 0;
    while (i < n.length || j < q.length) {
      if (i < n.length) out.push(n[i++]);
      if (j < q.length) out.push(q[j++]);
    }
  }
  return out;
}
async function doSearch() {
  const kw = searchInput.value.trim();
  showView('search');
  if (!kw) return;
  emptyState.classList.add('hidden');
  songList.innerHTML = '';
  songList.appendChild(li('搜索中…', 'song-row loading'));
  try {
    const [nRes, qRes] = await Promise.all([
      api.search(kw).catch(() => []),
      api.qqSearch(kw).catch(() => [])
    ]);
    const nArr = Array.isArray(nRes) ? nRes : [];
    const qArr = Array.isArray(qRes) ? qRes : [];
    const nSongs = nArr.map((s, i) => Object.assign({ source: 'netease', _heat: heatOf(s, i, nArr.length) }, s));
    const qSongs = qArr.map((s, i) => Object.assign({ source: 'qq', _heat: heatOf(s, i, qArr.length) }, s));
    const songs = mergeByHeat(nSongs, qSongs);
    renderSongs(songs);
    statusLine.textContent = songs.length
      ? '找到 ' + songs.length + ' 首歌曲（网易云 ' + nSongs.length + ' · QQ音乐 ' + qSongs.length + '），按热度混合排序，双击播放'
      : '没有找到相关歌曲';
  } catch (err) {
    songList.innerHTML = '';
    songList.appendChild(li('搜索失败：' + (err.message || err), 'song-row loading'));
  }
}

function renderSongs(songs) {
  displayedList = songs;
  displayedListKind = ''; // 默认非喜欢列表，openLiked 会再覆盖
  const lh = $('listHeader'); if (lh) lh.classList.add('hidden');
  songList.innerHTML = '';
  if (!songs.length) {
    songList.appendChild(li('没有找到相关歌曲', 'song-row loading'));
    return;
  }
  songs.forEach((s, i) => songList.appendChild(makeSongRow(s, i)));
  prefetchListUrls(songs); // 后台预取整列表播放地址：点谁秒开
}

// 会员歌曲的对应 UI 提示：列表与队列行统一标记（无法播放时加强暗示）
function markRowVip(pf, id) {
  const key = String(id);
  document.querySelectorAll('#songList .song-row').forEach((row) => {
    if (row.dataset.pf === pf && row.dataset.id === key) {
      row.classList.add('vip-blocked');
      let vip = row.querySelector('.song-vip');
      if (!vip) {
        vip = document.createElement('span');
        vip.className = 'song-vip ' + (pf === 'qq' ? 'qq' : 'netease');
        const titleEl = row.querySelector('.song-info .t');
        if (titleEl) titleEl.appendChild(vip);
      }
      vip.textContent = pf === 'qq' ? '需绿钻' : '需会员';
      vip.title = '没有对应会员权限，无法播放该歌曲';
    }
  });
  document.querySelectorAll('#queueList .queue-row').forEach((row) => {
    if (row.dataset.pf === pf && row.dataset.id === key) {
      row.classList.add('vip-blocked');
      const nameEl = row.querySelector('.q-name');
      if (nameEl && !nameEl.querySelector('.q-vip')) {
        const vip = document.createElement('span');
        vip.className = 'q-vip ' + (pf === 'qq' ? 'qq' : 'netease');
        vip.textContent = pf === 'qq' ? '绿钻' : 'VIP';
        nameEl.appendChild(vip);
      }
    }
  });
}

function li(text, cls) {
  const el = document.createElement('li');
  el.className = cls || '';
  el.textContent = text;
  return el;
}

function makeSongRow(s, i) {
  const row = document.createElement('li');
  row.className = 'song-row';
  row.dataset.pf = s.source || 'netease';
  row.dataset.id = String(s.id || '');
  const idx = document.createElement('span');
  idx.className = 'song-idx';
  idx.textContent = String(i + 1).padStart(2, '0');
  const cover = document.createElement('div');
  cover.className = 'mini-cover';
  if (s.cover) {
    const img = new Image();
    img.onload = () => { cover.textContent = ''; cover.appendChild(img); };
    img.src = s.cover;
  } else {
    cover.innerHTML = svgIcon('note', 15);
  }
  const info = document.createElement('div');
  info.className = 'song-info';
  info.innerHTML = '<div class="t"></div><div class="a"></div>';
  const title = info.children[0];
  title.textContent = '';
  const titleTxt = document.createElement('span');
  titleTxt.className = 'song-name-txt';
  titleTxt.textContent = s.name;
  title.appendChild(titleTxt);
  if (s.source) {
    const src = document.createElement('span');
    src.className = 'song-src ' + (s.source === 'qq' ? 'qq' : 'netease');
    src.textContent = s.source === 'qq' ? 'QQ音乐' : '网易云';
    title.appendChild(src);
    if (s.vip || s.fee > 0) {
      const vip = document.createElement('span');
      vip.className = 'song-vip ' + (s.source === 'qq' ? 'qq' : 'netease');
      vip.textContent = s.source === 'qq' ? '会员' : 'VIP';
      vip.title = '会员歌曲：开通对应会员后可播放';
      title.appendChild(vip);
    }
  }
  info.children[1].textContent = s.artist + ' · 《' + s.album + '》';
  const dur = document.createElement('div');
  dur.className = 'song-dur';
  dur.textContent = fmt(s.dt / 1000);
  const play = document.createElement('span');
  play.className = 'song-play';
  play.innerHTML = svgIcon('play', 15);
  row.append(idx, cover, info, play, dur);
  const start = () => {
    if (typeof i === 'number') playFromQueue(displayedList, i);
    else playSong(s);
  };
  row.ondblclick = start;
  play.addEventListener('click', (e) => { e.stopPropagation(); start(); });
  return row;
}

// ================= 播放 =================
function playFromQueue(songs, idx) {
  queue = songs.slice();
  fmActive = false;
  playSong(queue[idx], idx);
}

const urlCache = new Map(); // 播放地址缓存：id -> url（预取下一首，切歌秒开）
const actualLevelMap = new Map(); // id -> 实际生效音质（Hi-Res 不可用时记录降级结果）
const lyricCache = new Map(); // 歌词缓存：id -> 解析结果（切回同曲免请求）
const coverCache = new Map(); // 封面缓存：url -> dataURL
const audioNext = new Audio(); // 隐藏预载元素：后台缓冲下一首音频数据，切歌秒开
let audioNextSongId = null;    // audioNext 当前缓冲的目标歌曲 id
audioNext.preload = 'auto';
const urlPending = new Map(); // 进行中的 URL 请求去重：id -> Promise（列表预取与播放共用，避免重复请求）

// 共享解析：并发去重，同一首歌同一时刻只发一个请求
function resolveUrlShared(id, platform) {
  const pf = platform || 'netease';
  const key = pf + ':' + String(id) + ':' + qualityLevel;
  const hit = urlPending.get(key);
  if (hit) return hit;
  const p = api.resolveUrl(id, qualityLevel, pf).then((res) => {
    if (res && res.url) {
      actualLevelMap.set(key, res.level || qualityLevel);
      return res.url;
    }
    return res || null;
  }).finally(() => { urlPending.delete(key); });
  urlPending.set(key, p);
  return p;
}

async function cachedResolveUrl(id, platform) {
  const pf = platform || 'netease';
  const key = pf + ':' + String(id) + ':' + qualityLevel;
  if (urlCache.has(key)) {
    const u = urlCache.get(key);
    urlCache.delete(key); // 每次消费后移除，避免 URL 过期复用
    return u;
  }
  let u = await resolveUrlShared(id, pf);
  if (!u) u = await resolveUrlShared(id, pf); // 瞬时网络抖动自动重试一次
  if (u) {
    urlCache.set(key, u);
    if (urlCache.size > 60) { const k = urlCache.keys().next().value; urlCache.delete(k); }
  }
  return u;
}
function actualQualityLabel(id, platform) {
  const k = (platform || 'netease') + ':' + String(id) + ':' + qualityLevel;
  const lvl = actualLevelMap.get(k);
  return lvl && lvl !== qualityLevel ? '（实际' + qualityLabel(lvl) + '）' : '';
}

// 整列表 URL 预取：渲染歌单/搜索结果时后台解析前若干首，点谁秒开
const LIST_PREFETCH_MAX = 8; // 每列表最多预取条数（避免并发挤占播放请求）
let listPrefetchDone = 0;
// 预取信号量：同时最多 2 个预取请求在途，播放请求不受预取排队影响（网易接口对并发敏感）
let prefetchInFlight = 0;
const PREFETCH_CONCURRENCY = 2;
async function prefetchResolve(id, platform) {
  while (prefetchInFlight >= PREFETCH_CONCURRENCY) await new Promise((r) => setTimeout(r, 120));
  prefetchInFlight++;
  try { return await resolveUrlShared(id, platform); } finally { prefetchInFlight--; }
}
function prefetchListUrls(songs) {
  if (!songs || !songs.length) return;
  let count = 0;
  for (const sng of songs) {
    if (count >= LIST_PREFETCH_MAX) break;
    const pf = (sng && sng.platform) || 'netease';
    const id = String(sng && sng.id);
    const k = pf + ':' + id + ':' + qualityLevel;
    if (!id || id === 'undefined' || urlCache.has(k) || urlPending.has(k)) continue;
    count++;
    prefetchResolve(id, pf).then((u) => {
      if (u && typeof u === 'string') {
        urlCache.set(k, u);
        const nextSong = queue[queueIndex + 1] || {};
        const isNext = !fmActive && pf + ':' + id === String(nextSong.platform || 'netease') + ':' + String(nextSong.id);
        if (isNext && audioNext) { audioNextSongId = pf + ':' + id; audioNext.src = u; audioNext.load(); }
      } else if (u && u.error) {
        urlCache.set(k, u);
        if (u.error === 'vip') markRowVip(pf, id);
      }
    }).catch(() => { /* 预取失败可忽略 */ });
  }
}

// 预取下一首（含第 2 首 URL），并预热下一首音频数据
function prefetchNextUrls() {
  if (fmActive || queueIndex < 0 || !queue.length) return;
  const list = [];
  if (queue[queueIndex + 1]) list.push(queue[queueIndex + 1]);
  if (queue[queueIndex + 2]) list.push(queue[queueIndex + 2]);
  if (playMode === 'repeat') {
    if (!list.length && queue[0]) list.push(queue[0]);
    else if (queue[queueIndex + 2] === undefined && queue[1]) list.push(queue[0]);
  }
  if (playMode === 'shuffle' && queue.length > 1) {
    let r; do { r = Math.floor(Math.random() * queue.length); } while (r === queueIndex);
    list.push(queue[r]);
  }
  const seen = new Set();
  for (const sng of list) {
    const pf = (sng && sng.platform) || 'netease';
    const id = String(sng && sng.id);
    const k = pf + ':' + id + ':' + qualityLevel;
    if (seen.has(pf + ':' + id) || urlCache.has(k) || urlPending.has(k)) continue;
    seen.add(pf + ':' + id);
    prefetchResolve(id, pf).then((u) => {
      if (u && typeof u === 'string') {
        urlCache.set(k, u);
        const nextSong = queue[queueIndex + 1] || {};
        const isNext = playMode === 'shuffle' ? queue.length > 1 : (pf + ':' + id === String(nextSong.platform || 'netease') + ':' + String(nextSong.id));
        if (isNext && audioNext) { audioNextSongId = pf + ':' + id; audioNext.src = u; audioNext.load(); } // 预热音频数据
      } else if (u && u.error) {
        urlCache.set(k, u);
        if (u.error === 'vip') markRowVip(pf, id);
      }
    }).catch(() => { /* 预取失败可忽略 */ });
  }
}

let playGen = 0; // 切歌序号：防止慢的旧解析结果覆盖新歌
async function playSong(song, idx) {
  let retried = false; // 地址解析瞬时失败时自动重试一次
  const gen = ++playGen; // 切歌序号：防止慢的旧解析结果覆盖新歌
  try {
    if (typeof idx === 'number') queueIndex = idx;
    currentSong = song;
    recordHistory(song);
    // 立即反馈：标题 / 舞台切换 / 状态，不必等播放地址返回
    pbTitle.textContent = song.name;
    pbArtist.textContent = song.artist + ' · ' + song.album;
    stageTitle.textContent = song.name;
    stageArtist.textContent = song.artist + ' · ' + song.album;
    showView('stage');
    loadLyricOffset();
    updateQueueButtons();
    // 并行：歌词 / 封面 / 播放地址（缓存命中时秒开）
    loadLyrics(song.id, song.platform, song);
    applyCover(song.cover);
    statusLine.textContent = '正在加载：' + song.name + '…';
    stageStatus.textContent = '解析播放地址…';
    setLoading(true, '解析播放地址…');
    prefetchNextUrls(); // 立即预取下一首，与当前 URL 解析并行（省去串行等待）
    // audioNext 已预载目标歌时直接接管其 URL：跳过解析，CDN 已命中，秒开
    let url = null;
    const songKey = String(song.platform || 'netease') + ':' + String(song.id);
    if (audioNext && audioNext.src && String(audioNextSongId) === songKey && audioNext.readyState >= 3) {
      url = audioNext.src;
    } else {
      url = await cachedResolveUrl(song.id, song.platform);
    }
    if (!url) throw new Error('播放地址解析失败（网络或接口暂时不可用），请稍后重试');
    if (url && url.error) {
      if (url.error === 'vip') {
        retried = true; // 会员权限问题无需自动重试
        markRowVip(song.platform || 'netease', song.id);
        const need = (song.platform || 'netease') === 'qq' ? 'QQ音乐绿钻/豪华绿钻' : '网易云黑胶VIP/SVIP';
        throw new Error('该歌曲为' + need + '会员歌曲，开通对应会员后即可播放');
      }
      throw new Error('播放地址解析失败：' + (url.error || '未知原因'));
    }
    initAudio();
    if (gen !== playGen) { setLoading(false); return; } // 已被更新的切歌取代，丢弃过期解析结果
    audio.src = url;
    audio.volume = baseVolume;
    audio.playbackRate = playRate;
    setNowPlaying(song);
    pushMiniState(true);
    audio.play().then(() => { fadeIn(500); }).catch((e) => { stageStatus.textContent = '播放失败：' + e.message; });
    setLoading(false);
    statusLine.textContent = '正在播放：' + song.name + ' - ' + song.artist;
  } catch (err) {
    if (gen !== playGen) { setLoading(false); return; } // 过期的旧切歌，不处理
    setLoading(false);
    // 解析失败时停止旧音频，避免 UI 显示新歌却继续播放旧歌
    try { if (!audio.paused) audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* 忽略 */ }
    audio.volume = baseVolume;
    stageStatus.textContent = '获取播放地址失败：' + err.message;
    showToast('获取播放地址失败：' + err.message, 'err');
    statusLine.textContent = '获取播放地址失败：' + err.message;
    // 自动重试仅在用户仍停留在播放页时进行：返回列表后不再强行弹回
    if (!retried && views.stage && !views.stage.classList.contains('hidden')) {
      retried = true;
      stageStatus.textContent = '解析失败，2 秒后自动重试…';
      setTimeout(() => {
        if (views.stage && !views.stage.classList.contains('hidden')) playSong(song, idx);
      }, 1800);
    }
  }
}
function setNowPlaying(song) {
  // 高亮当前正在播放的列表行
  document.querySelectorAll('#songList .song-row').forEach((row) => {
    const pf = song && song.platform === 'qq' ? 'qq' : 'netease';
    row.classList.toggle('playing', !!song && String(row.dataset.id) === String(song.id) && row.dataset.pf === pf);
  });
  pbTitle.textContent = song.name;
  pbArtist.textContent = song.artist + ' · ' + song.album;
  stageTitle.textContent = song.name;
  stageArtist.textContent = song.artist + ' · ' + song.album;
  playBtn.disabled = false;
  playBtn.innerHTML = svgIcon('play', 25);
  progress.disabled = false;
  refreshLikeState(song.id, song.platform);
}

function updateQueueButtons() {
  if (fmActive) { nextBtn.disabled = false; prevBtn.disabled = false; return; }
  const canNext = queue.length > 1 && (
    playMode === 'shuffle' || playMode === 'repeat' ||
    (queueIndex >= 0 && queueIndex < queue.length - 1)
  );
  nextBtn.disabled = !canNext;
  prevBtn.disabled = !(queue.length && queueIndex > 0);
}

// ================= 播放模式：顺序 / 列表循环 / 单曲循环 / 随机 =================
const PLAY_MODES = ['order', 'repeat', 'repeat-one', 'shuffle'];
const PLAY_MODE_META = {
  order: { icon: 'modeOrder', label: '顺序播放' },
  repeat: { icon: 'modeRepeat', label: '列表循环' },
  'repeat-one': { icon: 'modeRepeatOne', label: '单曲循环' },
  shuffle: { icon: 'modeShuffle', label: '随机播放' }
};
let playMode = localStorage.getItem('qin-play-mode') || 'order';
if (!PLAY_MODE_META[playMode]) playMode = 'order';
function setPlayMode(mode) {
  playMode = mode;
  localStorage.setItem('qin-play-mode', mode);
  const meta = PLAY_MODE_META[mode];
  playModeBtn.innerHTML = svgIcon(meta.icon, 17);
  playModeBtn.title = '播放模式：' + meta.label + '（点击切换）';
  playModeBtn.dataset.mode = mode;
  playModeBtn.classList.toggle('on', mode !== 'order');
  updateQueueButtons();
  statusLine.textContent = '播放模式：' + meta.label;
}
playModeBtn.addEventListener('click', () => {
  const i = PLAY_MODES.indexOf(playMode);
  setPlayMode(PLAY_MODES[(i + 1) % PLAY_MODES.length]);
});
setPlayMode(playMode);

function nextTrackIndex(auto) {
  if (!queue.length) return -1;
  if (playMode === 'shuffle') {
    if (queue.length === 1) return 0;
    let i;
    do { i = Math.floor(Math.random() * queue.length); } while (i === queueIndex);
    return i;
  }
  if (queueIndex < 0) return 0;
  if (auto && playMode === 'repeat-one') return queueIndex; // 单曲循环由 goNext 单独处理
  const nxt = queueIndex + 1;
  if (nxt < queue.length) return nxt;
  return auto && playMode === 'repeat' ? 0 : -1;
}
function goNext(auto) {
  if (fmActive) { playNextFm(); return; }
  if (auto && playMode === 'repeat-one' && queue.length) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const i = nextTrackIndex(auto);
  if (i >= 0) playSong(queue[i], i);
}
function goPrev() {
  if (fmActive) return;
  if (audio.currentTime > 3 && audio.duration) { audio.currentTime = 0; return; } // 重新开始当前曲
  if (queue.length && queueIndex > 0) playSong(queue[queueIndex - 1], queueIndex - 1);
}

// ================= 切歌淡入淡出 =================
let baseVolume = 0.8;
function fadeOut(cb, ms) {
  const t0 = performance.now();
  const step = () => {
    const k = Math.max(0, 1 - (performance.now() - t0) / (ms || 900));
    audio.volume = baseVolume * k;
    if (k > 0) requestAnimationFrame(step);
    else cb();
  };
  step();
}
function fadeIn(ms) {
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / (ms || 450));
    audio.volume = baseVolume * k;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

// ================= 播放队列面板 =================
function renderQueue() {
  const list = $('queueList');
  list.innerHTML = '';
  if (fmActive) {
    const d = document.createElement('div');
    d.className = 'queue-empty';
    d.textContent = '私人FM 模式：由网易云智能推荐连播';
    list.appendChild(d);
    return;
  }
  if (!queue.length) {
    const d = document.createElement('div');
    d.className = 'queue-empty';
    d.textContent = '队列为空：双击歌单 / 搜索结果开始播放';
    list.appendChild(d);
    return;
  }
  const frag = document.createDocumentFragment();
  queue.forEach((sng, i) => {
    const row = document.createElement('div');
    row.className = 'queue-row' + (i === queueIndex ? ' current' : '');
    row.dataset.pf = sng.platform || 'netease';
    row.dataset.id = String(sng.id || '');
    row.innerHTML = '<span class="q-idx"></span><span class="q-name"></span><span class="q-artist"></span>';
    row.children[0].textContent = String(i + 1).padStart(2, '0');
    row.children[1].textContent = sng.name;
    row.children[2].textContent = sng.artist;
    row.addEventListener('click', () => { playSong(sng, i); toggleQueue(false); });
    frag.appendChild(row);
  });
  list.appendChild(frag);
}
function toggleQueue(show) {
  const panel = $('queuePanel');
  const next = show === undefined ? panel.classList.contains('hidden') : show;
  panel.classList.toggle('hidden', !next);
  queuePanelOpen = next;
  if (next) renderQueue(); // 打开时渲染
}
$('queueBtn').addEventListener('click', () => toggleQueue());
$('queueClose').addEventListener('click', () => toggleQueue(false));

// ================= 封面（主进程代理 + 取色） =================
async function loadCoverImg(url) {
  if (!url) return { img: null, data: '' };
  try {
    let data = coverCache.get(url);
    if (!data) {
      data = await api.fetchCover(url);
      if (data) {
        coverCache.set(url, data);
        if (coverCache.size > 80) { const k = coverCache.keys().next().value; coverCache.delete(k); }
      }
    }
    if (!data) { console.warn('[cover] fetchCover empty for', url); return { img: null, data: '' }; }
    const img = new Image();
    img.src = data;
    try { await img.decode(); } catch (err) { console.warn('[cover] img.decode failed', url, err && err.message); return { img: null, data: '' }; }
    console.warn('[cover] decoded', url, 'dataLen', data.length);
    return { img, data };
  } catch (err) {
    return { img: null, data: '' };
  }
}

async function applyCover(url) {
  const { img, data } = await loadCoverImg(url);
  // 用代理后的封面数据（绕过 CDN CORS）喂给 Mineradio 舞台，保证背景粒子能拼出封面
  if (data && mrStage) { try { mrStage.setCoverData(data, url); console.warn('[cover] setCoverData ok', url); } catch (err) { console.warn('[cover] setCoverData ERR', url, err && err.message); } }
  if (data) { try { window.__coverDataCache = { url: url, data: data }; } catch (err) { /* ignore */ } }
  const tex = coverTextureFromImage(img);
  const body = discGroup.children[0];
  body.material.map = tex;
  body.material.needsUpdate = true;
  if (img) extractHue(img);
  if (img) {
    // Folia 技巧：把封面烘焙成 96px 模糊图放大铺底，避免全屏 blur(40px) 逐帧重栅格化
    const bc = document.createElement('canvas');
    bc.width = bc.height = 96;
    const bg = bc.getContext('2d');
    bg.imageSmoothingEnabled = true;
    bg.imageSmoothingQuality = 'high';
    const nw = img.naturalWidth || 300, nh = img.naturalHeight || 300;
    const s = Math.min(nw, nh);
    bg.drawImage(img, (nw - s) / 2, (nh - s) / 2, s, s, 0, 0, 96, 96);
    stageCoverBg.style.backgroundImage = `url(${bc.toDataURL('image/jpeg', 0.72)})`;
    stageCoverBg.classList.add('has-cover');
    syncCoverOpacity();
  } else {
    stageCoverBg.style.backgroundImage = '';
    stageCoverBg.classList.remove('has-cover');
    syncCoverOpacity();
  }
  pbCover.textContent = '';
  if (url) {
    const cimg = new Image();
    cimg.onload = () => { pbCover.textContent = ''; pbCover.appendChild(cimg); };
    cimg.src = url;
  } else {
    pbCover.innerHTML = svgIcon('note', 15);
  }
}

// ================= 沉浸式歌词舞台（Folia 风格重制） =================
let lyricMeta = [];          // 每行：{ time, end, text, chars:[{ch,start,end}] }
function syncMrLyricMeta() { window.__qinLyricMeta = lyricMeta; }
let transMap = [];              // 翻译行：{ time, text }
let stageLineEl = null;      // 当前活动行 DOM
let stageLineIdx = -1;
const REMOVED_STAGE_MODES = ['ring', 'orbit', 'star-river', 'classic', 'pendolo', 'flow', 'cloud', 'heart', 'aurora', 'cascade'];
let stageMode = localStorage.getItem('qin-lyric-mode') || 'sonnet'; // 首次使用默认商簁，用户手动切换后保留选择
if (REMOVED_STAGE_MODES.indexOf(stageMode) >= 0) { stageMode = 'sonnet'; try { localStorage.setItem('qin-lyric-mode', stageMode); } catch (err) { /* 忽略 */ } }
let lyricOffsetMs = 0; // 歌词手动同步偏移（毫秒，负=提前，正=滞后），按歌曲记忆

function lyricSec() {
  return demoMode ? demoTime : Math.max(0, (audio.currentTime || 0) + lyricOffsetMs / 1000);
}
function lyricOffsetKey() {
  return currentSong && currentSong.id ? 'qin-lyric-offset-' + currentSong.id : null;
}
function loadLyricOffset() {
  const k = lyricOffsetKey();
  lyricOffsetMs = 0;
  if (k) { try { lyricOffsetMs = parseInt(localStorage.getItem(k) || '0', 10) || 0; } catch (err) { lyricOffsetMs = 0; } }
  lyricOffsetMs = Math.max(-5000, Math.min(5000, lyricOffsetMs));
  updateLyricOffsetChip();
}
function saveLyricOffset() {
  const k = lyricOffsetKey();
  if (k) { try { localStorage.setItem(k, String(lyricOffsetMs)); } catch (err) { /* 忽略 */ } }
  updateLyricOffsetChip();
  if (deskLyricBtn && deskLyricBtn.classList.contains('on')) pushLyricLine();
}
function adjustLyricOffset(deltaMs) {
  lyricOffsetMs = Math.max(-5000, Math.min(5000, lyricOffsetMs + deltaMs));
  saveLyricOffset();
  statusLine.textContent = '歌词同步偏移：' + (lyricOffsetMs >= 0 ? '+' : '') + (lyricOffsetMs / 1000).toFixed(2) + 's（[ ] 微调 / 0 归零）';
}
function updateLyricOffsetChip() {
  const chip = $('lyricOffsetChip');
  if (!chip) return;
  chip.classList.toggle('hidden', lyricOffsetMs === 0);
  const txt = $('lyricOffsetText');
  if (txt) txt.textContent = (lyricOffsetMs >= 0 ? '+' : '') + (lyricOffsetMs / 1000).toFixed(2) + 's';
}
const lyricOffsetChipEl = $('lyricOffsetChip');
if (lyricOffsetChipEl) {
  lyricOffsetChipEl.addEventListener('click', () => {
    lyricOffsetMs = 0;
    saveLyricOffset();
    statusLine.textContent = '歌词同步偏移已归零（[ ] 微调 / 0 归零）';
  });
}
let chorusSet = new Set();
let chorusLevel = 0, chorusLevelTarget = 0;
let beatFovKick = 0;
let waveBars = [];
let lastSweepPx = -1;
let cloudLines = [];
let prevStageView = 'home';
let lastNonStageView = 'home';
const stageViewEl = $('stageView');
const lyricFloatEl = $('lyricFloat');
const stageSubtitleEl = $('stageSubtitle');
const stageLyricsEl = $('stageLyrics');
const lyricLoadingEl = $('lyricLoading');
const lyricLoadingText = $('lyricLoadingText');
let lyricLoadToken = 0; // 切歌防串台：迟到的歌词响应直接丢弃
function showLyricLoading(text, bottom) {
  if (!lyricLoadingEl) return;
  lyricLoadingEl.classList.remove('hidden');
  lyricLoadingEl.classList.remove('lyric-loading-error');
  lyricLoadingEl.classList.toggle('lyric-loading-bottom', !!bottom);
  if (lyricLoadingText) lyricLoadingText.textContent = text || '歌词加载中…';
}
function hideLyricLoading() {
  if (!lyricLoadingEl) return;
  lyricLoadingEl.classList.add('hidden');
  lyricLoadingEl.onclick = null;
}
function showLyricLoadingError(text) {
  if (!lyricLoadingEl) return;
  lyricLoadingEl.classList.remove('hidden');
  lyricLoadingEl.classList.add('lyric-loading-error');
  if (lyricLoadingText) lyricLoadingText.textContent = text || '歌词加载失败，点击重试';
  lyricLoadingEl.onclick = () => {
    if (currentSong && currentSong.id) loadLyrics(currentSong.id, currentSong.platform, currentSong);
  };
}

const stageBreatheEl = $('stageBreathe');
const stageProgressFill = $('stageProgressFill');
const stageCoverBg = $('stageCoverBg');
const stageBackBtn = $('stageBack');
const stageLineCls = { classic: 'classic', pendolo: 'pendolo', flow: 'flowline', cloud: 'cloud-line', heart: 'heart-line', sonnet: 'sonnet', aurora: 'aurora-line', cascade: 'cascade-line' };

function lyricSrcLabel(src) {
  if (src === 'amll') return 'AMLL 数据库';
  if (src === 'qq-qrc') return 'QQ QRC（免登录）';
  if (src === 'qq-lrc') return 'QQ 音乐官方 LRC';
  if (src === 'ncm-yrc') return '网易云官方（逐字）';
  if (src === 'ncm') return '网易云官方 LRC';
  return '';
}
function showLyricSrcHint(src) {
  const label = lyricSrcLabel(src);
  if (!label) return;
  showToast('歌词源：' + label, 'info', 3200);
}
let lyricSrcBadgeTimer = null;
function showLyricSrcBadge(src) {
  const b = document.getElementById('lyricSrcBadge');
  if (!b) return;
  const label = lyricSrcLabel(src);
  if (!label) { b.classList.add('hidden'); return; }
  b.textContent = label;
  b.className = 'lyric-src-badge src-' + String(src || 'none').replace(/[^a-z0-9-]/gi, '');
  b.classList.remove('hidden');
  if (lyricSrcBadgeTimer) clearTimeout(lyricSrcBadgeTimer);
  lyricSrcBadgeTimer = setTimeout(function () { b.classList.add('hidden'); }, 8000);
}

async function loadLyrics(id, platform, song) {
  lyricFloatEl.innerHTML = '';
  lyricsLines = [];
  yrcLines = [];
  lyricMeta = [];
  syncMrLyricMeta();
  stageLineEl = null;
  stageLineIdx = -1;
  chorusSet = new Set();
  chorusLevelTarget = 0;
  beatTimes = [];
  destroySonnetRuntime();
  let lyricSrc = '';
  hideLyricLoading();

  const ck = (platform || 'netease') + ':' + String(id);
  const cached = lyricCache.get(ck);
  if (cached) {
    lyricsLines = cached.lyricsLines;
    transMap = cached.transMap;
    yrcLines = cached.yrcLines;
    lyricMeta = cached.lyricMeta;
    syncMrLyricMeta();
    chorusSet = cached.chorusSet;
    compileSonnetProgram();
    if (stageMode === 'sonnet') ensureSonnetRuntime();
    const sec = lyricSec();
    const idx = currentStageIndex(sec);
    if (idx >= 0) showStageLine(idx);
    else lyricFloatEl.innerHTML = '';
    lyricSrc = cached.lyricSrc || '';
    showLyricSrcHint(lyricSrc);
    showLyricSrcBadge(lyricSrc);
    return;
  }

  const songMeta = song ? { name: song.name, artist: song.artist, songmid: song.songmid, songid: song.songid } : null;
  const token = ++lyricLoadToken;
  showLyricLoading('歌词加载中…');
  try {
    // 快速路径：先拿普通 LRC 立刻渲染，避免“歌已响、词空白”
    // 快速路径与完整路径并行发起：fast 先渲染避免“歌已响、词空白”，
    // full 走 main.js 的准确性优先级（AMLL > 官方逐字 > 跨源 QRC > 行级）到齐后升级
    const fastP = api.lyricFast(id, platform, songMeta);
    const fullP = api.lyric(id, platform, songMeta).catch(() => null);
    const fast = await fastP;
    if (token !== lyricLoadToken) return;
    lyricSrc = (fast && typeof fast === 'object' && fast.src) ? fast.src : lyricSrc;
    showLyricSrcBadge(lyricSrc);
    const lrc = (fast && typeof fast === 'object') ? fast.lrc : fast;
    const tlyric = (fast && typeof fast === 'object') ? fast.tlyric : '';
    const yrc = (fast && typeof fast === 'object') ? fast.yrc : '';
    lyricsLines = parseLrc(lrc);
    transMap = parseLrc(tlyric);
    yrcLines = parseYrc(yrc);
    if (lyricsLines.length || yrcLines.length) {
      buildLyricMeta();
      chorusSet = detectChorus(lyricsLines);
      compileSonnetProgram();
      if (stageMode === 'sonnet') ensureSonnetRuntime();
      lyricFloatEl.innerHTML = '';
      if (yrc) hideLyricLoading();
      else showLyricLoading('逐字歌词同步中…', true);
    } else {
      showLyricLoading('歌词加载中…');
    }
    // 完整路径：拉取逐字源（AMLL / QQ QRC）后升级为逐字动画
    const full = await fullP;
    if (token !== lyricLoadToken) return;
    if (full && typeof full === 'object' && full.src) lyricSrc = full.src;
    showLyricSrcBadge(lyricSrc);
    if (full && typeof full === 'object' && full.yrc) {
      yrcLines = parseYrc(full.yrc);
      if (!lyricsLines.length) lyricsLines = parseLrc(full.lrc || '');
      if (!transMap.length) transMap = parseLrc(full.tlyric || '');
      if (lyricsLines.length || yrcLines.length) {
        buildLyricMeta();
        chorusSet = detectChorus(lyricsLines);
        compileSonnetProgram();
        if (stageMode === 'sonnet') ensureSonnetRuntime();
      }
    }
    if (lyricsLines.length || yrcLines.length) { showLyricSrcHint(lyricSrc); showLyricSrcBadge(lyricSrc); }
    hideLyricLoading();
    if (!lyricsLines.length && !yrcLines.length) {
      stageStatus.textContent = '暂无歌词（纯音乐）';
      lyricFloatEl.innerHTML = '';
      return;
    }
    lyricCache.set(ck, { lyricsLines, transMap, yrcLines, lyricMeta, chorusSet, lyricSrc });
    if (lyricCache.size > 60) { const k = lyricCache.keys().next().value; lyricCache.delete(k); }
  } catch (err) {
    if (token !== lyricLoadToken) return;
    showLyricLoadingError('歌词加载失败，点击重试');
  }
}

// 构建逐字时间轴（无词级时间戳时按整行时长均分）
function buildLyricMeta() {
  lyricMeta = [];
  // 逐字（QRC/YRC）存在时：行级 [start,dur] 时间戳直接驱动时间轴，
  // 与普通 LRC 行做文本匹配后取中位偏移修正（同源偏移≈0，跨源也能对齐）
  let yrcOffset = 0;
  let yrcTimeline = false;
  if (yrcLines.length) {
    if (!lyricsLines.length) lyricsLines = yrcLines.map((y) => ({ time: y.time, text: y.text }));
    const deltas = [];
    let matched = 0;
    for (const yl of yrcLines) {
      const nt = normalizeLrcText(yl.text);
      if (!nt) continue;
      let best = null, bestD = Infinity;
      for (const l of lyricsLines) {
        if (Math.abs(l.time - yl.time) > 2.5) continue;
        if (normalizeLrcText(l.text) !== nt) continue;
        const d = Math.abs(l.time - yl.time);
        if (d < bestD) { bestD = d; best = l; }
      }
      if (best) { matched++; deltas.push(yl.time - best.time); }
    }
    if (deltas.length && matched / Math.max(1, yrcLines.length) >= 0.6) {
      deltas.sort((a, b) => a - b);
      yrcOffset = deltas[Math.floor(deltas.length / 2)] || 0;
      if (Math.abs(yrcOffset) <= 2.5) yrcTimeline = true;
    }
  }
  if (yrcTimeline) {
    for (const yl of yrcLines) {
      const time = yl.time + yrcOffset;
      const end = yl.end + yrcOffset;
      const chars = [];
      for (const w of yl.words) {
        const cs = Array.from(w.ch);
        const per = w.d / Math.max(1, cs.length);
        cs.forEach((ch, k) => {
          const st = Math.max(time + 0.02, w.t + yrcOffset + k * per);
          chars.push({ ch, start: st, end: st + Math.max(0.05, per) });
        });
      }
      let singEnd = chars.length ? Math.min(end, chars[chars.length - 1].end + 0.35) : end;
      let trans = '';
      for (let ti = transMap.length - 1; ti >= 0; ti--) {
        if (Math.abs(transMap[ti].time - time) <= 2.5) { trans = transMap[ti].text; break; }
      }
      lyricMeta.push({ time, end, singEnd, text: yl.text, chars, trans, wordTimed: chars.length > 0 });
    }
    syncMrLyricMeta();
    return;
  }
  buildLyricMetaFallback();
}
function buildLyricMetaFallback() {
  lyricMeta = [];
  for (let i = 0; i < lyricsLines.length; i++) {
    const l = lyricsLines[i];
    const end = lyricsLines[i + 1] ? lyricsLines[i + 1].time : l.time + 4;
    const textArr = Array.from(l.text);
    const n = Math.max(1, textArr.length);
    const yl = matchYrcLine(l);
    // 演唱结束时间 singEnd：YRC 用词级行真实结束；否则按字数估算演唱时长，避免间奏前一句拖到下一句才切
    let singEnd = end;
    if (yl && yl.end > l.time + 0.3) singEnd = Math.min(end, yl.end + 0.05);
    else {
      // 按语速估算演唱时长（~0.26s/字）：连续句间留 0.12s 换气、间奏前不拖满整段
      const est = l.time + Math.max(0.9, n * 0.26 + 0.22);
      singEnd = Math.min(end - 0.12, est);
      if (singEnd < l.time + 0.4) singEnd = Math.min(end, l.time + 0.4);
    }
    singEnd = Math.max(l.time + 0.4, Math.min(end, singEnd));
    // 逐字在演唱结束前 0.1s 点亮完毕：按可用时长均分，保证长句也能完整点亮
    const usable = Math.max(0.35, singEnd - l.time - 0.1);
    const seg = usable / Math.max(1, n - 1);
    const span = singEnd - l.time;
    let chars = null;
    if (yl) {
      const limit = Math.max(l.time + 0.3, singEnd - 0.08);
      const raw = [];
      for (const w of yl.words) {
        const cs = Array.from(w.ch);
        const per = w.d / Math.max(1, cs.length);
        cs.forEach((ch, k) => {
          raw.push({ ch, start: Math.max(l.time + 0.02, w.t + k * per), dur: per });
        });
      }
      let cursor = l.time + 0.02;
      chars = raw.map((r) => {
        const st = Math.max(r.start, cursor);
        const en = Math.min(limit, st + Math.max(0.05, r.dur));
        cursor = Math.max(en, st + 0.05);
        return { ch: r.ch, start: st, end: en, snapped: false };
      });
      if (chars.length < Math.max(2, Math.ceil(n * 0.5))) chars = null;
      else l.text = chars.map((c2) => c2.ch).join('');
    }
    if (!chars) {
      const lineBeats = beatTimes.filter((bt) => bt > l.time + 0.03 && bt < singEnd - 0.03);
      if (lineBeats.length) {
        // 卡点：字符起始吸附到最近的节拍（karaoke 逐字卡点）
        chars = textArr.map((ch, ci) => {
          const frac = n > 1 ? ci / (n - 1) : 0;
          const base = l.time + frac * span;
          let best = base, bestD = Infinity;
          for (const bt of lineBeats) {
            const d = Math.abs(bt - base);
            if (d < bestD) { bestD = d; best = bt; }
          }
          const halfSeg = (span / n) * 0.55;
          return { ch, start: Math.max(l.time, bestD < halfSeg ? best : base), end: 0, snapped: false };
        });
        chars.forEach((c2, ci2) => {
          const next = chars[ci2 + 1];
          c2.end = Math.min(singEnd - 0.12, next ? Math.max(c2.start + 0.1, (next.start + c2.start) / 2) : c2.start + Math.max(0.26, span / n));
        });
      } else {
        chars = textArr.map((ch, ci) => {
          const st = l.time + ci * seg;
          const en = ci === n - 1 ? l.time + usable : l.time + (ci + 1) * seg;
          return { ch, start: st, end: Math.max(st + 0.04, en), snapped: false };
        });
      }
    }
    let trans = '';
    for (let ti = transMap.length - 1; ti >= 0; ti--) {
      if (Math.abs(transMap[ti].time - l.time) <= 0.8) { trans = transMap[ti].text; break; }
    }
    lyricMeta.push({ time: l.time, end, singEnd, text: l.text, chars, trans, wordTimed: !!yl });
  }
  syncMrLyricMeta();
}

function detectChorus(lines) {
  const counts = new Map();
  lines.forEach((l) => counts.set(l.text, (counts.get(l.text) || 0) + 1));
  let max = 1;
  counts.forEach((v) => { if (v > max) max = v; });
  const set = new Set();
  if (max > 1) counts.forEach((v, k) => { if (v === max) set.add(k); });
  return set;
}

function parseLrc(lrc) {
  const lines = [];
  let offsetMs = 0;
  const offRe = /\[offset:\s*([+-]?\d+)\s*\]/i;
  const offM = offRe.exec(String(lrc || ''));
  if (offM) offsetMs = parseInt(offM[1], 10) || 0;
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  String(lrc || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const t = (+m[1]) * 60 + (+m[2]) + (+String(m[3] || '0').padEnd(3, '0')) / 1000 + offsetMs / 1000;
      const text = line.slice(m.index + m[0].length).trim() || '♪';
      // 过滤歌曲信息行（作词/作曲/编曲/录音工程等）与段落标记（副歌/主歌/间奏等），避免被当成歌词闪屏
      if (/^(作词|作曲|编曲|制作人|制作|监制|出品|发行|录音工程|录音助理|录音师|混音|混音师|母带|母带处理|和声编写|和声|配唱制作人|配唱|人声|原唱|翻唱|词曲|吉他|贝斯|鼓|鼓手|键盘|钢琴|弦乐|弦乐编写|小提琴|中提琴|大提琴|萨克斯|打击乐|企划|企划统筹|文案|封面|平面设计|摄影|导演|MV导演|艺人统筹|宣传|OP|SP)\s*[:：]/.test(text)) return;
      if (t < 60 && /^[\u4e00-\u9fa5A-Za-z·]{1,8}\s*[:：]\s*\S/.test(text)) return;
      if (/^[（(](副歌|主歌|前奏|间奏|尾奏|过渡|高潮|合唱|独白|说唱|Hook|Rap|Intro|Verse|Chorus|Bridge|Outro)[）)]\s*$/i.test(text)) return;
      lines.push({ time: t, text });
    }
  });
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// 解析网易云逐字歌词 YRC（词级时间戳）：[行起始ms,行结束ms]字(偏移ms,时长ms)...
function parseYrc(yrc) {
  const lines = [];
  const blockRe = /\[(\d+),(\d+)\]([\s\S]*?)(?=\[\d+,\d+\]|$)/g;
  let m;
  while ((m = blockRe.exec(String(yrc || '')))) {
    const ls = (+m[1]) / 1000, dur = (+m[2]) / 1000, le = ls + dur;
    if (!(dur > 0)) continue;
    const body = m[3];
    // 兼容两种词级格式：
    //  QQ QRC：text(s,d) —— 时间戳跟在文字后面（如 孤(0,2192)勇(2192,219)者）
    //  标准 YRC / AMLL 转换： (s,d)text —— 时间戳在文字前面
    const tokRe = /\((\d+),(\d+)(?:,\d+)?\)|([^()]+)/g;
    const toks = [];
    let tm;
    while ((tm = tokRe.exec(body))) {
      if (tm[1] !== undefined) toks.push({ t: true, s: +tm[1], d: +tm[2] });
      else toks.push({ t: false, text: tm[3] });
    }
    const markerFirst = body.trim().charAt(0) === '(';
    const wordObjs = [];
    const used = new Set();
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (!tok.t) continue;
      const targetIdx = markerFirst ? i + 1 : i - 1;
      if (targetIdx >= 0 && targetIdx < toks.length && !toks[targetIdx].t) {
        const txt = toks[targetIdx].text.replace(/\s+/g, ' ').trim();
        if (txt) {
          wordObjs.push({ ch: txt, t: tok.s / 1000, d: Math.max(0.05, tok.d / 1000) });
          used.add(targetIdx);
        }
      }
    }
    if (!wordObjs.length) {
      const plain = body.replace(/\((\d+),(\d+)(?:,\d+)?\)/g, '').replace(/\s+/g, ' ').trim();
      if (plain) lines.push({ time: ls, end: le, text: plain, words: [] });
      continue;
    }
    // 未命中时间戳的裸文本段（行首/行尾）补充分配：行首给行开始，行尾给最后一个词之后
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (tok.t || used.has(i)) continue;
      const txt = tok.text.replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      let t = ls, d = 0.25;
      if (wordObjs.length) {
        const last = wordObjs[wordObjs.length - 1];
        t = last.t + last.d;
        d = Math.max(0.1, (le - t) / Math.max(1, txt.length));
      }
      wordObjs.push({ ch: txt, t: Math.max(ls, t), d });
    }
    wordObjs.sort((a, b) => a.t - b.t);
    const text = body.replace(/\((\d+),(\d+)(?:,\d+)?\)/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push({ time: ls, end: le, text, words: wordObjs });
  }
  return lines;
}

function normalizeLrcText(t) {
  return String(t || '').replace(/[\s（）()\[\]【】，,。.、！？!?…·\-—"'""''“”‘’:：;；/\\|]+/g, '');
}
function matchYrcLine(l) {
  if (!yrcLines.length) return null;
  const nt = normalizeLrcText(l.text);
  if (!nt) return null;
  let best = null, bestD = Infinity;
  for (const yl of yrcLines) {
    if (Math.abs(yl.time - l.time) > 1.5) continue;
    if (normalizeLrcText(yl.text) !== nt) continue;
    const d = Math.abs(yl.time - l.time);
    if (d < bestD) { bestD = d; best = yl; }
  }
  return best;
}
function currentStageIndex(sec) {
  if (!lyricMeta.length) return -1;
  let idx = -1;
  for (let i = 0; i < lyricMeta.length; i++) {
    const m = lyricMeta[i];
    if (m.time > sec + 0.05) break;
    // 行结束后停留 0.55s；超过则视为间奏（返回 -1，屏幕清空等待下一句）
    const singEnd = m.singEnd || m.end;
    idx = (sec <= singEnd + 0.55) ? i : -1;
  }
  return idx;
}

// 构建单行 DOM（按模式）
function buildLineEl(meta) {
  const div = document.createElement('div');
  if (stageMode === 'classic') {
    div.className = 'lyric-line classic';
    Array.from(meta.text).forEach((ch, i) => {
      const w = document.createElement('span');
      w.className = 'fw-word';
      const glow = document.createElement('span');
      glow.className = 'fw-glow';
      glow.textContent = ch;
      const body = document.createElement('span');
      body.className = 'fw-body';
      body.textContent = ch;
      w.append(glow, body);
      div.appendChild(w);
    });
    div.__words = Array.from(div.querySelectorAll('.fw-word'));
    return div;
  }
  if (stageMode === 'pendolo') {
    div.className = 'lyric-line pendolo';
    const base = document.createElement('span');
    base.className = 'pend-base';
    base.textContent = meta.text;
    const fill = document.createElement('span');
    fill.className = 'pend-fill';
    fill.textContent = meta.text;
    div.append(base, fill);
    return div;
  }
  if (stageMode === 'orbit') {
    div.className = 'lyric-line orbit-line';
    const seed = ((Math.abs(Math.sin(meta.time * 3.7) * 10000) % 1) + 1) % 1;
    const core = document.createElement('span');
    core.className = 'orbit-core';
    div.appendChild(core);
    const tether = document.createElement('span');
    tether.className = 'orbit-tether';
    div.appendChild(tether);
    for (let k = 0; k < 3; k++) {
      const tr = document.createElement('span');
      tr.className = 'orbit-track';
      div.appendChild(tr);
      for (let m = 0; m < 2; m++) {
        const d = document.createElement('span');
        d.className = 'orbit-dust';
        d.dataset.k = String(k);
        d.dataset.m = String(m);
        tr.appendChild(d);
      }
    }
    const textArr = Array.from(meta.text);
    const chunk = Math.max(1, Math.ceil(textArr.length / 3));
    const shift = Math.floor(seed * 3);
    textArr.forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'lyric-char';
      s.textContent = ch;
      s.dataset.tier = ((Math.floor(i / chunk) + shift) % 3).toString();
      s.dataset.ph = (((seed * 7 + i * 1.618) % 1) + 1) % 1;
      s.dataset.va = '';
      s.dataset.lt = '0';
      s.dataset.px = '0';
      s.dataset.py = '0';
      const comet = document.createElement('span');
      comet.className = 'orbit-comet';
      s.appendChild(comet);
      div.appendChild(s);
    });
    div.__chars = Array.from(div.querySelectorAll('.lyric-char'));
    div.__core = core;
    div.__tether = tether;
    div.__tracks = Array.from(div.querySelectorAll('.orbit-track'));
    return div;
  }
  if (stageMode === 'aurora') {
    div.className = 'lyric-line aurora-line';
    const seed = ((Math.abs(Math.sin(meta.time * 3.7) * 10000) % 1) + 1) % 1;
    [0, 1].forEach((k) => {
      const cur = document.createElement('span');
      cur.className = 'aurora-curtain' + (k ? ' c2' : '');
      div.appendChild(cur);
    });
    Array.from(meta.text).forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'lyric-char';
      s.textContent = ch;
      s.dataset.seed = (((seed * 3 + i * 0.618) % 1) + 1) % 1;
      const p = document.createElement('span');
      p.className = 'aurora-pillar';
      s.appendChild(p);
      s.__pillar = p;
      div.appendChild(s);
    });
    div.__chars = Array.from(div.querySelectorAll('.lyric-char'));
    div.__curtains = Array.from(div.querySelectorAll('.aurora-curtain'));
    return div;
  }
  if (stageMode === 'cascade') {
    div.className = 'lyric-line cascade-line';
    const seed = ((Math.abs(Math.sin(meta.time * 2.9) * 10000) % 1) + 1) % 1;
    const pool = document.createElement('span');
    pool.className = 'cascade-pool';
    const wl = document.createElement('span');
    wl.className = 'cascade-waterline';
    pool.appendChild(wl);
    const wave = document.createElement('span');
    wave.className = 'cascade-wave';
    pool.appendChild(wave);
    div.appendChild(pool);
    Array.from(meta.text).forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'lyric-char';
      s.textContent = ch;
      s.dataset.seed = (((seed * 5 + i * 0.382) % 1) + 1) % 1;
      const st = document.createElement('span');
      st.className = 'cascade-streak';
      s.appendChild(st);
      const dp = document.createElement('span');
      dp.className = 'cascade-drop';
      dp.style.animationDelay = (-((i * 0.17) % 1.15)).toFixed(2) + 's';
      s.appendChild(dp);
      s.__streak = st;
      s.__drop = dp;
      div.appendChild(s);
    });
    div.__chars = Array.from(div.querySelectorAll('.lyric-char'));
    div.__pool = pool;
    div.__wave = wave;
    return div;
  }
  if (stageMode === 'star-river') {
    div.className = 'lyric-line star-river-line';
    const seed = ((Math.abs(Math.sin(meta.time * 2.3) * 10000) % 1) + 1) % 1;
    Array.from(meta.text).forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'lyric-char';
      s.textContent = ch;
      s.dataset.seed = (((seed * 9 + i * 0.317) % 1) + 1) % 1;
      const sh = document.createElement('span');
      sh.className = 'sr-shine';
      s.appendChild(sh);
      s.__shine = sh;
      div.appendChild(s);
    });
    div.__chars = Array.from(div.querySelectorAll('.lyric-char'));
    return div;
  }
  div.className = 'lyric-line ' + (stageLineCls[stageMode] || 'flowline');
  Array.from(meta.text).forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'lyric-char';
    s.textContent = ch;
    s.style.setProperty('--i', i);
    div.appendChild(s);
  });
  div.__chars = Array.from(div.querySelectorAll('.lyric-char'));
  return div;
}

// 间奏清场：当前行淡出并复位（下一行到来前屏幕保持干净，避免上一句挂屏）
function clearStageLine() {
  if (stageLineEl) {
    const old = stageLineEl;
    old.classList.add('stage-exit');
    setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 560);
  }
  stageLineEl = null;
  stageLineIdx = -1;
}

// 切换活动行：旧行模糊退场，新行入场
function showStageLine(idx) {
  if (stageLineEl) {
    const old = stageLineEl;
    old.classList.add('stage-exit');
    setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 560);
  }
  stageLineEl = null;
  stageLineIdx = idx;
  if (stageMode === 'cloud') { renderCloud(idx); return; }
  if (stageMode === 'stage') {
    ensureMrStage();
    if (!mrStage) return;
    mrStage.syncSong(currentSong);
    const meta = lyricMeta[idx];
    if (!meta) return;
    mrStage.setHue(curHue);
    mrStage.buildLine(meta);
    updateStageSubtitle(idx);
    applyMood();
    if (deskLyricBtn && deskLyricBtn.classList.contains('on')) pushLyricLine();
    return;
  }
  if (stageMode === 'sonnet') {
    if (window.FoliaSonnet && window.FoliaSonnet.SonnetPixiRuntime) {
      updateStageSubtitle(idx);
      ensureSonnetRuntime();
      return;
    }
    renderSonnetLine(idx);
    return;
  }
  const meta = lyricMeta[idx];
  if (!meta) return;
  const el = buildLineEl(meta);
  lyricFloatEl.appendChild(el);
  el.classList.add('stage-enter');
  stageLineEl = el;
  if (stageMode === 'classic') layoutClassicLine(el, meta);
  else if (stageMode === 'heart') heartFlyIn(el);
  updateStageSubtitle(idx);
  lyricOffset = (idx * 23) % 70 - 35;
  applyMood();
  if (deskLyricBtn && deskLyricBtn.classList.contains('on')) pushLyricLine();
}

function updateStageSubtitle(idx) {
  const next = [];
  for (let i = idx + 1; i < lyricMeta.length && next.length < 2; i++) {
    if (/^[\s•·…—\-]*$/.test(lyricMeta[i].text)) continue;
    next.push(lyricMeta[i].text);
  }
  stageSubtitleEl.innerHTML = '';
  next.forEach((txt, i) => {
    const meta = lyricMeta.find((m) => m.text === txt);
    const s = document.createElement('span');
    s.className = 'sub-next' + (i === 0 ? ' lead' : '');
    s.textContent = txt + (meta && meta.trans ? '  ' + meta.trans : '');
    stageSubtitleEl.appendChild(s);
  });
}

// ===== 经典模式：词级散点 + 三态（等待/演唱/已唱） =====
const classicCtx = (() => { const c = document.createElement('canvas'); return c.getContext('2d'); })();
const classicFontStack = '"Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif';
function classicFontSize() { return Math.min(72, Math.max(36, innerWidth * 0.07)); }
function measureCharWidth(ch, px) {
  classicCtx.font = `800 ${px}px ${classicFontStack}`;
  return classicCtx.measureText(ch).width || px * 0.95;
}
function layoutClassicLine(el, meta) {
  const seed = meta.time;
  const rand = (o) => { const x = Math.sin(seed + o) * 10000; return x - Math.floor(x); };
  const px = classicFontSize();
  const spread = 22, rotBase = 5;
  const words = Array.from(el.querySelectorAll('.fw-word'));
  const widths = words.map((c) => measureCharWidth(c.textContent, px));
  words.forEach((c, i) => {
    c.dataset.bx = ((rand(i * 7 + 1) - 0.5) * spread * 2).toFixed(1);
    c.dataset.by = ((rand(i * 7 + 2) - 0.5) * spread * 2).toFixed(1);
    c.dataset.rot = ((rand(i * 7 + 3) - 0.5) * rotBase * 2).toFixed(2);
    c.dataset.sc = (1.05 + rand(i * 7 + 4) * 0.22).toFixed(3);
    c.dataset.passedRot = ((rand(i * 7 + 5) - 0.5) * 36).toFixed(1);
    c.dataset.state = '';
    // Folia：按每个词缩放余量计算右间距，活动字放大 1.4x 时不与下一个字重叠
    const s_i = parseFloat(c.dataset.sc) * 1.4;
    const w_i = widths[i] || px * 0.95;
    const x_i = parseFloat(c.dataset.bx);
    const halfOverflow_i = (w_i * (s_i - 1)) / 2;
    let margin = null;
    if (i + 1 < words.length) {
      const s_next = (1.05 + rand((i + 1) * 7 + 4) * 0.22) * 1.4;
      const x_next = (rand((i + 1) * 7 + 1) - 0.5) * spread * 2;
      const w_next = widths[i + 1] || px * 0.95;
      const halfOverflow_next = (w_next * (s_next - 1)) / 2;
      const gap = 0.05 * px;
      const calc = (halfOverflow_i + halfOverflow_next + (x_i - x_next) + gap) * 0.7;
      const minM = 0.12 * px * 0.7;
      margin = Math.max(minM, calc);
    }
    c.style.marginRight = (margin === null ? 0 : margin.toFixed(1)) + 'px';
  });
  // Folia：行对齐 / 垂直对齐由行起始时间确定性决定
  const justifies = ['center', 'center', 'flex-start', 'flex-end', 'center'];
  el.style.justifyContent = justifies[Math.floor(seed % justifies.length)];
  const aligns = ['center', 'center', 'flex-start', 'flex-end', 'center'];
  el.style.alignItems = aligns[Math.floor((seed * 2) % aligns.length)];
  const oldTrans = el.querySelector('.classic-trans');
  if (oldTrans) oldTrans.remove();
  if (meta.trans) {
    const t = document.createElement('div');
    t.className = 'classic-trans';
    t.textContent = meta.trans;
    el.appendChild(t);
  }
}
// Folia 副歌波纹：活动字外围扩散光环
function spawnCharRipple(c) {
  const r = document.createElement('span');
  r.className = 'char-ripple';
  c.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}
function updateClassicLine(el, meta, sec) {
  const isChorus = chorusSet.has(meta.text);
  const words = el.__words || (el.__words = Array.from(el.querySelectorAll('.fw-word')));
  for (let i = 0; i < words.length; i++) {
    const c = words[i];
    const ct = meta.chars[i];
    if (!ct) continue;
    let state = 'waiting';
    if (sec >= ct.start - 0.12) state = 'active';
    if (sec > ct.end) state = 'passed';
    c.classList.toggle('chorus', isChorus && state === 'active');
    if (state === 'active' && isChorus && c.dataset.state !== 'active') spawnCharRipple(c);
    c.dataset.orn = (sec >= ct.start && sec < ct.end) ? '1' : '';
    if (c.dataset.state === state) continue;
    c.dataset.state = state;
    c.classList.remove('waiting', 'active', 'passed');
    c.classList.add(state);
    const bx = parseFloat(c.dataset.bx), by = parseFloat(c.dataset.by);
    const rot = parseFloat(c.dataset.rot), sc = parseFloat(c.dataset.sc);
    if (state === 'waiting') {
      c.style.transform = `translate(${(bx + Math.sin(by) * 60).toFixed(1)}px, ${(by + Math.cos(bx) * 34).toFixed(1)}px) rotate(${(rot + 18).toFixed(2)}deg) scale(0.5)`;
    } else if (state === 'active') {
      const bump = 1 + beatKick * 0.14;
      c.style.transform = `translate(${bx}px, ${by}px) rotate(${rot}deg) scale(${(sc * 1.4 * bump).toFixed(3)})`;
    } else {
      c.style.transform = `translate(${bx}px, ${by}px) rotate(${(rot + parseFloat(c.dataset.passedRot)).toFixed(2)}deg) scale(${sc})`;
    }
  }
}

// ===== 摆锤模式：遮罩扫过逐字点亮 =====
function updatePendoloLine(el, meta, sec) {
  const fill = el.querySelector('.pend-fill');
  const n = meta.chars.length;
  let w = 0;
  if (sec >= meta.chars[0].start) {
    if (sec >= meta.end) w = 1;
    else {
      for (let i = 0; i < n; i++) {
        const c = meta.chars[i];
        if (sec < c.start) break;
        if (sec <= c.end) { w = (i + (sec - c.start) / Math.max(0.001, c.end - c.start)) / n; break; }
        w = (i + 1) / n;
      }
    }
  }
  const full = el.__pendW || (el.__pendW = (fill.scrollWidth || 100));
  const widthPx = full * w;
  const soft = Math.min(16, Math.max(8, 64 * 0.42));
  // 遮罩 1px 粒度节流：避免逐帧重建 mask（逐帧重栅格化文字是摆锤模式卡顿主因）
  const round = Math.round(widthPx);
  if (round !== lastSweepPx) {
    lastSweepPx = round;
    const mask = `linear-gradient(90deg, #000 0px, #000 ${Math.max(0, widthPx - soft)}px, rgba(0,0,0,0.85) ${widthPx}px, transparent ${widthPx + soft}px)`;
    fill.style.webkitMaskImage = mask;
    fill.style.maskImage = mask;
    el.style.setProperty('--sweep', round.toFixed(1) + 'px');
  }
  const sway = Math.sin(sec * 1.1) * 3 + bass * 6;
  el.style.transform = `rotate(${sway.toFixed(2)}deg)`;
}

// ===== 流光模式：逐字点亮 + 渐变辉光 =====
function updateFlowLine(el, meta, sec) {
  const isChorus = chorusSet.has(meta.text);
  const chars = el.children;
  for (let i = 0; i < chars.length; i++) {
    const on = sec >= meta.chars[i].start - 0.05;
    const orn = sec >= meta.chars[i].start && sec < meta.chars[i].end;
    chars[i].classList.toggle('on', on);
    chars[i].classList.toggle('chorus', isChorus && on);
    chars[i].dataset.orn = orn ? '1' : '';
  }
}

// ===== 回环模式：字符绕环旋转 =====
function layoutRingLine(el, meta, t) {
  const chars = el.children;
  const n = chars.length;
  if (!n) return;
  const R = Math.min(innerWidth * 0.26, innerHeight * 0.3) * (1 + bass * 0.12);
  const rot = t * (0.5 + bass * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    chars[i].style.transform = `translate(${(Math.cos(a) * R).toFixed(1)}px, ${(Math.sin(a) * R).toFixed(1)}px)`;
  }
}

// ===== 星轨模式：行星轨道 · 唱词驶向近地点点亮并驻留（编排清晰、光效克制） =====
let orbitPrevT = 0;      // 上一帧时间（轨道速度惯性）
let orbitSpinV = 0.12;   // 当前平滑角速度（rad/s）
let orbitAngle = 0;      // 轨道累计角度（缓慢漂移 + 音乐加速，全程丝滑）
const ORBIT_TIER_RATE = [1.4, 1, 0.72]; // 内层快 / 外层慢（开普勒感）
function charGlowOnce(c) {
  if (c.dataset.lit === '1') return;
  c.dataset.lit = '1';
  const f = document.createElement('span');
  f.className = 'fx-flare';
  c.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
}
function updateOrbitLine(el, meta, sec, t) {
  const chars = el.__chars || (el.__chars = Array.from(el.querySelectorAll('.lyric-char')));
  const n = chars.length;
  if (!n) return;
  const core = el.__core || (el.__core = el.querySelector('.orbit-core'));
  const tether = el.__tether || (el.__tether = el.querySelector('.orbit-tether'));
  const tracks = el.__tracks || (el.__tracks = Array.from(el.querySelectorAll('.orbit-track')));
  const R = Math.min(innerWidth * 0.21, innerHeight * 0.27);
  // 副歌：轨道轻微扩张，视觉更有张力
  const RT0 = [R * 0.6, R * 0.8, R];
  const RT = RT0.map((r) => r * (1 + chorusLevel * 0.05));
  const lineT = meta.time;
  // 轨道转速：安静时缓慢漂移，低频/鼓点渐进加速；速度变化带惯性，不顿挫
  const fdt = Math.min(0.05, Math.max(0.001, t - orbitPrevT));
  orbitPrevT = t;
  const targetSpin = 0.12 + bass * 0.22 + beatKick * 0.26 + chorusLevel * 0.05;
  orbitSpinV += (targetSpin - orbitSpinV) * Math.min(1, fdt * 2.5);
  orbitAngle += orbitSpinV * fdt;
  const dirT = [1, -1, 1];
  const front = Math.PI / 2;
  let heroX = null, heroY = null;
  const tierCount = [0, 0, 0];
  for (let i = 0; i < n; i++) tierCount[parseInt(chars[i].dataset.tier, 10) || 0]++;
  const tierIdx = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const c = chars[i];
    const tier = parseInt(c.dataset.tier, 10) || 0;
    const ph = parseFloat(c.dataset.ph) || 0.5;
    const isSpace = /\s/.test(c.textContent);
    const ringN = Math.max(1, tierCount[tier]);
    const slot = (tierIdx[tier] / ringN) * Math.PI * 2 + ph * 0.9;
    tierIdx[tier]++;
    const target = slot + dirT[tier] * orbitAngle * ORBIT_TIER_RATE[tier];
    let va = parseFloat(c.dataset.va);
    if (c.dataset.va === '') va = target;
    const on = sec >= meta.chars[i].start && sec < meta.chars[i].end;
    c.dataset.orn = on ? '1' : '';
    // 唱毕驻留：刚唱完的字在近地点短暂停留再缓缓回归，避免沿轨道长弧甩回
    if (on) c.dataset.holdUntil = (t + 0.55).toFixed(3);
    else if (parseFloat(c.dataset.holdUntil || '0') <= t) c.dataset.holdUntil = '0';
    const holding = !on && parseFloat(c.dataset.holdUntil || '0') > t;
    const goal = (on || holding) ? front + (i % 5 - 2) * 0.05 : target;
    const dt = Math.min(0.05, Math.max(0.001, t - (parseFloat(c.dataset.lt) || t)));
    c.dataset.lt = t.toFixed(3);
    const k = Math.min(1, dt * ((on || holding) ? 5 : 2.6));
    va += (goal - va) * k;
    c.dataset.va = String(va);
    c.classList.toggle('on', on);
    if (on && !isSpace) charGlowOnce(c);
    const depth = Math.sin(va) * 0.5 + 0.5;
    const rr = RT[tier];
    const wob = Math.sin(va * 1.7 + ph * 6) * 0.045;
    const r = rr * (1 + wob);
    const ent = Math.min(1, Math.max(0, (sec - lineT - i * 0.05) / 0.7));
    const ee = ent >= 1 ? 1 : 1 - Math.pow(1 - ent, 3);
    const rIn = 1 + (1 - ee) * 1.3;
    const x = Math.cos(va) * r * rIn;
    const y = Math.sin(va) * r * rIn * 0.42;
    const glow = on ? (0.62 + beatKick * 0.38) : (holding ? 0.24 : 0);
    const sc = (0.76 + depth * 0.32) * (1 + glow * 0.4) + beatKick * 0.04 * depth;
    c.style.zIndex = on ? '4' : (holding ? '3' : (depth > 0.5 ? '2' : '1'));
    c.style.opacity = isSpace ? '0' : ((on ? 1 : holding ? 0.7 : (0.28 + depth * 0.32)) * ee).toFixed(2);
    c.style.textShadow = (on || holding) && !isSpace
      ? '0 0 ' + (9 + beatKick * 9).toFixed(0) + 'px hsla(var(--c1h,200),90%,72%,0.6)'
      : 'none';
    c.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${sc.toFixed(3)})`;
    const pxx = parseFloat(c.dataset.px) || 0;
    const pyy = parseFloat(c.dataset.py) || 0;
    c.dataset.px = x.toFixed(1);
    c.dataset.py = y.toFixed(1);
    const cometEl = c.querySelector('.orbit-comet');
    if (cometEl) {
      if ((on || holding) && !isSpace) {
        const dx = x - pxx, dy = y - pyy;
        const ang = Math.atan2(dy, dx) * 180 / Math.PI + 180;
        const len = Math.min(92, 26 + Math.hypot(dx, dy) * 30 + beatKick * 34);
        cometEl.style.transform = 'rotate(' + ang.toFixed(1) + 'deg) scaleX(' + (len / 46).toFixed(2) + ')';
        cometEl.style.opacity = '0.9';
      } else {
        cometEl.style.opacity = '0';
      }
    }
    if (!isSpace && (on || holding)) {
      // 连接线优先指向当前唱字，其次是最新驻留字
      if (heroX === null || on) { heroX = x; heroY = y; }
    }
  }
  if (tether) {
    if (heroX !== null) {
      const d = Math.hypot(heroX, heroY);
      const a = Math.atan2(heroY, heroX);
      tether.style.width = d.toFixed(1) + 'px';
      tether.style.transform = 'rotate(' + a.toFixed(3) + 'rad)';
      tether.style.opacity = '0.5';
    } else {
      tether.style.opacity = '0';
    }
  }
  for (let k = 0; k < tracks.length && k < 3; k++) {
    const tr = tracks[k];
    tr.style.width = (RT[k] * 2).toFixed(1) + 'px';
    tr.style.height = (RT[k] * 2 * 0.42).toFixed(1) + 'px';
    tr.style.opacity = (0.55 + bass * 0.45 + chorusLevel * 0.3).toFixed(2);
    tr.style.transform = 'translate(-50%, -50%) scale(' + (1 + beatKick * 0.02 + chorusLevel * 0.02).toFixed(3) + ')';
    // 轨道上的流动光点（小行星带），随轨道同向运行，副歌更亮
    const dusts = tr.querySelectorAll('.orbit-dust');
    dusts.forEach((d, m) => {
      const a = dirT[k] * orbitAngle * ORBIT_TIER_RATE[k] + (m ? Math.PI : 0) + k * 0.77;
      const drr = RT[k];
      d.style.transform = 'translate(' + (Math.cos(a) * drr).toFixed(1) + 'px, ' + (Math.sin(a) * drr * 0.42).toFixed(1) + 'px)';
      d.style.opacity = (0.3 + Math.sin(a) * 0.28 + chorusLevel * 0.24).toFixed(2);
      d.style.scale = (1 + beatKick * 0.45).toFixed(2);
    });
  }
  if (core) {
    const pulse = beatKick * 0.4;
    core.style.transform = `translate(-50%, -50%) scale(${(1 + pulse * 0.5 + audioPower * 0.05).toFixed(3)})`;
    core.style.boxShadow = '0 0 ' + (8 + pulse * 18 + chorusLevel * 14).toFixed(1) + 'px hsla(var(--c1h,200),92%,72%,' + (0.3 + pulse * 0.3 + chorusLevel * 0.22).toFixed(2) + '), 0 0 ' + (22 + pulse * 22 + chorusLevel * 18).toFixed(1) + 'px hsla(var(--c2h,265),90%,66%,0.18)';
  }
}

// ===== 极光模式：字成极光幕布 · 行波涌动（低饱和、慢色相、唱词光柱） =====
function updateAuroraLine(el, meta, sec, t) {
  const chars = el.__chars || (el.__chars = Array.from(el.querySelectorAll('.lyric-char')));
  const n = chars.length;
  if (!n) return;
  const span = Math.min(innerWidth * 0.86, n * 54);
  const curtains = el.__curtains || (el.__curtains = Array.from(el.querySelectorAll('.aurora-curtain')));
  const lineT = meta.time;
  const sway = Math.sin(t * 0.16) * 0.5 + Math.sin(t * 0.1 + 1.7) * 0.5;
  if (curtains[0]) {
    curtains[0].style.width = (span + 80).toFixed(0) + 'px';
    curtains[0].style.opacity = (0.09 + audioPower * 0.05 + chorusLevel * 0.08).toFixed(2);
  }
  if (curtains[1]) {
    curtains[1].style.width = (span * 0.7).toFixed(0) + 'px';
    curtains[1].style.opacity = (0.07 + audioPower * 0.04 + chorusLevel * 0.09).toFixed(2);
    // 副歌：第二层幕布反向往复摆动，形成双层交叉流动
    curtains[1].style.transform = 'translateX(-50%) translateX(' + (Math.sin(t * (0.07 + chorusLevel * 0.1)) * (60 + chorusLevel * 74)).toFixed(0) + 'px)';
  }
  for (let i = 0; i < n; i++) {
    const c = chars[i];
    const seed = parseFloat(c.dataset.seed) || 0.5;
    const fx0 = -span / 2 + (i / Math.max(1, n - 1)) * span;
    const fx = fx0 + Math.sin(t * 0.12 + i * 1.3 + seed * 3) * 7;
    const w1 = Math.sin(t * 0.3 - i * 0.42 + seed * 5) * (26 + chorusLevel * 16);
    const w2 = Math.sin(t * 0.14 - i * 0.2 + seed * 3) * 13;
    // 幕布垂弧：两端略高、中间略低，像极光缎带边缘
    const arc = Math.cos((i / Math.max(1, n - 1)) * Math.PI) * 20;
    const fy = w1 + w2 + arc + sway * 10 + bass * 11 * Math.sin(t * 0.3 + i * 0.22);
    const rot = Math.sin(t * 0.09 + i * 0.32) * 3;
    const on = sec >= meta.chars[i].start && sec < meta.chars[i].end;
    c.dataset.orn = on ? '1' : '';
    c.classList.toggle('on', on);
    if (on) charGlowOnce(c);
    const hue = (curHue + t * (3 + chorusLevel * 3.5) + Math.sin(i * 0.8 + seed * 4) * 16 + 360) % 360;
    const crest = Math.sin(t * 0.3 - i * 0.42 + seed * 5) * 0.5 + 0.5;
    const ent = Math.min(1, Math.max(0, (sec - lineT - i * 0.035) / 0.85));
    const ee = ent >= 1 ? 1 : 1 - Math.pow(1 - ent, 3);
    const lift = on ? 16 : 0;
    // 唱后沉降：已唱完的字缓缓坠落、模糊淡出（余音沉底，下一行登台层次分明）
    const fall = Math.max(0, Math.min(1, (sec - meta.chars[i].end) * 1.1));
    const fyIn = fy - lift + (1 - ee) * 110 + fall * 66;
    const fallScale = 1 - fall * 0.22;
    const fallOp = 1 - fall * 0.78;
    const fallBlur = fall * 1.7;
    const alpha = 0.26 + ee * 0.3 + crest * 0.14;
    c.style.color = on
      ? 'hsla(' + hue.toFixed(0) + ', 70%, 86%, 1)'
      : 'hsla(' + hue.toFixed(0) + ', 38%, ' + (68 + crest * 8).toFixed(0) + '%, ' + Math.min(0.85, alpha).toFixed(2) + ')';
    c.style.textShadow = on
      ? '0 0 ' + (10 + beatKick * 10).toFixed(0) + 'px hsla(' + hue.toFixed(0) + ', 90%, 72%, 0.65)'
      : 'none';
    c.style.transform = `translate3d(${fx.toFixed(1)}px, ${fyIn.toFixed(1)}px, 0) rotate(${rot.toFixed(1)}deg) scale(${((0.9 + ee * 0.16 + (on ? 0.14 : 0) + crest * 0.08) * fallScale).toFixed(3)})`;
    c.style.opacity = ((on ? 1 : (0.24 + ee * 0.4)) * fallOp).toFixed(2);
    c.style.filter = fallBlur > 0.02 ? 'blur(' + fallBlur.toFixed(1) + 'px)' : 'none';
    const pillar = c.__pillar || (c.__pillar = c.querySelector('.aurora-pillar'));
    if (pillar) {
      const ph = on ? 46 + vocal * 90 + beatKick * 40 + chorusLevel * 34 : 0;
      pillar.style.height = ph.toFixed(0) + 'px';
      pillar.style.opacity = (on ? 0.32 + vocal * 0.3 + beatKick * 0.2 : 0).toFixed(2);
    }
  }
}

// ===== 瀑布模式：字符坠落汇聚成行 · 水帘长流（单色、唱词溅亮） =====
let cascadePrevKick = 0;
function cascadeSplash(c) {
  if (c.dataset.lit === '1') return;
  c.dataset.lit = '1';
  const r = document.createElement('span');
  r.className = 'fx-splash';
  r.style.top = '84%';
  c.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}
function poolRipple(pool, x) {
  const r = document.createElement('span');
  r.className = 'fx-splash pool';
  const pw = Math.min(innerWidth, innerHeight) * 0.44;
  r.style.left = (50 + (x / Math.max(1, pw)) * 100).toFixed(1) + '%';
  pool.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}
function updateCascadeLine(el, meta, sec, t) {
  const chars = el.__chars || (el.__chars = Array.from(el.querySelectorAll('.lyric-char')));
  const n = chars.length;
  if (!n) return;
  const span = Math.min(innerWidth * 0.8, n * 56);
  const pool = el.__pool || (el.__pool = el.querySelector('.cascade-pool'));
  const lineT = meta.time;
  const flow = 0.5 + vocal * 0.5 + bass * 0.4;
  let sungX = null;
  for (let i = 0; i < n; i++) {
    const c = chars[i];
    const seed = parseFloat(c.dataset.seed) || 0.5;
    const x = -span / 2 + (i / Math.max(1, n - 1)) * span;
    const on = sec >= meta.chars[i].start && sec < meta.chars[i].end;
    c.dataset.orn = on ? '1' : '';
    c.classList.toggle('on', on);
    if (on && !/\s/.test(c.textContent)) {
      cascadeSplash(c);
      if (sungX === null) sungX = x;
    }
    const ent = Math.min(1, Math.max(0, (sec - lineT - i * 0.06) / 0.75));
    const ee = ent >= 1 ? 1 : 1 - Math.pow(1 - ent, 3);
    const drop = (1 - ee) * 180;
    const drift = Math.sin(t * 0.32 + i * 0.55) * 7;
    const bob = on
      ? bass * 9 + Math.sin(t * 0.9 + i) * 3
      : Math.sin(t * 0.5 + i * 0.7 + seed * 4) * 2.5;
    // 唱后沉降：字沉入水面并缓缓隐去，水面余韵延续到下一句
    const fall = Math.max(0, Math.min(1, (sec - meta.chars[i].end) * 1.15));
    const y = Math.sin(i * 0.8 + seed * 3) * 12 - drop + drift + bob + fall * 46;
    const fallOp = 1 - fall * 0.82;
    const fallScale = 1 - fall * 0.18;
    const drops = c.__drops || (c.__drops = Array.from(c.querySelectorAll('.cascade-drop')));
    if (drops.length) {
      const dur = (1.15 - chorusLevel * 0.45).toFixed(2);
      drops.forEach((dp) => { dp.style.animationDuration = dur + 's'; });
    }
    const streak = c.__streak || (c.__streak = c.querySelector('.cascade-streak'));
    if (streak) {
      const h = 56 + (on ? 46 + vocal * 90 + beatKick * 46 + chorusLevel * 46 : flow * (44 + chorusLevel * 26));
      const flick = 0.75 + 0.25 * Math.sin(t * 3.2 + i * 1.3);
      streak.style.height = h.toFixed(0) + 'px';
      streak.style.opacity = ((on ? 0.42 + beatKick * 0.3 + chorusLevel * 0.22 : 0.1 + flow * 0.12 + chorusLevel * 0.12) * flick * (1 - fall * 0.7)).toFixed(2);
      streak.style.transform = 'translateX(-50%) scaleY(' + ((0.85 + (on ? vocal * 0.7 : 0)) * (1 - fall * 0.55)).toFixed(2) + ')';
    }
    c.style.color = on
      ? 'hsla(var(--c1h,200), 76%, 87%, 1)'
      : 'hsla(216, 44%, ' + (68 + ee * 10).toFixed(0) + '%, ' + (0.32 + ee * 0.34).toFixed(2) + ')';
    c.style.textShadow = on
      ? '0 0 ' + (9 + beatKick * 10).toFixed(0) + 'px hsla(var(--c1h,200), 90%, 72%, 0.7)'
      : 'none';
    c.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${((0.88 + ee * 0.22 + (on ? 0.12 : 0)) * fallScale).toFixed(3)})`;
    c.style.opacity = ((on ? 1 : (0.28 + ee * 0.42)) * fallOp).toFixed(2);
    c.style.filter = fall > 0.02 ? 'blur(' + (fall * 1.2).toFixed(1) + 'px)' : 'none';
  }
  if (pool) {
    const pr = 1 + beatKick * 0.16 + bass * 0.05 + chorusLevel * 0.1;
    pool.style.opacity = (0.13 + beatKick * 0.15 + chorusLevel * 0.12).toFixed(2);
    pool.style.transform = 'translate(-50%, 0) scaleX(' + pr.toFixed(3) + ')';
    const wave = el.__wave || (el.__wave = el.querySelector('.cascade-wave'));
    if (wave) {
      const pwPx = Math.min(innerWidth, innerHeight) * 0.44;
      if (sungX !== null) {
        const Xc = Math.max(-pwPx / 2, Math.min(pwPx / 2, sungX));
        wave.style.left = (50 + (Xc / pwPx) * 100).toFixed(1) + '%';
        wave.style.opacity = (0.55 + vocal * 0.35).toFixed(2);
      } else {
        wave.style.opacity = '0';
      }
    }
    if (beatKick > 0.55 && cascadePrevKick <= 0.55 && sungX !== null) poolRipple(pool, sungX);
  }
  cascadePrevKick = beatKick;
}

// ===== 云阶模式：活动行登台，相邻行成阶梯 =====
function renderCloud(idx) {
  lyricFloatEl.innerHTML = '';
  cloudLines = [];
  const from = Math.max(0, idx - 2), to = Math.min(lyricMeta.length - 1, idx + 2);
  for (let i = from; i <= to; i++) {
    const div = document.createElement('div');
    div.className = 'lyric-line cloud-line' + (i === idx ? ' active' : '') + (chorusSet.has(lyricMeta[i].text) ? ' chorus' : '');
    div.textContent = lyricMeta[i].text;
    div.dataset.li = i;
    lyricFloatEl.appendChild(div);
    cloudLines.push(div);
  }
  stageLineEl = lyricFloatEl.querySelector('.active');
  updateStageSubtitle(idx);
  lyricOffset = (idx * 23) % 70 - 35;
  applyMood();
}
// ===== 星河模式：歌词浮游 + 扫光（Mineradio shine 动效） =====
let starRiverPrevKick = 0;
function starRiverRipple(c) {
  const r = document.createElement('span');
  r.className = 'sr-ripple';
  c.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}
function updateStarRiverLine(el, meta, sec, t) {
  const chars = el.__chars || (el.__chars = Array.from(el.querySelectorAll('.lyric-char')));
  const n = chars.length;
  if (!n) return;
  chars.forEach((c, i) => {
    const ph = parseFloat(c.dataset.seed) || 0;
    const on = sec >= meta.chars[i].start && sec < meta.chars[i].end;
    c.dataset.orn = on ? '1' : '';
    c.classList.toggle('on', on);
    const fl = Math.sin(t * 0.8 + ph * 12.6) * 6 + Math.sin(t * 1.7 + ph * 7.3) * 3 + bass * 7;
    const pop = on ? (1 + beatKick * 0.16 + Math.max(0, Math.sin(t * 2.2 + ph * 8)) * 0.06) : 1;
    const sc = (on ? 1.07 : 1) * pop;
    c.style.transform = `translate3d(0, ${fl.toFixed(1)}px, 0) scale(${sc.toFixed(3)})`;
    c.style.opacity = on ? '1' : '0.45';
    c.style.textShadow = on
      ? `0 0 ${(10 + beatKick * 12 + bass * 6).toFixed(0)}px hsla(var(--c1h,200),92%,74%,0.75), 0 0 ${(26 + beatKick * 16 + chorusLevel * 12).toFixed(0)}px hsla(var(--c2h,265),90%,66%,0.34)`
      : 'none';
    const sh = c.__shine || (c.__shine = c.querySelector('.sr-shine'));
    if (sh) {
      sh.style.animationDelay = (-(ph * 2.4)).toFixed(2) + 's';
      sh.style.opacity = on ? String(0.5 + beatKick * 0.5).slice(0, 4) : '0';
    }
  });
  // 鼓点：唱字底部漾开水波（Mineradio ripples 思路）
  if (beatKick > 0.55 && starRiverPrevKick <= 0.55) {
    const lit = el.querySelector('.lyric-char.on');
    if (lit && !/\s/.test(lit.textContent)) starRiverRipple(lit);
  }
  starRiverPrevKick = beatKick;
  el.classList.toggle('beat', beatKick > 0.4);
}

function updateCloudLines(t, sec) {
  cloudLines.forEach((el) => {
    const i = parseInt(el.dataset.li, 10);
    const d = i - stageLineIdx;
    el.style.transform =
      `translate(-50%, -50%) translateX(${(Math.sin(t * 0.5 + i * 1.1) * 10 + Math.abs(d) * 16).toFixed(1)}px)` +
      ` translateY(${(d * 66).toFixed(1)}px) rotate(${(d * 2.6).toFixed(1)}deg)`;
    el.style.opacity = String(Math.max(0.12, 0.62 - Math.abs(d) * 0.15));
  });
}

// ===== 心象模式：字符飞入汇聚 =====
function heartFlyIn(el) {
  const chars = Array.from(el.children);
  chars.forEach((c) => {
    const a = Math.random() * Math.PI * 2;
    const r = 260 + Math.random() * 480;
    c.style.setProperty('--sx', (Math.cos(a) * r).toFixed(0) + 'px');
    c.style.setProperty('--sy', (Math.sin(a) * r).toFixed(0) + 'px');
    c.classList.add('enter');
  });
  requestAnimationFrame(() => {
    chars.forEach((c, i) => {
      c.style.transitionDelay = (i * 24) + 'ms';
      c.classList.remove('enter');
    });
    setTimeout(() => chars.forEach((c) => { c.style.transitionDelay = ''; }), 1500);
  });
}

// ================= 商籁（Sonnet）：PV 导演式动能排版 =================
let snProgram = [];            // 每行编译后的词段（含角色/时间），与 lyricMeta 行序一一对应
const LA_FOLIA_NOTES = [[6,1],[6,1.5],[7,0.5],[5,1],[5,1],[5,1],[6,1],[6,1.5],[6,0.5],[7,1],[7,1],[7,1],[8,1],[8,1.5],[8,0.5],[7,1],[7,1],[7,1],[6,1],[6,1.5],[5,0.5],[6,3]];
const SN_CJK = /[\u4e00-\u9fff\u3040-\u30ff]/;
const SN_SHOT_KINDS = ['cross', 'ring', 'ribbon', 'tableau'];
function snHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}
function snRand(seed, o) { const x = Math.sin(seed + o) * 10000; return x - Math.floor(x); }
function buildSonnetSegments(meta) {
  const chars = meta.chars;
  const segs = [];
  let cur = null;
  let cjkRun = [];
  const flush = () => {
    if (cur && cur.text.length) {
      cur.start = cur.firstStart; cur.end = cur.lastEnd;
      segs.push(cur);
    }
    cur = null;
  };
  const flushRun = () => {
    // 中文按 2-3 字成词：优先 2 字，余 3 字成 3 字词，余 1 字独立
    let i = 0;
    while (i < cjkRun.length) {
      const left = cjkRun.length - i;
      const take = left === 3 ? 3 : (left === 1 ? 1 : 2);
      const chunk = cjkRun.slice(i, i + take);
      const seg = {
        text: '', chList: [], charIdx: chunk[0].ci,
        start: chunk[0].start, end: chunk[chunk.length - 1].end,
        firstStart: chunk[0].start, lastEnd: chunk[chunk.length - 1].end, role: 'support'
      };
      chunk.forEach((c) => { seg.text += c.ch; seg.chList.push(c.ch); });
      segs.push(seg);
      i += take;
    }
    cjkRun = [];
  };
  chars.forEach((ch, ci) => {
    if (/\s/.test(ch.ch)) {
      if (cjkRun.length) flushRun();
      flush();
      return;
    }
    if (SN_CJK.test(ch.ch)) {
      cjkRun.push({ ch: ch.ch, ci, start: ch.start, end: ch.end });
      return;
    }
    // 非中文（拉丁/数字等）：整段成词
    if (cjkRun.length) flushRun();
    if (!cur) cur = { text: '', chList: [], charIdx: ci, firstStart: ch.start, lastEnd: ch.end, role: 'support' };
    cur.text += ch.ch; cur.chList.push(ch.ch); cur.lastEnd = ch.end;
  });
  if (cjkRun.length) flushRun();
  flush();
  return segs;
}
function snSegScore(s) {
  return Math.min(8, Array.from(s.text).length) * 14 + Math.min(2.5, Math.max(0, s.end - s.start)) * 18;
}
function assignSnRoles(segs, meta) {
  if (!segs.length) return;
  // 主词：得分最高者；并列时取更靠近行前 40% 的词（PV 构图重心）
  let hero = 0;
  const anchorT = meta.time + ((meta.end || meta.time + 4) - meta.time) * 0.4;
  segs.forEach((s, i) => {
    const sc = snSegScore(s), hc = snSegScore(segs[hero]);
    const sMid = (s.start + s.end) / 2, hMid = (segs[hero].start + segs[hero].end) / 2;
    if (sc > hc || (Math.abs(sc - hc) < 0.01 && Math.abs(sMid - anchorT) < Math.abs(hMid - anchorT))) hero = i;
  });
  segs[hero].role = 'hero';
  if (segs.length >= 4) {
    const thr = snSegScore(segs[hero]) * 0.35;
    const leanEarly = hero <= (segs.length - 1) / 2;
    let best = -1, bestScore = -Infinity;
    segs.forEach((s, i) => {
      if (i === hero || Math.abs(i - hero) < 2 || snSegScore(s) < thr) return;
      if ((leanEarly && i < hero) || (!leanEarly && i > hero)) return;
      if (snSegScore(s) > bestScore) { bestScore = snSegScore(s); best = i; }
    });
    if (best >= 0) segs[best].role = 'semi';
  }
}
function compileSonnetProgram() {
  let prevKind = null;
  snProgram = lyricMeta.map((m, i) => {
    const segs = buildSonnetSegments(m);
    assignSnRoles(segs, m);
    const rnd = snHash(m.text + ':' + i);
    const isChorus = chorusSet.has(m.text);
    const shortLine = Array.from(m.text).length <= 6;
    const pick = (off) => {
      // 确定性散布：hash + 行号错位（(rnd + i*3)），避免同质化连拍
      const seq = (rnd + i * 3 + off) % SN_SHOT_KINDS.length;
      let kind = SN_SHOT_KINDS[seq];
      // Folia 规则：副歌禁用静默 tableau，保持情绪张力
      if (isChorus && kind === 'tableau') kind = SN_SHOT_KINDS[(seq + 1) % SN_SHOT_KINDS.length];
      return kind;
    };
    // 短句定格 tableau（屏息感）；长句按镜头语法散布
    let kind = (shortLine && !isChorus) ? 'tableau' : pick(0);
    if (kind === prevKind) kind = pick(1);
    prevKind = kind;
    m.shotKind = kind;
    return segs;
  });
}
function layoutSonnetLine(el, segs, meta) {
  const seed = snHash(meta.text);
  const kind = meta.shotKind || 'ring';
  const n = segs.length;
  const heroIdx = segs.findIndex((s) => s.role === 'hero');
  const hero = segs[heroIdx];
  if (!hero) return;
  segs.forEach((s) => { s.vertical = false; s.ex = 0; s.ey = 0; });
  hero.bx = 0; hero.by = -0.015; hero.br = 0; hero.bs = 1.02;
  hero.ex = 0; hero.ey = 0.16;    // 主词自下入画
  if (kind === 'cross') {
    // type-impact：上列（竖排）→ 左行 → 主词 → 右行 → 下列（竖排）
    const before = segs.slice(0, heroIdx);
    const after = segs.slice(heroIdx + 1);
    const topCount = Math.floor(before.length / 2);
    for (let k = 0; k < topCount; k++) {
      const s = before[k];
      s.vertical = true; s.bx = (snRand(seed, k * 3 + 1) - 0.5) * 0.08;
      s.by = -0.10 - k * 0.095; s.br = (snRand(seed, k * 3 + 2) - 0.5) * 8;
      s.bs = 0.82; s.ex = 0; s.ey = -0.035;
    }
    for (let k = topCount; k < before.length; k++) {
      const s = before[k];
      s.vertical = false; s.bx = -0.16 - (k - topCount) * 0.15;
      s.by = hero.by + (k % 2 === 0 ? 0.035 : -0.035);
      s.br = (snRand(seed, k * 5 + 1) - 0.5) * 10; s.bs = 0.86;
      s.ex = -0.035; s.ey = 0;
    }
    const rightCount = Math.ceil(after.length / 2);
    for (let k = 0; k < rightCount; k++) {
      const s = after[k];
      s.vertical = false; s.bx = 0.15 + k * 0.15;
      s.by = hero.by + (k % 2 === 0 ? 0.03 : -0.03);
      s.br = (snRand(seed, k * 7 + 1) - 0.5) * 10; s.bs = 0.86;
      s.ex = 0.035; s.ey = 0;
    }
    for (let k = rightCount; k < after.length; k++) {
      const s = after[k];
      s.vertical = true; s.bx = (snRand(seed, k * 9 + 1) - 0.5) * 0.08;
      s.by = 0.10 + (k - rightCount) * 0.095;
      s.br = (snRand(seed, k * 9 + 2) - 0.5) * 8; s.bs = 0.82;
      s.ex = 0; s.ey = 0.035;
    }
  } else if (kind === 'ribbon') {
    // tracking-ribbon：时间轴横带，相机横向跟拍
    const step = n > 1 ? 0.155 : 0;
    segs.forEach((s, i) => {
      s.vertical = false;
      s.bx = (i - heroIdx) * step;
      s.by = hero.by + Math.sin(i * 2.1 + seed) * 0.045;
      s.br = (snRand(seed, i * 4 + 1) - 0.5) * 12;
      s.bs = s.role === 'hero' ? 1.05 : (s.role === 'semi' ? 0.92 : 0.84);
      s.ex = s.bx + 0.40; s.ey = s.by;
    });
  } else if (kind === 'tableau') {
    // quiet-tableau：竖排时间轴栈，前文在上、后文在下
    let up = -0.115, down = 0.115;
    for (let i = heroIdx - 1; i >= 0; i--) {
      const s = segs[i];
      s.vertical = true; s.bx = (snRand(seed, i * 3 + 1) - 0.5) * 0.05;
      s.by = up; up -= 0.095;
      s.br = (snRand(seed, i * 3 + 2) - 0.5) * 6; s.bs = 0.8;
      s.ex = 0; s.ey = 0.045;
    }
    for (let i = heroIdx + 1; i < n; i++) {
      const s = segs[i];
      s.vertical = true; s.bx = (snRand(seed, i * 3 + 4) - 0.5) * 0.05;
      s.by = down; down += 0.095;
      s.br = (snRand(seed, i * 3 + 5) - 0.5) * 6; s.bs = 0.8;
      s.ex = 0; s.ey = -0.045;
    }
  } else {
    // fragment-collage：主词居中，支撑词沿椭圆轨道环绕，半主词在对侧
    const rx = 0.34 + snRand(seed, 2) * 0.12;
    const ry = 0.22 + snRand(seed, 3) * 0.08;
    let semiA = Math.PI * 2 * snRand(seed, 4);
    let supA = semiA + Math.PI / 2;
    segs.forEach((s, i) => {
      if (s.role === 'semi') {
        s.bx = Math.cos(semiA) * rx * 1.15;
        s.by = hero.by + Math.sin(semiA) * ry * 1.2;
        s.br = (snRand(seed, i * 6 + 1) - 0.5) * 14; s.bs = 0.92;
      } else if (s.role !== 'hero') {
        s.bx = Math.cos(supA) * rx;
        s.by = hero.by + Math.sin(supA) * ry;
        s.br = (snRand(seed, i * 6 + 2) - 0.5) * 20; s.bs = 0.82;
        supA += (Math.PI * 2 / Math.max(1, n - 1)) * 0.9 + 0.18;
      }
      if (s.role !== 'hero') { s.ex = s.bx * 1.3; s.ey = s.by * 1.3; }
    });
  }
}
function buildSonnetLine(meta, segs) {
  const div = document.createElement('div');
  div.className = 'lyric-line sonnet';
  const hero = segs.find((s) => s.role === 'hero');
  segs.forEach((s, i) => {
    const w = document.createElement('span');
    w.className = 'sn-word role-' + s.role + (s.vertical ? ' vertical' : '');
    w.dataset.si = i;
    s.chList.forEach((ch) => {
      const c = document.createElement('span');
      c.className = 'sn-char';
      c.textContent = ch;
      c.dataset.ch = ch;
      w.appendChild(c);
    });
    div.appendChild(w);
  });
  if (hero) {
    const deco = document.createElement('span');
    deco.className = 'sn-word role-deco';
    deco.textContent = hero.text;
    div.appendChild(deco);
  }
  div.__snWords = Array.from(div.querySelectorAll('.sn-word'));
  return div;
}
function renderSonnetLine(idx) {
  const meta = lyricMeta[idx];
  const segs = snProgram[idx] || [];
  if (!meta) return;
  const el = buildSonnetLine(meta, segs);
  layoutSonnetLine(el, segs, meta);
  lyricFloatEl.appendChild(el);
  const kind = meta.shotKind || 'ring';
  el.classList.add('shot-' + kind);
  el.classList.add('sn-blur');
  stageLineEl = el;
  snBox = { w: el.clientWidth || 1400, h: el.clientHeight || 700 };
  snFocusX = 0; snFocusY = 0;
  showSonnetShotTag(kind, idx);
  updateStageSubtitle(idx);
  lyricOffset = (idx * 23) % 70 - 35;
  applyMood();
}
let snFocusX = 0, snFocusY = 0, snBox = null;
let snShotTagEl = null, snShotTagTimer = 0;
const SN_SHOT_NAMES = { cross: '对冲', ring: '回环', ribbon: '流带', tableau: '定格' };
function showSonnetShotTag(kind, idx) {
  if (!snShotTagEl) {
    snShotTagEl = document.createElement('div');
    snShotTagEl.id = 'snShotTag';
    stageViewEl.appendChild(snShotTagEl);
  }
  snShotTagEl.textContent = 'SONNET ' + String(idx + 1).padStart(2, '0') + ' · ' + (SN_SHOT_NAMES[kind] || kind).toUpperCase();
  snShotTagEl.classList.remove('show');
  void snShotTagEl.offsetWidth;
  snShotTagEl.classList.add('show');
  clearTimeout(snShotTagTimer);
  snShotTagTimer = setTimeout(() => snShotTagEl.classList.remove('show'), 1500);
}
const snEaseInOut = (v) => v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
function updateSonnetLine(el, meta, sec, t) {
  const segs = snProgram[stageLineIdx] || [];
  const w = snBox ? snBox.w : 1400, h = snBox ? snBox.h : 700;
  const words = el.__snWords || (el.__snWords = Array.from(el.querySelectorAll('.sn-word')));
  const kind = meta.shotKind || 'ring';
  const n = segs.length;
  const hero = segs.find((s) => s.role === 'hero');
  const lineStart = meta.time;
  const lineEnd = lyricMeta[stageLineIdx + 1] ? lyricMeta[stageLineIdx + 1].time : (meta.end || lineStart + 4);
  const p = Math.min(1, Math.max(0, (sec - lineStart) / Math.max(1.2, lineEnd - lineStart)));
  const ep = snEaseInOut(p);
  // 镜头运动（Folia shot camera path）：克制流畅，杜绝高频抖动，保证可读性
  const isChorus = chorusSet.has(meta.text);
  const cut = Math.min(1, Math.max(0, p * 2.2));
  const punch = 1 - Math.pow(2, -10 * Math.min(p / 0.2, 1));
  let camX = 0, camY = 0, camS = 1, camR = 0;
  if (kind === 'ribbon') {
    // 横向跟拍：镜头缓慢扫过词带
    camX = (-0.10 + ep * 0.20) * w;
    camY = (0.03 - ep * 0.06) * h;
    camS = 0.98 + ep * 0.04;
    camR = 0.004 - ep * 0.008;
  } else if (kind === 'cross') {
    // 对冲：入画轻微推近，无抖动
    camX = (-0.02 + ep * 0.06) * w;
    camY = (0.01 - ep * 0.03) * h;
    camS = 1.12 - punch * 0.10 + ep * 0.05;
    camR = -0.005 + ep * 0.008;
  } else if (kind === 'ring') {
    // 环绕：沿弧线缓推，词环随之滚动
    const arc = Math.sin(Math.min(1, cut * 1.5) * Math.PI);
    camX = (-0.07 + arc * 0.10 + ep * 0.01) * w;
    camY = (0.03 - arc * 0.05 + ep * 0.005) * h;
    camS = 0.99 + arc * 0.05 + ep * 0.02;
    camR = -0.008 + arc * 0.012 + ep * 0.004;
  } else {
    // 定格 tableau：几乎不动
    camX = (-0.006 + ep * 0.012) * w;
    camY = (0.005 - ep * 0.008) * h;
    camS = 1 + ep * 0.012;
    camR = -0.0005 + ep * 0.0005;
  }
  camS *= 1 + audioPower * 0.02 + beatKick * 0.03 + (isChorus ? chorusLevel * 0.02 : 0);
  // 焦点追踪：以激活度最高的词段为主，让正在唱的字符贴近画面中心
  let fx = 0, fy = 0, tot = 0;
  let fbx = hero ? hero.bx : 0, fby = hero ? hero.by : 0, fbg = -1;
  const sigma = 0.30;
  for (const s of segs) {
    const d = sec < s.start ? s.start - sec : sec > s.end ? sec - s.end : 0;
    const g = Math.exp(-(d * d) / (2 * sigma * sigma));
    fx += s.bx * g; fy += s.by * g; tot += g;
    if (g > fbg) { fbg = g; fbx = s.bx; fby = s.by; }
  }
  let fdx = 0, fdy = 0;
  if (tot > 0) {
    const blend = fbg > 0.55 ? 0.8 : 0.4;
    fdx = fbx * blend + (fx / tot) * (1 - blend);
    fdy = fby * blend + (fy / tot) * (1 - blend);
  }
  snFocusX += (fdx - snFocusX) * 0.16;
  snFocusY += (fdy - snFocusY) * 0.16;
  // 呼吸漂移大幅收敛：只保留极轻微视差，避免与追踪打架
  const driftX = mouseX * 8;
  const driftY = bass * 4;
  el.style.transform =
    'translate3d(' + (camX - snFocusX * w * 0.5 + driftX).toFixed(1) + 'px,' +
    (camY - snFocusY * h * 0.5 + driftY).toFixed(1) + 'px,0)' +
    ' rotate(' + (camR * 24 + Math.sin(t * 0.3) * 0.6).toFixed(2) + 'deg)' +
    ' scale(' + camS.toFixed(4) + ')';
  const heroPulse = 1 + beatKick * (isChorus ? 0.07 : 0.05) + bass * 0.01;
  for (let i = 0; i < words.length; i++) {
    const wd = words[i];
    const s = segs[i];
    if (!s) continue;
    const raw = Math.min(1, Math.max(0, (sec - s.start - i * 0.02) / (s.role === 'support' ? 0.42 : 0.5)));
    // 流畅入画：easeOutCubic，无回弹过冲，保证可读性
    const ease = raw >= 1 ? 1 : 1 - Math.pow(1 - raw, 3);
    let scBase;
    if (s.role === 'hero') {
      const pop = 1 + 0.10 * Math.sin(Math.min(1, raw * 1.8) * Math.PI) * (kind === 'cross' ? 1 : 0.6);
      scBase = (0.62 + 0.38 * ease) * pop;
    } else if (s.role === 'semi') {
      scBase = 0.7 + 0.3 * ease;
    } else {
      scBase = 0.72 + 0.28 * ease;
    }
    const fadeDur = kind === 'tableau' ? 1.2 : 0.9;
    const fade = Math.min(1, ((sec - s.start) / fadeDur) * 2.0);
    const wdX = Math.sin(t * 0.8 + i * 1.7) * (2 + bass * 4);
    const wdY = Math.cos(t * 0.7 + i * 2.3) * (2 + vocal * 3);
    const x = (s.bx + (s.ex - s.bx) * (1 - ease)) * w + wdX;
    const y = (s.by + (s.ey - s.by) * (1 - ease)) * h + wdY;
    const sc = s.bs * scBase * camS * (s.role === 'hero' ? heroPulse : 1);
    wd.style.transform =
      'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)' +
      ' rotate(' + (s.br + wdX * 0.2).toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')';
    wd.style.opacity = Math.max(0, Math.min(1, fade)).toFixed(3);
    const chars = wd.children;
    for (let ci = 0; ci < chars.length; ci++) {
      const cmeta = meta.chars[s.charIdx + ci];
      chars[ci].classList.toggle('on', !!(cmeta && sec >= cmeta.start - 0.05));
    }
  }
  // 幽灵衬字：主词放大 3x 的远景字，随镜头视差移动
  const deco = words[n];
  if (deco && hero) {
    const he = Math.min(1, Math.max(0, (sec - hero.start) / 0.55));
    const hEase = he >= 1 ? 1 : 1 - Math.pow(2, -10 * he);
    const dx = hero.bx * w + 34 - snFocusX * w * 0.3 + camX * 0.4;
    const dy = hero.by * h - 26 - snFocusY * h * 0.3 + camY * 0.4;
    deco.style.transform =
      'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0)' +
      ' rotate(-6deg) scale(' + (3.1 * (0.55 + 0.45 * hEase) * camS).toFixed(3) + ')';
    deco.style.opacity = (0.06 + vocal * 0.07 + beatKick * 0.06).toFixed(3);
  }
}
function drawSonnetStaff(t) {
  const cv = document.getElementById('snStaff');
  if (!cv || stageViewEl.classList.contains('hidden')) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = cv.clientWidth || innerWidth, ch = cv.clientHeight || 220;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const top = ch * 0.34, step = ch * 0.115;
  const alpha = 0.14 + audioPower * 0.14;
  ctx.strokeStyle = 'rgba(205,220,255,' + alpha.toFixed(3) + ')';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(cw * 0.08, top + i * step); ctx.lineTo(cw * 0.92, top + i * step); ctx.stroke();
  }
  const totalBeats = 22, cycle = 8, span = cw * 0.84;
  const prog = (t % cycle) / cycle;
  // 扫光：随节拍周期在五线谱上滑行
  const sweepX = cw * 0.08 + prog * span * 1.6;
  const grad = ctx.createLinearGradient(sweepX - 90, 0, sweepX + 90, 0);
  grad.addColorStop(0, 'rgba(255,240,200,0)');
  grad.addColorStop(0.5, 'rgba(255,240,200,' + (0.07 + beatKick * 0.1).toFixed(3) + ')');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(sweepX - 90, top - 8, 180, step * 4 + 16);
  for (let i = 0; i < LA_FOLIA_NOTES.length; i++) {
    const [st, beats] = LA_FOLIA_NOTES[i];
    let noteTime = 0;
    for (let j = 0; j < i; j++) noteTime += LA_FOLIA_NOTES[j][1];
    const bornFrac = noteTime / totalBeats;
    let d = prog - bornFrac;
    if (d < 0) d += 1;
    if (d > 0.55) continue;
    const x = cw * 0.08 + d * span * 1.6;
    const y = top + (6 - st) * (step / 2) + step * 0.5;
    const fade = Math.sin(Math.min(1, d / 0.18) * Math.PI);
    const noteSize = (4 + beats * 2.2) * (1 + audioPower * 0.5 + beatKick * 0.5);
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, fade * (0.45 + beatKick * 0.4));
    ctx.fillStyle = 'rgba(255,232,173,0.92)';
    ctx.shadowColor = 'rgba(255,214,140,0.85)';
    ctx.shadowBlur = 10 + beatKick * 12;
    ctx.beginPath();
    ctx.ellipse(x, y, noteSize, noteSize * 0.72, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,232,173,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + noteSize * 0.7, y);
    ctx.lineTo(x + noteSize * 0.7, y - step * 0.9);
    ctx.stroke();
    ctx.restore();
  }
}

// ===== 每帧驱动：歌词随特效运动 =====
// ================= Folia 商籁引擎（Pixi 移植版） =================
let sonnetRt = null;
let sonnetStarting = false;
let sonnetAbort = null;
let sonnetFrame = 0;
let qinSrePrevKick = 0;
let sonnetHostEl = null;
const sonnetTimeMV = { v: 0, get() { return this.v; } };
const sonnetPowerMV = { v: 0, get() { return this.v; } };
const sonnetBassMV = { v: 0, get() { return this.v; } };
const sonnetLowMV = { v: 0, get() { return this.v; } };
const sonnetMidMV = { v: 0, get() { return this.v; } };
const sonnetVocalMV = { v: 0, get() { return this.v; } };
const sonnetTrebleMV = { v: 0, get() { return this.v; } };

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh, i) => {
    const v = Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return v.toString(16).padStart(2, '0');
  };
  return '#' + ch(16, 0) + ch(8, 0) + ch(0, 0);
}
function rolePaletteHex() {
  const key = document.body.dataset.btnStyle || '';
  if (!key || key === 'off') return null;
  const cs = getComputedStyle(document.body);
  const c1 = (cs.getPropertyValue('--op-c1') || '').trim();
  const c2 = (cs.getPropertyValue('--op-c2') || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(c1) || !/^#[0-9a-f]{6}$/i.test(c2)) return null;
  return { c1, c2 };
}
function currentSonnetTheme() {
  const h = Number.isFinite(curHue) ? curHue : 200;
  const rp = rolePaletteHex();
  return {
    name: rp ? ('YuMusic-' + (document.body.dataset.btnStyle || 'role')) : 'YuMusic',
    backgroundColor: '#07090f',
    primaryColor: rp ? rp.c1 : hslToHex(h + 12, 80, 74),
    accentColor: rp ? rp.c2 : hslToHex(h, 92, 62),
    secondaryColor: rp ? mixHex(rp.c1, rp.c2, 0.55) : hslToHex(h + 128, 66, 66),
    fontStyle: 'sans',
    animationIntensity: 'normal',
    lyricsIcons: ['Flower', 'Sparkles', 'Music', 'Heart', 'Star'],
  };
}

function buildFoliaLines() {
  return lyricMeta.map((m) => {
    const chars = m.chars && m.chars.length ? m.chars : Array.from(m.text).map((ch, ci, arr) => {
      const span = Math.max(m.end - m.time, 0.001) / Math.max(1, arr.length);
      return { ch, start: m.time + ci * span, end: m.time + (ci + 1) * span };
    });
    return {
      words: chars.map((ch) => ({
        text: ch.ch,
        startTime: Math.max(m.time, ch.start),
        endTime: Math.min(m.end, Math.max(ch.start + 0.02, ch.end)),
      })),
      startTime: m.time,
      endTime: m.end,
      fullText: m.text,
      translation: m.trans || undefined,
      isChorus: chorusSet.has(m.text) || undefined,
    };
  });
}

async function ensureSonnetRuntime() {
  if (sonnetRt) return sonnetRt;
  if (sonnetStarting) return null; // 创建中：避免并发重复创建两个 Pixi 运行时
  if (stageMode !== 'sonnet' || !lyricMeta.length) return null;
  const F = window.FoliaSonnet;
  if (!F || !F.SonnetPixiRuntime) { stageStatus.textContent = '商籁引擎未加载'; return null; }
  if (!sonnetHostEl) sonnetHostEl = document.getElementById('sonnetHost');
  if (!sonnetHostEl) return null;
  sonnetHostEl.innerHTML = '';
  sonnetStarting = true;
  sonnetAbort = new AbortController();
  try {
    const lines = buildFoliaLines();
    const seedKey = 'qin:' + (currentSong && currentSong.id ? currentSong.id : (demoMode ? 'demo' : 'live'));
    const tCompile0 = performance.now();
    const program = F.compileSonnetProgram(lines, seedKey);
    const tCompile1 = performance.now();
    sonnetRt = await F.SonnetPixiRuntime.create({
      host: sonnetHostEl,
      program,
      theme: currentSonnetTheme(),
      tuning: Object.assign({}, F.DEFAULT_SONNET_TUNING, {
        textureResolution: 1,
        mgDensity: 0.6,
        showGiantDecorativeText: false,
        showGuide: false,
      }),
      currentTime: sonnetTimeMV,
      audioPower: sonnetPowerMV,
      audioBands: { bass: sonnetBassMV, lowMid: sonnetLowMV, mid: sonnetMidMV, vocal: sonnetVocalMV, treble: sonnetTrebleMV },
      lyricsFontScale: 1,
      staticMode: false,
      paused: true, // driven by the main rAF loop via renderOnce()
      signal: sonnetAbort.signal,
      songTitle: currentSong ? currentSong.name : (demoMode ? '晚霞 晚霞 请慢些落下' : null),
      songArtist: currentSong ? currentSong.artist : (demoMode ? 'YuMusic' : null),
      songAlbum: currentSong ? currentSong.album : null,
    });
    const tCreate1 = performance.now();
    window.__sonnetTiming = { compileMs: Math.round(tCompile1 - tCompile0), createMs: Math.round(tCreate1 - tCompile1), totalMs: Math.round(tCreate1 - tCompile0) };
    if (stageMode !== 'sonnet' || sonnetAbort.signal.aborted) {
      try { sonnetRt.destroy(); } catch (err) { /* 忽略 */ }
      sonnetRt = null;
      return null;
    }
    stageViewEl.classList.add('folia-mode');
    document.body.classList.add('folia-mode');
    window.__sonnetRt = sonnetRt;
    window.__sonnetProgram = program;
    window.__sonnetMV = sonnetTimeMV;
    if (stageLineEl && stageLineEl.parentNode) stageLineEl.parentNode.removeChild(stageLineEl);
    stageLineEl = null;
    if (stageLineIdx < 0) stageLineIdx = currentStageIndex(sonnetTimeMV.v);
    updateStageSubtitle(stageLineIdx);
    return sonnetRt;
  } catch (err) {
    console.error('Folia sonnet runtime failed:', err);
    stageStatus.textContent = '商籁引擎启动失败';
    sonnetRt = null;
    return null;
  } finally {
    sonnetStarting = false;
  }
}

function destroySonnetRuntime() {
  if (sonnetAbort) { try { sonnetAbort.abort(); } catch (err) { /* 忽略 */ } sonnetAbort = null; }
  if (sonnetRt) {
    try { sonnetRt.destroy(); } catch (err) { /* 忽略 */ }
    sonnetRt = null;
  }
  sonnetStarting = false;
  if (sonnetHostEl) {
    sonnetHostEl.innerHTML = '';
    const leaked = sonnetHostEl.querySelectorAll('canvas');
    leaked.forEach((c) => c.remove());
  }
  stageViewEl.classList.remove('folia-mode');
  document.body.classList.remove('folia-mode');
}

function updateStage(t, dt) {
  if (stageViewEl.classList.contains('hidden')) return;
  const sec = lyricSec();
  if (!lyricMeta.length) return;
  const idx = currentStageIndex(sec);
  // 间奏清场：上一句已唱完且下一句还早，淡出而不是一直挂屏（避免曲词不对应）
  if (idx < 0 && stageLineIdx >= 0 && stageLineEl) {
    const cur = lyricMeta[stageLineIdx];
    if (sec > (cur.singEnd || cur.end) + 0.55) clearStageLine();
  }
  let target = idx;
  if (target >= 0 && target !== stageLineIdx) {
    showStageLine(target);
  }
  if (stageMode === 'sonnet' && !sonnetRt && !sonnetStarting) {
    ensureSonnetRuntime();
    if (!sonnetRt) return;
  }
  if (stageMode === 'sonnet' && sonnetRt) {
    sonnetTimeMV.v = sec;
    sonnetPowerMV.v = audioPower;
    sonnetBassMV.v = bass;
    sonnetLowMV.v = lowMid;
    sonnetMidMV.v = mid;
    sonnetVocalMV.v = vocal;
    sonnetTrebleMV.v = treble;
    if (sonnetRt) sonnetRt.renderOnce();
    const sre = document.getElementById('sonnetRoleEmblem');
    if (sre && beatKick > 0.55 && qinSrePrevKick <= 0.55) {
      sre.classList.remove('kick');
      void sre.offsetWidth;
      sre.classList.add('kick');
    }
    qinSrePrevKick = beatKick;
    updateStageSubtitle(stageLineIdx);
    return;
  }
  if (stageMode === 'stage') {
    ensureMrStage();
    if (mrStage) {
      mrStage.syncSong(currentSong);
      mrStage.setHue(curHue);
      if (typeof mrStage.setPlaying === 'function') mrStage.setPlaying(demoMode ? true : !!currentSong && !audio.paused);
      mrStage.update(t, dt, sec, beatKick, bass, chorusLevel, vocal, mid, treble, lowMid, audioPower);
    }
    return;
  }
  if (!stageLineEl) return;
  const meta = lyricMeta[stageLineIdx];
  chorusLevelTarget = chorusSet.has(meta.text) ? 1 : 0;
  lyricFloatEl.classList.toggle('chorus', chorusLevelTarget === 1);
  // 整行呼吸浮动（正弦漂移 + 鼠标视差 + 低频起伏 + 副歌放大）
  let breathX, breathY, breathR, breathS;
  if (stageMode === 'sonnet') {
    // 商籁由行内镜头驱动，外层只保留极轻微呼吸，避免双重运动导致抖动
    breathX = mouseX * 6; breathY = 0; breathR = 0;
    breathS = 1 + chorusLevel * 0.02 + beatKick * 0.015;
  } else {
    breathX = Math.sin(t * 0.5) * 16 + mouseX * 30 + Math.sin(t * 1.3) * vocal * 16;
    breathY = Math.cos(t * 0.42) * 11 + bass * 14 + mid * 11 + chorusLevel * 6;
    breathR = Math.sin(t * 0.3) * 2.5 + mouseX * 4 + Math.sin(t * 0.9) * bass * 3.5;
    breathS = 1 + bass * 0.025 + audioPower * 0.03 + chorusLevel * 0.045 + stagePulse * 0.02 + beatKick * 0.035;
  }
  const floatTF =
    `translate3d(${breathX.toFixed(1)}px, ${breathY.toFixed(1)}px, 0) rotate(${breathR.toFixed(2)}deg) scale(${breathS.toFixed(4)})`;
  if (lyricFloatEl.__tf !== floatTF) { lyricFloatEl.__tf = floatTF; lyricFloatEl.style.transform = floatTF; }
  if (stageMode === 'classic') updateClassicLine(stageLineEl, meta, sec);
  else if (stageMode === 'pendolo') updatePendoloLine(stageLineEl, meta, sec);
  else if (stageMode === 'flow') updateFlowLine(stageLineEl, meta, sec);
  else if (stageMode === 'heart') updateFlowLine(stageLineEl, meta, sec);
  else if (stageMode === 'cloud') updateCloudLines(t, sec);
  else if (stageMode === 'aurora') updateAuroraLine(stageLineEl, meta, sec, t);
  else if (stageMode === 'cascade') updateCascadeLine(stageLineEl, meta, sec, t);
  else if (stageMode === 'sonnet') updateSonnetLine(stageLineEl, meta, sec, t);
  if (stageMode === 'sonnet') drawSonnetStaff(t);
  updateWave(t);
}

// ===== 底部波形（FFT 驱动） =====
function initWave() {
  const wave = $('stageWave');
  if (!waveBars.length) {
    for (let i = 0; i < 72; i++) {
      const b = document.createElement('i');
      wave.appendChild(b);
      waveBars.push(b);
    }
  }
}
function updateWave(t) {
  if (!waveBars.length || stageViewEl.classList.contains('hidden') || document.body.classList.contains('folia-mode')) return;
  const n = waveBars.length;
  for (let i = 0; i < n; i++) {
    let v = 0;
    if (analyser && freqData) {
      const idx = Math.floor((i / n) * freqData.length);
      const raw = freqData[idx] / 255;
      v = raw * (0.5 + bass * 0.9 + (1 - i / n) * 0.55);
    } else {
      v = 0.08 + 0.06 * Math.abs(Math.sin(t * 0.9 + i * 0.4));
    }
    const h = 4 + v * 135 * (0.55 + bass);
    waveBars[i].style.transform = 'scaleY(' + (h / 100).toFixed(3) + ')';
  }
}

// ===== 模式切换 =====
function setStageMode(mode) {
  if (REMOVED_STAGE_MODES.indexOf(mode) >= 0) mode = 'sonnet';
  stageMode = mode;
  stageViewEl.dataset.mode = mode;
  if (mode === 'sonnet') ensureSonnetRuntime();
  else destroySonnetRuntime();
  if (mode === 'stage') {
    ensureMrStage(); if (mrStage) mrStage.setVisible(true); applyMrPresetUI();
    // 星海模式：封面网格独占背景，隐藏模糊封面底衬，网格更清晰拼出封面
    if (stageCoverBg) stageCoverBg.style.opacity = '0';
  } else {
    if (mrStage) mrStage.setVisible(false);
    // 离开星海：恢复背景设置对应的封面底衬（避免星海背景残留）
    syncCoverOpacity();
  }
  const mrRow = $('mrPresetRow');
  if (mrRow) mrRow.classList.toggle('hidden', mode !== 'stage');
  const mrParamRowEl = $('mrParamRow');
  if (mrParamRowEl) mrParamRowEl.classList.toggle('hidden', mode !== 'stage');
  if (typeof applyMrParamUI === 'function') applyMrParamUI();
  localStorage.setItem('qin-lyric-mode', mode);
  const modeHint = $('mrModeHint');
  if (modeHint) modeHint.textContent = mode === 'stage' ? '星海 · Mineradio 粒子舞台，支持预设与参数调节' : '商籁 · 逐字歌词电影级舞台，随歌曲自动编排';
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  if (!lyricMeta.length) return;
  const sec = lyricSec();
  const idx = currentStageIndex(sec);
  if (idx >= 0) showStageLine(idx);
  else lyricFloatEl.innerHTML = '';
}
document.querySelectorAll('.mode-btn').forEach((b) => {
  b.addEventListener('click', () => { setStageMode(b.dataset.mode); toggleBgPanel(false); });
});

// ===== 星海预设（Mineradio 9 个视觉预设）=====
const MR_PRESET_KEYS = ['qin-mr-preset'];
function savedMrPreset() {
  try { const v = Number(localStorage.getItem(MR_PRESET_KEYS[0])); return Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 0; } catch (err) { return 0; }
}
function applyMrPresetUI() {
  const row = $('mrPresetRow');
  if (!row) return;
  row.classList.toggle('hidden', stageMode !== 'stage');
  applyMrParamUI();
  if (stageMode !== 'stage') return;
  let cur = 0;
  if (mrStage && mrStage.getPreset) cur = mrStage.getPreset();
  else cur = savedMrPreset();
  document.querySelectorAll('#mrPresetSeg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.preset) === cur));
}
document.querySelectorAll('#mrPresetSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    const p = Number(b.dataset.preset);
    try { localStorage.setItem(MR_PRESET_KEYS[0], String(p)); } catch (err) { /* 忽略 */ }
    ensureMrStage();
    if (mrStage && mrStage.setPreset) {
      mrStage.setPreset(p, { preserveCamera: false });
      applyMrPresetUI();
    }
  });
});

// ===== 星海参数（Mineradio 视觉布局 + 鼠标交互强度）=====
const MR_PARAM_KEYS = ['qin-mr-params'];
const MR_PARAM_DEFAULTS = {
  density: 1.55, point: 1.0, speed: 1.0, twist: 0, color: 1.1,
  bloom: 0.62, zoom: 6.6, mousePush: 1, spinSens: 1, audioSens: 1, timeScale: 1, lyricFollow: true
};
function savedMrParams() {
  const out = Object.assign({}, MR_PARAM_DEFAULTS);
  try {
    const raw = JSON.parse(localStorage.getItem(MR_PARAM_KEYS[0]) || '{}');
    for (const k of Object.keys(MR_PARAM_DEFAULTS)) {
      const rawV = raw[k];
      if (typeof MR_PARAM_DEFAULTS[k] === 'boolean') { out[k] = rawV == null ? MR_PARAM_DEFAULTS[k] : !!rawV; continue; }
      const v = Number(rawV);
      if (Number.isFinite(v)) out[k] = v;
    }
  } catch (err) { /* 默认值 */ }
  return out;
}
function applyMrParamsToStage() {
  if (!mrStage || typeof mrStage.setParams !== 'function') return;
  const p = savedMrParams();
  const send = Object.assign({}, p);
  // UI 的“光效”滑块数值即 bloomStrength；bloom 开关由数值是否 >0 决定
  if (p.bloom != null) { send.bloom = p.bloom > 0; send.bloomStrength = p.bloom; }
  mrStage.setParams(send);
}
function fmtMrParam(v) {
  const sv = Number(v).toFixed(2);
  return sv.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
function applyMrParamUI() {
  const row = $('mrParamRow');
  if (!row) return;
  row.classList.toggle('hidden', stageMode !== 'stage');
  const p = savedMrParams();
  const followToggle = $('mrLyricFollowToggle');
  if (followToggle) followToggle.classList.toggle('on', !!p.lyricFollow);
  if (stageMode !== 'stage') return;
  document.querySelectorAll('#mrParamList input[data-p]').forEach((inp) => {
    const k = inp.dataset.p;
    const v = p[k] != null ? p[k] : MR_PARAM_DEFAULTS[k];
    inp.value = String(v);
    const b = document.querySelector('[data-v="' + k + '"]');
    if (b) b.textContent = fmtMrParam(v);
  });
}
function initMrParams() {
  const list = $('mrParamList');
  if (!list) return;
  list.addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp || !inp.dataset || inp.dataset.p === undefined) return;
    const k = inp.dataset.p;
    const p = savedMrParams();
    p[k] = Number(inp.value);
    try { localStorage.setItem(MR_PARAM_KEYS[0], JSON.stringify(p)); } catch (err) { /* 忽略 */ }
    const b = document.querySelector('[data-v="' + k + '"]');
    if (b) b.textContent = fmtMrParam(p[k]);
    applyMrParamsToStage();
  });
  const followToggle = $('mrLyricFollowToggle');
  if (followToggle) followToggle.addEventListener('click', () => {
    const p = savedMrParams();
    p.lyricFollow = !p.lyricFollow;
    try { localStorage.setItem(MR_PARAM_KEYS[0], JSON.stringify(p)); } catch (err) { /* 忽略 */ }
    applyMrParamUI();
    applyMrParamsToStage();
  });
  const reset = $('mrParamReset');
  if (reset) reset.addEventListener('click', () => {
    try { localStorage.setItem(MR_PARAM_KEYS[0], JSON.stringify(MR_PARAM_DEFAULTS)); } catch (err) { /* 忽略 */ }
    applyMrParamUI();
    applyMrParamsToStage();
  });
  applyMrParamUI();
  applyMrParamsToStage();
}

// 舞台返回：左上角热点显示返回按钮

// stageBackBtn wiring
stageBackBtn.addEventListener('click', () => showView(prevStageView));
stageViewEl.addEventListener('mousemove', (e) => {
  stageBackBtn.classList.toggle('visible', e.clientX <= 150 && e.clientY <= 150);
});
stageViewEl.addEventListener('mouseleave', () => {
  stageBackBtn.classList.remove('visible');
});
// ================= 加载/缓冲提示 =================
let loadingCount = 0;
let bufferingOn = false;
const pbLoadingEl = $('pbLoading');
function setLoading(on, label) {
  loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
  const active = loadingCount > 0;
  const ov = $('stageLoading');
  if (ov) {
    if (active) {
      ov.classList.remove('hidden');
      const t = $('stageLoadingText');
      if (t && label) t.textContent = label;
    } else {
      ov.classList.add('hidden');
    }
  }
  playerbarEl.classList.toggle('loading', active);
  if (pbLoadingEl) pbLoadingEl.classList.toggle('hidden', !(active || bufferingOn));
}
function setBuffering(on) {
  bufferingOn = !!on;
  const b = $('stageBuffering');
  if (b) b.classList.toggle('hidden', !on);
  if (pbLoadingEl) pbLoadingEl.classList.toggle('hidden', !(on || loadingCount > 0));
}

// ================= 音频事件 =================
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  progress.max = audio.duration;
  progress.value = audio.currentTime;
  syncProgressFill();
  curTime.textContent = fmt(audio.currentTime);
  totalTime.textContent = fmt(audio.duration);
  stageProgressFill.style.width = ((audio.currentTime / audio.duration) * 100).toFixed(2) + '%';
  if (deskLyricBtn.classList.contains('on')) pushLyricLine();
  pushMiniState();
});
progress.addEventListener('input', () => {
  audio.currentTime = progress.value;
  syncProgressFill();
});

// ================= 播放时底部控制栏自动隐藏 =================
const playerbarEl = $('playerbar');
let barHideTimer = null;
let barHovering = false;
function scheduleBarHide() {
  clearTimeout(barHideTimer);
  if (audio.paused || !audio.duration) { playerbarEl.classList.remove('auto-hide'); return; }
  barHideTimer = setTimeout(() => {
    if (!barHovering && !audio.paused && audio.duration) playerbarEl.classList.add('auto-hide');
  }, 3200);
}
function showBarNow() {
  clearTimeout(barHideTimer);
  playerbarEl.classList.remove('auto-hide');
}
document.addEventListener('mousemove', () => { showBarNow(); scheduleBarHide(); });
playerbarEl.addEventListener('mouseenter', () => { barHovering = true; showBarNow(); });
playerbarEl.addEventListener('mouseleave', () => { barHovering = false; scheduleBarHide(); });
playerbarEl.addEventListener('pointerdown', showBarNow);
audio.addEventListener('play', scheduleBarHide);
audio.addEventListener('pause', showBarNow);
audio.addEventListener('ended', showBarNow);

// ================= 桌面歌词 + 歌曲收藏（差异化特色） =================
const deskLyricBtn = $('deskLyricBtn');
const likeBtn = $('likeBtn');
let currentLiked = false;

deskLyricBtn.addEventListener('click', async () => {
  const on = await api.toggleLyricWindow();
  deskLyricBtn.classList.toggle('on', !!on);
  if (api.setTrayLyricState) api.setTrayLyricState(!!on);
  if (on && currentSong) pushLyricLine();
});

async function refreshLikeState(id, platform) {
  currentLiked = false;
  likeBtn.innerHTML = svgIcon('heart', 17);
  likeBtn.classList.remove('on');
  likeBtn.classList.remove('disabled');
  likeBtn.title = '';
  if (!id) return;
  if (platform === 'qq') {
    if (!api.qqLikeStatus) return;
    try {
      const map = await api.qqLikeStatus([id]);
      currentLiked = !!map[id];
      likeBtn.classList.toggle('on', currentLiked);
    } catch (err) { /* 忽略 */ }
    return;
  }
  if (!api.likeStatus) return;
  try {
    const map = await api.likeStatus([id]);
    currentLiked = !!map[id];
    likeBtn.classList.toggle('on', currentLiked);
  } catch (err) { /* 忽略 */ }
}

likeBtn.addEventListener('click', async () => {
  if (!currentSong || !currentSong.id) { statusLine.textContent = '当前没有可收藏的歌曲'; return; }
  if (currentSong.platform === 'qq') {
    const mid = currentSong.songmid || currentSong.id;
    if (!api.qqLikeSong) { statusLine.textContent = 'QQ 收藏暂不可用'; return; }
    try {
      const res = await api.qqLikeSong(mid, !currentLiked);
      if (res && res.ok) {
        currentLiked = !currentLiked;
        likeBtn.innerHTML = svgIcon('heart', 17);
        likeBtn.classList.toggle('on', currentLiked);
        likeBtn.classList.remove('pulse'); void likeBtn.offsetWidth; likeBtn.classList.add('pulse');
        statusLine.textContent = (currentLiked ? '已收藏 ♥ ' : '已取消收藏 ') + currentSong.name;
        syncLikedAfterChange('qq', mid, currentLiked);
        return;
      }
      showToast((res && res.needLogin ? 'QQ 收藏需要完整登录：' : 'QQ 收藏失败：') + ((res && res.error) || '未知错误'), 'err');
      statusLine.textContent = (res && res.needLogin ? 'QQ 收藏需要完整登录：' : 'QQ 收藏失败：') + ((res && res.error) || '未知错误');
    } catch (err) {
      statusLine.textContent = 'QQ 收藏失败：' + (err.message || err);
    }
    return;
  }
  try {
    const res = await api.likeSong(currentSong.id, !currentLiked);
    if (res && res.ok) {
      currentLiked = !currentLiked;
      likeBtn.innerHTML = svgIcon('heart', 17);
      likeBtn.classList.toggle('on', currentLiked);
      likeBtn.classList.remove('pulse'); void likeBtn.offsetWidth; likeBtn.classList.add('pulse');
      statusLine.textContent = (currentLiked ? '已收藏 ♥ ' : '已取消收藏 ') + currentSong.name;
      syncLikedAfterChange('netease', currentSong.id, currentLiked);
      return;
    }
    // 不再跳转网页：weapi 收藏已在主进程实现，失败时提示登录
    showToast('收藏失败：请先登录网易云账号后重试', 'err');
    statusLine.textContent = '收藏失败：请先登录网易云账号后重试';
  } catch (err) {
    showToast('收藏失败：' + (err.message || err), 'err');
    statusLine.textContent = '收藏失败：' + (err.message || err);
  }
});

function pushLyricLine() {
  if (!currentSong) return;
  const sec = lyricSec();
  const m = lyricMeta[stageLineIdx];
  api.sendLyricLine({
    text: m ? m.text : '',
    trans: m ? (m.trans || '') : '',
    lineStart: m ? m.time : 0,
    lineEnd: m ? m.end : 0,
    audioSec: sec,
    playing: !audio.paused,
    title: currentSong.name, artist: currentSong.artist,
    cover: currentSong.cover || '',
    songProgress: audio.duration ? (sec / audio.duration) * 100 : 0,
    duration: audio.duration || 0
  });
}
audio.addEventListener('play', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  playBtn.innerHTML = svgIcon('pause', 24);
  stageStatus.textContent = fmActive ? '私人FM · 正在播放' : '播放中';
  pushMiniState(true);
});
audio.addEventListener('pause', () => {
  playBtn.innerHTML = svgIcon('play', 25);
  setBuffering(false);
  stageStatus.textContent = '已暂停';
  pushMiniState(true);
});
audio.addEventListener('ended', () => {
  // 淡出后自动切下一首（播放模式决定去向：顺序 / 循环 / 随机 / 单曲）
  fadeOut(() => { goNext(true); }, 900);
});
audio.addEventListener('error', () => {
  audio.volume = baseVolume;
  setLoading(false);
  setBuffering(false);
  stageStatus.textContent = '播放出错（可能需要登录，或该歌曲不可播）';
  statusLine.textContent = '播放出错：可能需要登录，或该歌曲不可播';
});
audio.addEventListener('waiting', () => { setBuffering(true); });
audio.addEventListener('stalled', () => { setBuffering(true); });
audio.addEventListener('playing', () => { setBuffering(false); });
audio.addEventListener('canplay', () => { setBuffering(false); });
playBtn.addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
volume.addEventListener('input', () => { setVolume(+volume.value); });
let volMuted = false, volBeforeMute = 0.8;
function syncVolumeFill() {
  if (!volume) return;
  const p = Math.round((+volume.value || 0) * 100);
  volume.style.background = 'linear-gradient(to right, #22d3ee 0%, #a78bfa ' + p + '%, rgba(255,255,255,0.12) ' + p + '%)';
  const pct = document.getElementById('volPct');
  if (pct) pct.textContent = p + '%';
  const muteBtn = document.getElementById('volMuteBtn');
  if (muteBtn) muteBtn.classList.toggle('muted', volMuted || p === 0);
}
function setVolume(v) {
  baseVolume = Math.max(0, Math.min(1, +v || 0));
  audio.volume = baseVolume;
  if (baseVolume > 0.005) { volMuted = false; volBeforeMute = baseVolume; }
  syncVolumeFill();
}
const volMuteBtn = document.getElementById('volMuteBtn');
if (volMuteBtn) volMuteBtn.addEventListener('click', () => {
  volMuted = !volMuted;
  if (volMuted) { volBeforeMute = baseVolume; audio.volume = 0; volume.value = 0; }
  else { audio.volume = volBeforeMute || 0.8; volume.value = audio.volume; baseVolume = audio.volume; }
  syncVolumeFill();
});
function syncProgressFill() {
  const max = +progress.max || 0, v = +progress.value || 0;
  const p = max > 0 ? Math.round((v / max) * 100) : 0;
  progress.style.background = 'linear-gradient(to right, #22d3ee 0%, #a78bfa ' + p + '%, rgba(255,255,255,0.12) ' + p + '%)';
}
syncVolumeFill();
nextBtn.addEventListener('click', () => goNext(false));
prevBtn.addEventListener('click', goPrev);

// ================= 登录 / 账号面板 =================
let loginUserId = 0;
let activePlatform = 'netease';
let netLogin = { loggedIn: false, nickname: '', userId: 0, avatar: '', vipType: 0 };
let qqLogin = { loggedIn: false, nickname: '', userId: 0, avatar: '', vipType: 0, vipLevel: 0, vipLabel: '', vipOverdate: '', vipIcon: '' };
const accountPanel = $('accountPanel');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// ================= Toast 提示（显眼中央） =================
function toastIcon(type) {
  if (type === 'ok') return '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  if (type === 'err') return '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  if (type === 'warn') return '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>';
  return '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>';
}
function showToast(message, type, ms) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.innerHTML = '<span class="toast-ico">' + toastIcon(type) + '</span><span class="toast-text">' + esc(message) + '</span>';
  host.appendChild(t);
  while (host.children.length > 4) host.firstChild.remove();
  setTimeout(() => { t.classList.add('leave'); setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 330); }, ms || 3600);
}

function isSvip(t) { return t === 21 || t === 110; }
function vipLabel(t) {
  if (isSvip(t)) return '黑胶SVIP';
  if (t === 11) return '黑胶 VIP';
  if (t === 10) return '音乐包';
  if (t && t > 0) return 'VIP';
  return '';
}
function setLoginBtn(st) {
  const logged = !!(st && st.loggedIn);
  if (logged && st.avatar) {
    loginBtn.innerHTML = '<img class="login-av" src="' + esc(st.avatar) + '" alt="" />' + '<span id="loginText">' + esc(st.nickname || '已登录') + '</span>';
  } else {
    loginBtn.innerHTML = svgIcon('lock', 14) + '<span id="loginText">登录</span>';
  }
  loginBtn.classList.toggle('logged', logged);
  const vt = (st && st.vipType) || 0;
  loginBtn.classList.toggle('vip', vt > 0 && !isSvip(vt));
  loginBtn.classList.toggle('svip', isSvip(vt));
  loginBtn.classList.toggle('musicpkg', vt === 10);
}
function updateNetRow() {
  const av = $('apNetAv'), name = $('apNetName'), sub = $('apNetSub'), btn = $('apNetBtn');
  av.src = netLogin.avatar || 'assets/arknights/avatars/default-av.png';
  if (netLogin.loggedIn) {
    name.textContent = netLogin.nickname || '网易云音乐';
    const v = vipLabel(netLogin.vipType);
    sub.textContent = 'UID ' + (netLogin.userId || '') + (v ? ' · ' + v : '');
    btn.textContent = '退出';
    btn.classList.add('out');
  } else {
    name.textContent = '网易云音乐 · 未登录';
    sub.textContent = '';
    btn.textContent = '登录';
    btn.classList.remove('out');
  }
  const vipRow = $('apVipRow'), vipText = $('apVipText');
  const v = vipLabel(netLogin.vipType);
  vipRow.classList.toggle('svip', isSvip(netLogin.vipType));
  vipRow.classList.toggle('musicpkg', netLogin.vipType === 10);
  const vipTag = vipRow.querySelector('.ap-vip-tag');
  if (vipTag) vipTag.textContent = isSvip(netLogin.vipType) ? 'SVIP' : (netLogin.vipType === 10 ? '音乐包' : 'VIP');
  if (netLogin.loggedIn && v) { vipText.textContent = netLogin.nickname + ' · ' + v + ' 已开通'; vipRow.classList.remove('hidden'); }
  else { vipRow.classList.add('hidden'); }
  const platEl = document.querySelector('.ap-plat[data-p="netease"]');
  if (platEl) {
    platEl.classList.toggle('svip', isSvip(netLogin.vipType));
    platEl.classList.toggle('vip', netLogin.vipType > 0 && !isSvip(netLogin.vipType));
    platEl.classList.toggle('musicpkg', netLogin.vipType === 10);
  }
}
function updateQqRow() {
  const av = $('apQqAv'), name = $('apQqName'), sub = $('apQqSub'), btn = $('apQqBtn');
  av.src = qqLogin.avatar || 'assets/arknights/avatars/default-av.png';
  if (qqLogin.loggedIn) {
    name.textContent = qqLogin.nickname || 'QQ 音乐 · 已登录';
    sub.textContent = 'QQ 音乐 · 已登录' + (qqLogin.vipLabel ? ' · ' + qqLogin.vipLabel : '');
    btn.textContent = '退出';
    btn.classList.add('out');
  } else {
    name.textContent = 'QQ 音乐 · 未登录';
    sub.textContent = '';
    btn.textContent = '登录';
    btn.classList.remove('out');
  }
  const qvRow = $('apQqVipRow'), qvText = $('apQqVipText');
  if (qqLogin.loggedIn && qqLogin.vipLabel) {
    qvText.textContent = qqLogin.vipLabel + (qqLogin.vipOverdate ? ' · ' + String(qqLogin.vipOverdate).slice(0, 10) + ' 到期' : '');
    qvRow.classList.remove('hidden');
  } else { qvRow.classList.add('hidden'); }
  const platEl = document.querySelector('.ap-plat[data-p="qq"]');
  if (platEl) {
    platEl.classList.toggle('svip', qqLogin.vipLevel === 2);
    platEl.classList.toggle('vip', qqLogin.vipLevel === 1);
    platEl.classList.toggle('musicpkg', false);
  }
}
async function refreshLogin() {
  try {
    const st = await api.getLoginState();
    netLogin = st || { loggedIn: false, nickname: '', userId: 0, avatar: '', vipType: 0 };
    loginUserId = netLogin.userId || 0;
    setLoginBtn(netLogin);
    updateNetRow();
  } catch (err) {
    netLogin = { loggedIn: false, nickname: '', userId: 0, avatar: '', vipType: 0 };
    setLoginBtn(netLogin);
    updateNetRow();
  }
}
async function refreshQqLogin() {
  try {
    qqLogin = (await api.qqLoginState()) || { loggedIn: false, nickname: '', userId: 0, avatar: '', vipType: 0, vipLevel: 0, vipLabel: '', vipOverdate: '', vipIcon: '' };
  } catch (err) {
    qqLogin = { loggedIn: false, nickname: '', userId: 0, avatar: '', vipType: 0, vipLevel: 0, vipLabel: '', vipOverdate: '', vipIcon: '' };
  }
  updateQqRow();
}
let accHideTimer = null;
function showAccountPanel() { clearTimeout(accHideTimer); accountPanel.classList.remove('hidden'); }
function hideAccountPanelSoon() { clearTimeout(accHideTimer); accHideTimer = setTimeout(() => accountPanel.classList.add('hidden'), 220); }
// ================= 内嵌登录面板 =================
const loginPanelEl = $('loginPanel');
const loginFrameEl = $('loginFrame');
const QQ_LOGIN_EMBED_URL = 'https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=100497308&redirect_uri=' + encodeURIComponent('https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/') + '&state=state&display=pc&scope=get_user_info,get_app_friends';
let loginEmbedPlatform = null;
function openLoginEmbed(platform) {
  loginEmbedPlatform = platform;
  const qq = platform === 'qq';
  $('loginPanelTitle').textContent = qq ? 'QQ\u97f3\u4e50\u767b\u5f55' : '\u7f51\u6613\u4e91\u767b\u5f55';
  const qrBox = $('ncmQrBox'), frame = $('loginFrame');
  if (qq) {
    // \u5185\u5d4c WebContentsView \u65b9\u6848\uff1a\u9690\u85cf\u9762\u677f\uff0c\u663e\u793a\u9876\u90e8\u5173\u95ed\u6761
    stopNcmQr();
    qrBox.classList.add('hidden');
    frame.classList.add('hidden');
    frame.src = 'about:blank';
    loginPanelEl.classList.add('hidden');
    $('qqEmbedClose').classList.remove('hidden');
    if (api.qqEmbedOpen) api.qqEmbedOpen();
  } else {
    frame.classList.add('hidden');
    frame.src = 'about:blank';
    qrBox.classList.remove('hidden');
    startNcmQr();
    loginPanelEl.classList.remove('hidden');
  }
}

let ncmQrUnikey = null;
let ncmQrTimer = null;
async function startNcmQr() {
  stopNcmQr();
  $('ncmQrRefresh').classList.add('hidden');
  const mask = $('ncmQrMask');
  const status = $('ncmQrStatus');
  mask.classList.remove('hidden');
  $('ncmQrMaskText').textContent = '\u6b63\u5728\u751f\u6210\u4e8c\u7ef4\u7801\u2026';
  status.textContent = '';
  try {
    const r = await api.ncmQrStart();
    if (!r || !r.ok) {
      status.textContent = (r && r.error) || '\u4e8c\u7ef4\u7801\u751f\u6210\u5931\u8d25';
      return;
    }
    ncmQrUnikey = r.unikey;
    $('ncmQrImg').src = r.qrDataUrl;
    mask.classList.add('hidden');
    status.textContent = '\u8bf7\u4f7f\u7528\u7f51\u6613\u4e91\u97f3\u4e50 App \u626b\u7801';
    ncmQrTimer = setInterval(pollNcmQr, 2000);
  } catch (err) {
    status.textContent = '\u4e8c\u7ef4\u7801\u751f\u6210\u5931\u8d25\uff1a' + String(err && err.message || err);
  }
}
async function pollNcmQr() {
  if (!ncmQrUnikey) return;
  try {
    const r = await api.ncmQrCheck(ncmQrUnikey);
    if (!r) return;
    const status = $('ncmQrStatus');
    if (r.code === 803) {
      stopNcmQr();
      if (r.loggedIn) {
        closeLoginEmbed();
        refreshLogin();
      } else {
        status.textContent = '\u5df2\u6388\u6743\u4f46\u672a\u80fd\u83b7\u53d6\u767b\u5f55\u6001\uff0c\u8bf7\u91cd\u8bd5';
        $('ncmQrRefresh').classList.remove('hidden');
      }
    }
    else if (r.code === 802) { status.textContent = '\u5df2\u626b\u7801\uff0c\u8bf7\u5728\u624b\u673a\u4e0a\u786e\u8ba4\u767b\u5f55'; }
    else if (r.code === 801) { status.textContent = '\u8bf7\u4f7f\u7528\u7f51\u6613\u4e91\u97f3\u4e50 App \u626b\u7801'; }
    else if (r.code === 800) {
      stopNcmQr();
      status.textContent = '\u4e8c\u7ef4\u7801\u5df2\u8fc7\u671f\uff0c\u8bf7\u5237\u65b0';
      $('ncmQrRefresh').classList.remove('hidden');
    }
  } catch (err) { /* \u5ffd\u7565\u5355\u6b21\u8f6e\u8be2\u9519\u8bef */ }
}
function stopNcmQr() {
  if (ncmQrTimer) { clearInterval(ncmQrTimer); ncmQrTimer = null; }
  ncmQrUnikey = null;
}

function closeLoginEmbed() {
  if (!loginPanelEl) return;
  loginPanelEl.classList.add('hidden');
  stopNcmQr();
  $('qqEmbedClose').classList.add('hidden');
  if (loginEmbedPlatform === 'qq' && api.qqEmbedClose) api.qqEmbedClose();
  else if (loginEmbedPlatform && api.loginEmbedStop) api.loginEmbedStop(loginEmbedPlatform);
  loginEmbedPlatform = null;
  setTimeout(() => { if (loginPanelEl.classList.contains('hidden')) loginFrameEl.src = 'about:blank'; }, 300);
}
$('loginPanelClose').addEventListener('click', closeLoginEmbed);
$('qqEmbedClose').addEventListener('click', () => { closeLoginEmbed(); });
api.onQqEmbedClosed(() => { $('qqEmbedClose').classList.add('hidden'); });
$('ncmQrRefresh').addEventListener('click', () => { startNcmQr(); });
$('loginPanelWindow').addEventListener('click', () => {
  const qq = loginEmbedPlatform === 'qq';
  closeLoginEmbed();
  if (qq) api.qqOpenLogin(); else api.openLogin();
});
loginBtn.addEventListener('mouseenter', showAccountPanel);
loginBtn.addEventListener('click', async () => {
  showAccountPanel();
  if (netLogin.loggedIn) {
    if (confirm('已登录：' + netLogin.nickname + '\n点击「确定」退出登录？')) {
      await api.logout();
      loginUserId = 0;
      await refreshLogin();
      if (homeLoaded) loadHome();
    }
  } else {
    openLoginEmbed('netease');
  }
});
const loginWrapEl = document.querySelector('.login-wrap');
loginWrapEl.addEventListener('mouseleave', hideAccountPanelSoon);
accountPanel.addEventListener('mouseenter', () => clearTimeout(accHideTimer));
accountPanel.addEventListener('mouseleave', hideAccountPanelSoon);
$('apNetBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (netLogin.loggedIn) {
    await api.logout();
    loginUserId = 0;
    await refreshLogin();
    if (homeLoaded) loadHome();
  } else {
    openLoginEmbed('netease');
  }
});
$('apQqBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (qqLogin.loggedIn) {
    await api.qqLogout();
    await refreshQqLogin();
  } else {
    openLoginEmbed('qq');
  }
});
api.onLoginSuccess((nickname, uid) => {
  closeLoginEmbed();
  loginUserId = uid || 0;
  refreshLogin();
  stageStatus.textContent = '已登录：' + nickname + '，VIP 歌曲可直接播放';
  statusLine.textContent = '已登录：' + nickname;
  if (homeLoaded) loadHome();
});
api.onQqLoginSuccess((nickname) => {
  closeLoginEmbed();
  refreshQqLogin();
  statusLine.textContent = 'QQ 音乐已登录：' + nickname;
  if (activePlatform === 'qq' && homeLoaded) loadHome();
});

// ================= 无边框窗口控制 =================
$('winMinBtn').addEventListener('click', () => { if (api.winMin) api.winMin(); });
$('winMaxBtn').addEventListener('click', () => { if (api.winMax) api.winMax(); });
$('winCloseBtn').addEventListener('click', () => { if (api.winClose) api.winClose(); });
if (api.onMaximized) {
  api.onMaximized((isMax) => {
    const btn = $('winMaxBtn');
    if (isMax) btn.classList.add('maximized');
    else btn.classList.remove('maximized');
  });
}

// ================= Folia 可视化背景系统 =================
const BG_DEFAULTS = { mode: 'roam', beat: true, readability: true, arkArt: 0, btnStyle: 'mostma2', gifFx: true, wall: 'stardust', wallLevel: 1 };
let bgSettings = { ...BG_DEFAULTS };
try { bgSettings = Object.assign({}, BG_DEFAULTS, JSON.parse(localStorage.getItem('qin-bg-settings') || '{}')); } catch (err) { /* 忽略 */ }
const bgToggleEl = $('bgToggle');
bgToggleEl.classList.add('visible'); // 右上角工具常驻显示
const aiToggleEl0 = $('aiToggle');
if (aiToggleEl0) aiToggleEl0.classList.add('visible');

function saveBgSettings() { localStorage.setItem('qin-bg-settings', JSON.stringify(bgSettings)); }

function syncCoverOpacity() {
  if (!stageCoverBg) return;
  stageCoverBg.style.opacity = (bgSettings.mode === 'fade' && stageCoverBg.classList.contains('has-cover')) ? '0.85' : '0';
}


function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function weMediaUrl(it, kind) {
  const f = kind === 'video' ? it.video : (kind === 'image' ? (it.image || it.preview) : it.preview);
  if (!f) return '';
  const host = it.src === 'local' ? 'local-' + encodeURIComponent(it.id) : encodeURIComponent(it.id);
  return 'wallpaper://' + host + '/' + encodeURIComponent(f);
}
function ensureWallpaperLayer() {
  if (!wallpaperLayer) {
    wallpaperLayer = new WallpaperLayer();
    wallpaperLayer.setLevel(bgSettings.wallLevel != null ? bgSettings.wallLevel : 1);
    wallpaperLayer.setBeat(bgSettings.beat !== false);
    applyWallpaperSelection();
  }
  return wallpaperLayer;
}
function applyWallpaperSelection() {
  if (!wallpaperLayer) return;
  const wall = String(bgSettings.wall || 'stardust');
  if (wall.indexOf('we') === 0) {
    const isLocal = wall.indexOf('we-l:') === 0;
    const id = wall.slice(isLocal ? 5 : 3);
    const it = weWallpapers.find((w) => (w.src === 'local') === isLocal && String(w.id) === id);
    wallpaperLayer.setType('we');
    if (it) wallpaperLayer.setWeItem(it);
  } else {
    wallpaperLayer.setType(wall);
  }
}
function updateWallpaperSegUI() {
  const wall = String(bgSettings.wall || 'stardust');
  document.querySelectorAll('#wallpaperSeg button').forEach((b) => {
    const on = b.dataset.wall === 'we' ? wall.indexOf('we') === 0 : wall === b.dataset.wall;
    b.classList.toggle('active', on);
  });
}
async function loadWeWallpapers() {
  const grid = $('weWallpaperGrid');
  if (!grid) return;
  if (!window.api || typeof window.api.listWallpapers !== 'function') {
    grid.innerHTML = '<div class="we-wall-empty">不可用</div>';
    return;
  }
  grid.innerHTML = '<div class="we-wall-empty">加载中…</div>';
  try {
    const res = await window.api.listWallpapers();
    if (!res || !res.ok) {
      grid.innerHTML = '<div class="we-wall-empty">' + ((res && res.error) || '未找到壁纸库') + '</div>';
      return;
    }
    weWallpapers = res.list || [];
    if (!weWallpapers.length) { grid.innerHTML = '<div class="we-wall-empty">壁纸库为空</div>'; return; }
    grid.innerHTML = '';
    const cur = String(bgSettings.wall || '');
    weWallpapers.forEach((it) => {
      const key = (it.src === 'local' ? 'we-l:' : 'we:') + it.id;
      const btn = document.createElement('button');
      btn.className = 'we-wall-item' + (cur === key ? ' active' : '');
      btn.dataset.key = key;
      const badge = (it.src === 'local' ? 'L?' : '') + (it.video ? 'V' : (it.image ? 'IMG' : 'SCN'));
      btn.innerHTML = '<img src="' + weMediaUrl(it, 'preview') + '" loading="lazy" alt=""/>' +
        '<span class="we-wall-badge">' + badge + '</span>' +
        '<span class="we-wall-name">' + escHtml(it.title || it.id) + '</span>';
      btn.addEventListener('click', () => {
        bgSettings.wall = key;
        saveBgSettings();
        if (bgSettings.mode !== 'wallpaper') { bgSettings.mode = 'wallpaper'; applyBgSettings(); }
        else { applyWallpaperSelection(); updateWallpaperSegUI(); }
        document.querySelectorAll('#weWallpaperGrid .we-wall-item').forEach((x) => x.classList.toggle('active', x.dataset.key === key));
      });
      grid.appendChild(btn);
    });
  } catch (e) {
    grid.innerHTML = '<div class="we-wall-empty">加载失败</div>';
  }
}
async function followWeWallpaper() {
  const btn = $('weWallFollow');
  if (!window.api || typeof window.api.weActiveWallpaper !== 'function') {
    if (btn) btn.textContent = '不可用';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '正在读取…'; }
  try {
    const res = await window.api.weActiveWallpaper();
    if (!res || !res.ok) { showToast((res && res.error) || '无法读取壁纸引擎当前壁纸'); return; }
    const cur = res.current;
    let it = null;
    if (cur.src === 'workshop' || cur.src === 'local') {
      it = weWallpapers.find((w) => (w.src === 'local') === (cur.src === 'local') && String(w.id) === cur.id);
      if (!it) {
        const isVideo = /\.(mp4|webm|mov)$/i.test(cur.file || '');
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(cur.file || '');
        it = {
          src: cur.src, id: cur.id, title: cur.src === 'local' ? '[WE] ' + cur.id : cur.id, type: '',
          video: isVideo ? cur.file : '', image: isImg ? cur.file : '',
          preview: isImg ? cur.file : 'preview.jpg'
        };
        weWallpapers.push(it);
        loadWeWallpapers();
      }
    } else if (cur.src === 'file' && cur.full) {
      const isVideo = /\.(mp4|webm|mov)$/i.test(cur.file || '');
      it = {
        src: 'file', id: 'external', title: cur.file || '外部壁纸', type: '',
        video: isVideo ? cur.file : '', image: isVideo ? '' : cur.file,
        preview: cur.file, full: cur.full
      };
      weWallpapers.unshift(it);
      loadWeWallpapers();
    }
    if (!it) { showToast('无法识别当前壁纸'); return; }
    bgSettings.wall = (it.src === 'local' ? 'we-l:' : 'we:') + it.id;
    saveBgSettings();
    if (bgSettings.mode !== 'wallpaper') { bgSettings.mode = 'wallpaper'; applyBgSettings(); }
    else applyWallpaperSelection();
    updateWallpaperSegUI();
    document.querySelectorAll('#weWallpaperGrid .we-wall-item').forEach((x) => x.classList.toggle('active', x.dataset.key === bgSettings.wall));
    showToast('已跟随壁纸引擎：' + (it.title || it.id));
  } catch (e) {
    showToast('跟随壁纸失败');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '跟随当前'; }
  }
}
function initWallpaperControls() {
  document.querySelectorAll('#wallpaperSeg button').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.wall === 'we') {
        const cur = String(bgSettings.wall || '');
        if (cur.indexOf('we') !== 0 && weWallpapers.length) {
          bgSettings.wall = (weWallpapers[0].src === 'local' ? 'we-l:' : 'we:') + weWallpapers[0].id;
          saveBgSettings();
          if (bgSettings.mode !== 'wallpaper') { bgSettings.mode = 'wallpaper'; applyBgSettings(); }
          else applyWallpaperSelection();
        }
        updateWallpaperSegUI();
        return;
      }
      bgSettings.wall = b.dataset.wall;
      saveBgSettings();
      if (bgSettings.mode !== 'wallpaper') { bgSettings.mode = 'wallpaper'; applyBgSettings(); }
      else applyWallpaperSelection();
      updateWallpaperSegUI();
    });
  });
  const lv = $('wallpaperLevel');
  if (lv) lv.addEventListener('input', () => {
    const v = Number(lv.value);
    bgSettings.wallLevel = v;
    saveBgSettings();
    if (wallpaperLayer) wallpaperLayer.setLevel(v);
    const vEl = $('wallpaperLevelV');
    if (vEl) vEl.textContent = v.toFixed(2);
  });
  const rf = $('weWallRefresh');
  if (rf) rf.addEventListener('click', () => loadWeWallpapers());
  const fb = $('weWallFollow');
  if (fb) fb.addEventListener('click', () => followWeWallpaper());
  loadWeWallpapers();
}

function applyBgSettings() {
  const stage = $('stageView');
  stage.classList.toggle('bg-roam', bgSettings.mode === 'roam');
  stage.classList.toggle('bg-fade', bgSettings.mode === 'fade');
  stage.classList.toggle('bg-static', bgSettings.mode === 'static');
  stage.classList.toggle('bg-arknights', bgSettings.mode === 'arknights');
  stage.classList.toggle('bg-wallpaper', bgSettings.mode === 'wallpaper');
  stage.classList.toggle('no-beat', !bgSettings.beat);
  $('lyricReadability').classList.toggle('on', bgSettings.readability);
  syncCoverOpacity();
  document.querySelectorAll('#bgModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.bg === bgSettings.mode));
  $('bgArknightsRow').style.display = bgSettings.mode === 'arknights' ? '' : 'none';
  $('bgWallpaperRow').style.display = bgSettings.mode === 'wallpaper' ? '' : 'none';
  if (bgSettings.mode === 'wallpaper') {
    const wl = ensureWallpaperLayer();
    wl.setActive(true);
    wl.setBeat(bgSettings.beat !== false);
    wl.setLevel(bgSettings.wallLevel != null ? bgSettings.wallLevel : 1);
    applyWallpaperSelection();
  } else if (wallpaperLayer) {
    wallpaperLayer.setActive(false);
  }
  $('bgBeatBtn').classList.toggle('on', bgSettings.beat);
  $('bgReadBtn').classList.toggle('on', bgSettings.readability);
  if ($('gifFxSw')) $('gifFxSw').classList.toggle('on', bgSettings.gifFx !== false);
  gifFxOn = bgSettings.gifFx !== false;
  if (gifFxLayerEl) gifFxLayerEl.classList.toggle('hidden', !gifFxOn);
  if (bgSettings.mode === 'arknights') {
    applyArkBg();
  }
  // 角色印象色最后生效（覆盖方舟背景/封面色），切回默认则恢复封面取色
  applyBtnStyle();
}

// 明日方舟主题：官方素材背景 + 泰拉深蓝/金 主题色
// 明日方舟官方主视觉（音律联觉 KV，16:9 官方美术，非视频封面）
const ARK_BGS = [
  'bg-kv-mengren.jpg',      // 梦人
  'bg-kv-shixu.jpg',        // 时序花圃
  'bg-kv-guiguan.jpg',      // 移星桂冠
  'bg-kv-yuye.jpg',         // 愚夜密函
  'bg-kv-bingwen.jpg',      // 冰纹玉釉
  'bg-kv-supernova.jpg',    // FIVE超新星
  'bg-kv-xingzhe.jpg',      // 行者
  'bg-kv-yijun.jpg',        // 遗君
  'bg-kv-fusheng.jpg'       // 浮生听风
];
function applyArkBg() {
  const idx = Number(bgSettings.arkArt) || 0;
  const art = ARK_BGS[idx] || ARK_BGS[0];
  const el = $('arkBg');
  if (el) el.style.backgroundImage = 'url("assets/arknights/bg/' + art + '")';
  baseHue = 218;
  applyMood();
  const rst = document.documentElement.style;
  rst.setProperty('--c1h', '218');
  rst.setProperty('--c2h', '42');
  rst.setProperty('--c3h', '232');
  document.querySelectorAll('#bgArtSeg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.art) === idx));
}

// 干员按钮风格：不做背景立绘，改为小按钮 UI 风格（默认莫斯提马），可在设置中自选或关闭
const BTN_STYLE_MAP = {
  mostma2: 'assets/arknights/icons/mostma-av-2.png',
  'mostma-skin2': 'assets/arknights/icons/mostma-av-skin2.png',
  exu: 'assets/arknights/icons/exu-av-2.png',
  'exu-skin2': 'assets/arknights/icons/exu-av-skin2.png'
};
// 角色印象色：选择角色风格时接管全局色相（代替原主题色功能）
const CHAR_THEME = {
  mostma2: { h: 45, h2: 210, h3: 262 },
  'mostma-skin2': { h: 205, h2: 240, h3: 268 },
  exu: { h: 355, h2: 332, h3: 215 },
  'exu-skin2': { h: 35, h2: 355, h3: 215 }
};
let prevBtnStyle = '';
function applyBtnStyle() {
  const key = bgSettings.btnStyle;
  const av = BTN_STYLE_MAP[key] || '';
  document.body.dataset.btnStyle = key;
  const themeAv = $('arkThemeAv');
  const heroDiscAv = $('heroDiscAv');
  if (heroDiscAv) heroDiscAv.src = av || 'assets/arknights/icons/mostma-av-2.png';
  if (themeAv) themeAv.src = av || 'assets/arknights/logo-rhodes.png';
  document.querySelectorAll('#bgStyleSeg button').forEach((b) => b.classList.toggle('active', b.dataset.style === key));
  const pal = CHAR_THEME[key];
  if (pal) {
    baseHue = pal.h;
    applyMood();
    const rst = document.documentElement.style;
    rst.setProperty('--c1h', String(pal.h));
    rst.setProperty('--c2h', String(pal.h2));
    rst.setProperty('--c3h', String(pal.h3));
    rst.setProperty('--disc-c1', hslToHex(pal.h, 85, 72));
    rst.setProperty('--disc-c2', hslToHex(pal.h2, 80, 70));
    rst.setProperty('--disc-c3', hslToHex(pal.h3, 75, 74));
  }
  const srt = (typeof sonnetRt !== 'undefined' && sonnetRt) ? sonnetRt : null;
  if (srt && srt.options && srt.options.theme) {
    const rp = rolePaletteHex();
    if (rp) {
      srt.options.theme.primaryColor = rp.c1;
      srt.options.theme.accentColor = rp.c2;
      srt.options.theme.secondaryColor = mixHex(rp.c1, rp.c2, 0.55);
    }
  } else if (!pal && prevBtnStyle && CHAR_THEME[prevBtnStyle] && bgSettings.mode !== 'arknights') {
    // 从角色切回默认：回到封面取色（有缓存封面则重新提取）
    const rst = document.documentElement.style;
    rst.setProperty('--c1h', '200');
    rst.setProperty('--c2h', '270');
    rst.setProperty('--c3h', '360');
    const c = window.__coverDataCache;
    if (c && c.data) {
      const img = new Image();
      img.src = c.data;
      img.decode().then(() => extractHue(img)).catch(() => {});
    }
  }
  prevBtnStyle = key;
  syncAcidBanner();
}


// 酸橙标题配色：根据角色印象色（--c1h）旋转 title-acid.png（原色相 210）的色相
function syncAcidBanner() {
  try {
    const rst = document.documentElement.style;
    const raw = rst.getPropertyValue('--c1h') || getComputedStyle(document.documentElement).getPropertyValue('--c1h');
    const c1 = parseFloat(raw) || 200;
    const rot = ((c1 - 210) % 360 + 360) % 360;
    document.documentElement.style.setProperty('--acid-rotate', rot.toFixed(1) + 'deg');
  } catch (err) { /* 忽略 */ }
}
function toggleBgPanel(show) {
  const panel = $('bgPanel');
  const next = show === undefined ? panel.classList.contains('hidden') : show;
  panel.classList.toggle('hidden', !next);
}

bgToggleEl.addEventListener('click', () => toggleBgPanel());
const topSettingsBtn = document.getElementById('topSettingsBtn');
if (topSettingsBtn) topSettingsBtn.addEventListener('click', () => toggleBgPanel());
$('bgPanelClose').addEventListener('click', () => toggleBgPanel(false));
// 设置面板分栏（特效 / 背景 / 更多）
document.querySelectorAll('.bg-tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.bg-tab').forEach((x) => x.classList.toggle('active', x === t));
    const page = t.dataset.tab;
    document.querySelectorAll('.bg-tab-page').forEach((pg) => pg.classList.toggle('hidden', pg.dataset.page !== page));
  });
});
// ================= AI \u52a9\u624b\uff08\u7528\u6237\u81ea\u5b9a\u4e49 OpenAI \u517c\u5bb9\u63a5\u53e3\uff09 =================
const AI_CFG_KEY = 'qin-ai-config';
function loadAiConfig() {
  try { return JSON.parse(localStorage.getItem(AI_CFG_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveAiConfig(cfg) { localStorage.setItem(AI_CFG_KEY, JSON.stringify(cfg || {})); }
function fillAiFields() {
  const cfg = loadAiConfig();
  $('aiBaseInput').value = cfg.base || 'https://api.deepseek.com';
  $('aiKeyInput').value = cfg.key || '';
  $('aiModelInput').value = cfg.model || '';
  $('aiEnableBtn').classList.toggle('on', cfg.enabled !== false);
}
function fillAiModelList(models) {
  const dl = document.getElementById('aiModelList');
  if (!dl) return;
  dl.innerHTML = '';
  (Array.isArray(models) ? models : []).forEach((m) => {
    const op = document.createElement('option');
    op.value = m;
    dl.appendChild(op);
  });
}
document.querySelectorAll('.ai-preset').forEach((b) => {
  b.addEventListener('click', () => {
    $('aiBaseInput').value = b.dataset.base || '';
    if (b.dataset.model !== undefined && b.dataset.model) $('aiModelInput').value = b.dataset.model;
    if (b.dataset.base === 'http://127.0.0.1:11434/v1') $('aiModelInput').value = 'llama3.2';
    if (!b.dataset.model && b.dataset.base && b.dataset.base.indexOf('api.deepseek.com') >= 0 && !$('aiModelInput').value) $('aiModelInput').value = 'deepseek-chat';
    aiTestResult('info', '已填入快速配置，请填写 API Key 后测试');
  });
});
function aiTestResult(ok, text, extra) {
  const el = $('aiTestResult');
  el.classList.remove('hidden', 'ok', 'fail');
  el.classList.add(ok ? 'ok' : 'fail');
  el.textContent = text + (extra ? ' \u00b7 ' + extra : '');
}
$('aiTestBtn').addEventListener('click', async () => {
  const cfg = { base: $('aiBaseInput').value.trim(), key: $('aiKeyInput').value.trim(), model: $('aiModelInput').value.trim() };
  if (!cfg.base) { aiTestResult(false, '\u8bf7\u5148\u586b\u5199\u63a5\u53e3\u5730\u5740'); return; }
  $('aiTestBtn').disabled = true;
  $('aiTestBtn').textContent = '\u6d4b\u8bd5\u4e2d\u2026';
  try {
    const r = await api.aiTest(cfg);
        if (r && r.ok) {
      if (Array.isArray(r.models) && r.models.length) fillAiModelList(r.models);
      if (r.mode === 'models' && r.model && !cfg.model) $('aiModelInput').value = r.model;
      aiTestResult(true, '\u8fde\u63a5\u6210\u529f (' + (r.ms || '') + 'ms)', (r.mode === 'models' && r.model ? '\u6a21\u578b: ' + r.model : ''));
    }
    else aiTestResult(false, '\u8fde\u63a5\u5931\u8d25', r && r.error ? String(r.error).slice(0, 120) : '');
  } catch (err) {
    aiTestResult(false, '\u8fde\u63a5\u5931\u8d25', String(err && err.message || err).slice(0, 120));
  } finally {
    $('aiTestBtn').disabled = false;
    $('aiTestBtn').textContent = '\u6d4b\u8bd5\u8fde\u901a';
  }
});
$('aiSaveBtn').addEventListener('click', () => {
  const cfg = loadAiConfig();
  cfg.base = $('aiBaseInput').value.trim();
  cfg.key = $('aiKeyInput').value.trim();
  cfg.model = $('aiModelInput').value.trim();
  saveAiConfig(cfg);
  aiTestResult(true, '\u914d\u7f6e\u5df2\u4fdd\u5b58');
});
$('aiKeyToggle').addEventListener('click', () => {
  const inp = $('aiKeyInput');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('aiKeyToggle').textContent = show ? '\u9690\u85cf' : '\u663e\u793a';
});
$('aiEnableBtn').addEventListener('click', () => {
  const on = !$('aiEnableBtn').classList.contains('on');
  $('aiEnableBtn').classList.toggle('on', on);
  const cfg = loadAiConfig();
  cfg.enabled = on;
  saveAiConfig(cfg);
});

// —— AI 助手面板 ——
const aiToggleEl = $('aiToggle');
const aiPanelEl = $('aiPanel');
const aiMessagesEl = $('aiMessages');
let aiContext = null;
let aiHistory = [];
function toggleAiPanel(show) {
  const next = show === undefined ? aiPanelEl.classList.contains('hidden') : show;
  aiPanelEl.classList.toggle('hidden', !next);
  if (next) { const inp = $('aiInput'); if (inp) setTimeout(function () { inp.focus(); }, 60); }
}
aiToggleEl.addEventListener('click', () => toggleAiPanel());
const heroAiBtn = $('heroAiBtn');
if (heroAiBtn) heroAiBtn.addEventListener('click', () => toggleAiPanel());
$('aiPanelClose').addEventListener('click', () => toggleAiPanel(false));
function addAiMsg(role, text) {
  const row = document.createElement('div');
  row.className = 'ai-msg ' + role;
  const b = document.createElement('div');
  b.className = 'ai-msg-bubble';
  b.textContent = text;
  row.appendChild(b);
  aiMessagesEl.appendChild(row);
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
  return b;
}
async function loadAiContext() {
  if (aiContext) return aiContext;
  addAiMsg('system', '\u6b63\u5728\u8bfb\u53d6\u97f3\u4e50\u6570\u636e\uff08\u6211\u7684\u559c\u6b22 / \u70ed\u66f2\u6392\u884c / \u6bcf\u65e5\u63a8\u8350\uff09\u2026');
  try {
    aiContext = await Promise.race([
      api.aiMusicContext(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ai context timeout')), 40000))
    ]);
    return aiContext;
  } catch (err) {
    aiContext = { error: String(err && err.message || err) };
    return aiContext;
  }
}
function fmtSongList(label, list, n) {
  if (!list || !list.length) return label + '\uff1a\u65e0\u6570\u636e';
  return label + '\uff1a' + list.slice(0, n || 15).map((x) => x.name + ' - ' + (x.artist || '')).join('\u3001');
}
async function askAi(prompt) {
  const cfg = loadAiConfig();
  if (!cfg.base) { addAiMsg('system', '\u5c1a\u672a\u914d\u7f6e AI \u63a5\u53e3\uff0c\u8bf7\u5728\u821e\u53f0\u8bbe\u7f6e \u2192 AI \u4e2d\u586b\u5199\u5730\u5740\u4e0e Key\u3002'); return; }
  if (cfg.enabled === false) { addAiMsg('system', 'AI \u52a9\u624b\u5df2\u505c\u7528\u3002'); return; }
  addAiMsg('user', prompt);
  const ctx = await loadAiContext();
  let sys = '\u4f60\u662f YuMusic \u97f3\u4e50\u64ad\u653e\u5668\u7684 AI \u52a9\u624b\u3002';
  if (ctx && !ctx.error) {
    const parts = [];
    if (ctx.liked && ctx.liked.songs && ctx.liked.songs.length) {
      parts.push(fmtSongList('\u767b\u5f55\u8d26\u53f7\u300c\u6211\u7684\u559c\u6b22\u300d\u6b4c\u66f2', ctx.liked.songs, 40) + (ctx.liked.count ? '\uff08\u5171 ' + ctx.liked.count + ' \u9996\uff09' : ''));
    }
    if (ctx.hot && ctx.hot.length) {
      parts.push(ctx.hot.map((c) => fmtSongList(c.name, c.songs, 10)).join('\uff1b'));
    }
    if (ctx.daily && ctx.daily.length) {
      parts.push(fmtSongList('\u6bcf\u65e5\u63a8\u8350', ctx.daily, 20));
    }
    sys += '\n\u4ee5\u4e0b\u4e3a\u5f53\u524d\u8d26\u53f7\u53ef\u7528\u7684\u97f3\u4e50\u4e0a\u4e0b\u6587\uff1a\n' + parts.join('\n');
    sys += '\n\u8bf7\u57fa\u4e8e\u8fd9\u4e9b\u6b4c\u66f2\uff0c\u7528\u4e2d\u6587\u7ed9\u51fa\u7b80\u6d01\u3001\u6709\u5efa\u8bbe\u6027\u7684\u56de\u7b54\uff1b\u5982\u9700\u63a8\u8350\u6b4c\u66f2\uff0c\u76f4\u63a5\u5217\u51fa\u300c\u6b4c\u540d - \u6b4c\u624b\u300d\u3002';
  } else {
    sys += '\u5f53\u524d\u672a\u767b\u5f55\u6216\u97f3\u4e50\u6570\u636e\u4e0d\u53ef\u7528\uff0c\u8bf7\u57fa\u4e8e\u5e38\u8bc6\u56de\u7b54\u3002';
  }
  const messages = [
    { role: 'system', content: sys },
    ...(aiHistory || []),
    { role: 'user', content: prompt }
  ];
  aiHistory = messages.slice(-20);
  const bubble = addAiMsg('ai', '\u2026');
  try {
    const r = await api.aiChat({ base: cfg.base, key: cfg.key, model: cfg.model }, messages);
    const reply = (r && r.ok) ? (r.content || '') : '';
    bubble.textContent = reply || ((r && r.ok) ? '(\u7a7a\u56de\u590d)' : ('\u8bf7\u6c42\u5931\u8d25\uff1a' + ((r && r.error) || '\u672a\u77e5\u9519\u8bef')));
    if (reply) maybeOfferAiPlaylist(bubble, reply);
  } catch (err) {
    bubble.textContent = '\u8bf7\u6c42\u5931\u8d25\uff1a' + String(err && err.message || err);
  }
}
document.querySelectorAll('.ai-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const t = chip.dataset.ctx;
    if (t === 'liked') askAi('\u8bf7\u6839\u636e\u6211\u300c\u6211\u7684\u559c\u6b22\u300d\u91cc\u7684\u6b4c\u66f2\uff0c\u4e3a\u6211\u63a8\u8350 10 \u9996\u76f8\u4f3c\u98ce\u683c\u7684\u597d\u6b4c\uff08\u683c\u5f0f\uff1a\u6b4c\u540d - \u6b4c\u624b\uff09\u3002');
    else if (t === 'hot') askAi('\u8bf7\u4ece\u5f53\u524d\u70ed\u66f2\u6392\u884c\u4e2d\u6311\u51fa\u6700\u9002\u5408\u6211\u7684 8 \u9996\uff0c\u5e76\u7b80\u5355\u8bf4\u660e\u7406\u7531\uff08\u683c\u5f0f\uff1a\u6b4c\u540d - \u6b4c\u624b\uff09\u3002');
    else if (t === 'daily') askAi('\u8bf7\u4ece\u4eca\u65e5\u63a8\u8350\u4e2d\u7cbe\u9009 8 \u9996\u6211\u6700\u53ef\u80fd\u559c\u6b22\u7684\u6b4c\uff0c\u5e76\u8bf4\u660e\u63a8\u8350\u7406\u7531\uff08\u683c\u5f0f\uff1a\u6b4c\u540d - \u6b4c\u624b\uff09\u3002');
    else if (t === 'playlist') askAi('请结合我的喜欢与每日推荐，生成一份 12 首的专属歌单（按场景或情绪分组，格式：歌名 - 歌手）。');
    else if (t === 'explain') { const cs = (typeof currentSong !== 'undefined' && currentSong && currentSong.name) ? (currentSong.name + (currentSong.artist ? ' - ' + currentSong.artist : '')) : '当前正在播放的歌'; askAi('请解读这首歌：' + cs + '。分析主题、情绪、编曲亮点，并给出适合推荐的场景。'); }
    else if (t === 'mood') askAi('请为「深夜独处 / 雨天通勤 / 专注学习 / 运动燃脂」任一场景推荐 8 首歌（可让我指定），并说明理由（格式：歌名 - 歌手）。');
    else if (t === 'know') askAi('请分享 3 个有趣且冷门的音乐小知识，最好与我的喜欢歌单里的歌手或年代相关。');
  });
});
// ===== 软件内自动更新 =====
const updateBarEl = document.getElementById('updateBar');
let manualUpdateCheck = false; // 手动点击「检查更新」后的反馈标记
function applyUpdateState(us) {
  if (!updateBarEl) return;
  const verEl = document.getElementById('updateVer');
  const infoEl = document.getElementById('updateInfo');
  const btn = document.getElementById('updateBtn');
  const setResult = (t) => { const rr = document.getElementById('updateCheckResult'); if (rr) rr.textContent = t; };
  if (us && us.available && !us.downloading && !us.downloaded) {
    updateBarEl.classList.remove('hidden');
    if (verEl) verEl.textContent = us.version ? ('v' + us.version) : '新版本';
    if (infoEl) infoEl.textContent = '发现新版本，点击下载更新';
    if (manualUpdateCheck) { manualUpdateCheck = false; showToast('发现新版本 v' + (us.version || '') + '，可在右上角更新条下载', 'ok'); }
    if (btn) { btn.disabled = false; btn.textContent = '下载更新'; btn.dataset.act = 'download'; }
    setResult('发现新版本 v' + (us.version || ''));
  } else if (us && us.downloading) {
    updateBarEl.classList.remove('hidden');
    if (infoEl) infoEl.textContent = '正在下载更新… ' + (us.percent != null ? us.percent + '%' : '');
    if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
    setResult('正在下载更新… ' + (us.percent != null ? us.percent + '%' : ''));
  } else if (us && us.downloaded) {
    updateBarEl.classList.remove('hidden');
    if (verEl) verEl.textContent = us.version ? ('v' + us.version) : '新版本';
    if (infoEl) infoEl.textContent = '更新已就绪，重启后生效';
    if (btn) { btn.disabled = false; btn.textContent = '立即重启更新'; btn.dataset.act = 'install'; }
    setResult('更新已就绪，重启后生效');
  } else if (us && us.error) {
    updateBarEl.classList.add('hidden');
    if (manualUpdateCheck) { manualUpdateCheck = false; showToast('检查更新失败：' + us.error, 'err'); }
    setResult('检查更新失败：' + String(us.error || '未知错误'));
  } else {
    updateBarEl.classList.add('hidden');
    if (us && us.checking) {
      if (manualUpdateCheck) setResult('正在检查更新…');
    } else if (manualUpdateCheck) {
      manualUpdateCheck = false;
      showToast('当前已是最新版本', 'ok');
      setResult('已是最新版本');
    }
  }
}
if (window.api && api.onAppUpdate) api.onAppUpdate(applyUpdateState);
const updateBtnEl = document.getElementById('updateBtn');
if (updateBtnEl) updateBtnEl.addEventListener('click', () => {
  const act = updateBtnEl.dataset.act || 'download';
  if (act === 'install') { if (api.updateInstall) api.updateInstall(); }
  else if (api.updateDownload) { updateBtnEl.disabled = true; updateBtnEl.textContent = '下载中…'; api.updateDownload(); }
});
const updateCloseEl = document.getElementById('updateClose');
if (updateCloseEl) updateCloseEl.addEventListener('click', () => { if (updateBarEl) updateBarEl.classList.add('hidden'); });
const appVersionLabel = document.getElementById('appVersionLabel');
if (api.appVersion) api.appVersion().then((v) => { if (appVersionLabel) appVersionLabel.textContent = 'v' + (v || ''); }).catch(() => {});
const updateCheckBtn = document.getElementById('updateCheckBtn');
const updateCheckResult = document.getElementById('updateCheckResult');
let updateCheckWatchdog = null;
if (updateCheckBtn) updateCheckBtn.addEventListener('click', () => {
  if (!api.updateCheck) return;
  manualUpdateCheck = true;
  if (updateCheckResult) updateCheckResult.textContent = '正在检查更新…';
  if (updateCheckWatchdog) clearTimeout(updateCheckWatchdog);
  updateCheckWatchdog = setTimeout(() => {
    manualUpdateCheck = false;
    updateCheckWatchdog = null;
    if (updateCheckResult && String(updateCheckResult.textContent).indexOf('正在检查更新…') >= 0) {
      updateCheckResult.textContent = '检查失败，请稍后重试';
    }
  }, 40000);
  api.updateCheck().then((r) => {
    if (r && !r.ok) {
      manualUpdateCheck = false;
      if (updateCheckWatchdog) { clearTimeout(updateCheckWatchdog); updateCheckWatchdog = null; }
      showToast('检查更新失败：' + (r.error || '未知错误'), 'err');
      if (updateCheckResult) updateCheckResult.textContent = '检查失败，请稍后重试';
    }
  }).catch(() => {});
});

// ===== AI 歌单：解析推荐 → 双平台匹配 → 一键播放 =====
function parseAiSongList(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^[（(]?\s*\d+\s*[)）.、:：]\s*/, '').replace(/^[-•·*>\s]+/, '');
    if (!line) continue;
    const m = line.match(/^(.{1,40}?)\s*[-–—]\s*(.{1,30})$/);
    if (m) {
      const name = m[1].replace(/[《》「」『』""]/g, '').trim();
      const artist = m[2].trim();
      if (name && artist) out.push({ name: name, artist: artist });
    }
  }
  return out;
}
async function buildAiPlaylist(items, onProgress) {
  const songs = [];
  const seen = new Set();
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, '');
  for (const it of items) {
    const kw = (it.name + (it.artist ? ' ' + it.artist : '')).trim();
    try {
      const [nRes, qRes] = await Promise.all([
        withTimeout(api.search(kw), 9000).catch(() => []),
        withTimeout(api.qqSearch(kw), 9000).catch(() => [])
      ]);
      const nArr = Array.isArray(nRes) ? nRes.map((sg) => Object.assign({ platform: 'netease' }, sg)) : [];
      const qArr = Array.isArray(qRes) ? qRes : [];
      const cands = nArr.concat(qArr);
      if (!cands.length) continue;
      const want = norm(it.name);
      const score = (sg) => {
        const nm = norm(sg.name);
        if (nm === want) return 3;
        if (nm.indexOf(want) >= 0 || want.indexOf(nm) >= 0) return 2;
        return 0;
      };
      cands.sort((a, b) => (score(b) - score(a)) || (Number(a.vip || 0) - Number(b.vip || 0)) || (Number(b.pop || 0) - Number(a.pop || 0)));
      const pick = cands.find((sg) => score(sg) > 0) || cands[0];
      if (!pick) continue;
      const key = (pick.platform || 'netease') + ':' + String(pick.id);
      if (!seen.has(key)) { seen.add(key); songs.push(pick); }
    } catch (err) { /* 单曲匹配失败跳过 */ }
    if (onProgress) onProgress(i + 1, items.length);
    if (songs.length >= 60) break;
  }
  return songs;
}
function maybeOfferAiPlaylist(bubble, text) {
  const items = parseAiSongList(text);
  if (!items || items.length < 3) return;
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg-actions';
  const btn = document.createElement('button');
  btn.className = 'ai-play-btn';
  btn.textContent = '▶ 将这 ' + items.length + ' 首生成 AI 歌单';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '匹配歌曲中…';
    try {
      const songs = await buildAiPlaylist(items, (done, total) => { btn.textContent = '匹配歌曲中… ' + done + '/' + total; });
      if (!songs || !songs.length) { showToast('未能匹配到可播放的歌曲，请检查 AI 输出格式', 'err'); return; }
      const aiPl = addAiPlaylist(songs);
      renderAiPlaylistCards();
      toggleAiPanel(false);
      openAiPlaylist(aiPl);
      showToast('已生成 AI 歌单《' + aiPl.name + '》共 ' + songs.length + ' 首', 'ok');
    } catch (err) {
      showToast('生成歌单失败：' + (err.message || err), 'err');
    } finally {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
  });
  wrap.appendChild(btn);
  bubble.appendChild(wrap);
}

// ===== AI 本地歌单（持久化，可点开查看）=====
const AI_PL_KEY = 'qin-ai-playlists';
function loadAiPlaylists() {
  try { const a = JSON.parse(localStorage.getItem(AI_PL_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function saveAiPlaylists(list) {
  try { localStorage.setItem(AI_PL_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) { /* 忽略 */ }
}
function makeAiPlaylistName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return 'AI 歌单 · ' + pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function addAiPlaylist(songs) {
  const list = loadAiPlaylists();
  const pl = { id: 'aipl:' + Date.now(), name: makeAiPlaylistName(), createdAt: Date.now(), songs: songs };
  list.unshift(pl);
  saveAiPlaylists(list);
  return pl;
}
function removeAiPlaylist(id) {
  saveAiPlaylists(loadAiPlaylists().filter((x) => x.id !== id));
}
function openAiPlaylist(pl) {
  if (!pl || !pl.songs || !pl.songs.length) { showToast('歌单为空', 'err'); return; }
  showView('search');
  emptyState.classList.add('hidden');
  renderSongs(pl.songs);
  displayedListKind = 'ai-pl';
  setListHeader(pl.name, 'AI 生成 · 本地歌单', pl.songs.length + ' 首歌曲 · 双击播放');
  statusLine.textContent = 'AI 歌单《' + pl.name + '》共 ' + pl.songs.length + ' 首，双击歌曲播放';
}
function makeAiPlaylistCard(pl) {
  const card = document.createElement('div');
  card.className = 'playlist-card ai-pl-card';
  const imgWrap = document.createElement('div');
  imgWrap.className = 'pl-cover ai-pl-cover';
  const spark = document.createElement('span');
  spark.className = 'ai-pl-spark';
  spark.textContent = 'AI';
  imgWrap.appendChild(spark);
  const badge = document.createElement('div');
  badge.className = 'pl-badge';
  badge.textContent = pl.songs.length + ' 首';
  imgWrap.appendChild(badge);
  const name = document.createElement('div');
  name.className = 'pl-name';
  name.textContent = pl.name;
  const sub = document.createElement('div');
  sub.className = 'pl-sub';
  sub.textContent = '本地 AI 歌单 · 点击查看';
  name.appendChild(sub);
  const del = document.createElement('button');
  del.className = 'pl-del';
  del.title = '删除该歌单';
  del.textContent = '×';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    removeAiPlaylist(pl.id);
    renderAiPlaylistCards();
    showToast('已删除歌单《' + pl.name + '》', 'info');
  });
  card.append(imgWrap, name, del);
  card.addEventListener('click', () => openAiPlaylist(pl));
  return card;
}
function renderAiPlaylistCards() {
  if (!playlistGrid) return;
  playlistGrid.querySelectorAll('.ai-pl-card').forEach((n) => n.remove());
  const frag = document.createDocumentFragment();
  loadAiPlaylists().slice(0, 3).forEach((pl) => frag.appendChild(makeAiPlaylistCard(pl)));
  playlistGrid.insertBefore(frag, playlistGrid.firstChild);
}


function sendAiInput() {
  const v = $('aiInput').value.trim();
  if (!v) return;
  $('aiInput').value = '';
  askAi(v);
}
$('aiSendBtn').addEventListener('click', sendAiInput);
$('aiInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiInput(); }
});
fillAiFields();
// 干员按钮风格选择
document.querySelectorAll('#bgStyleSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    bgSettings.btnStyle = b.dataset.style;
    saveBgSettings();
    applyBtnStyle();
  });
});
document.querySelectorAll('#bgModeSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    bgSettings.mode = b.dataset.bg; saveBgSettings(); applyBgSettings();
    if (b.dataset.bg === 'arknights') applyArkTheme(true);
    if (b.dataset.bg === 'wallpaper') loadWeWallpapers();
  });
});
document.querySelectorAll('#bgArtSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    bgSettings.arkArt = Number(b.dataset.art);
    saveBgSettings();
    applyArkBg();
  });
});

// ================= 明日方舟全站主题 =================
function applyArkTheme(on) {
  const enable = on === undefined ? localStorage.getItem('qin-ark-theme') === '1' : !!on;
  document.body.classList.toggle('ark-theme', enable);
  const btn = $('arkThemeBtn');
  if (btn) btn.classList.toggle('on', enable);
  return enable;
}
const arkRoleMenuEl = document.getElementById('arkRoleMenu');
function toggleArkRoleMenu(show) {
  if (!arkRoleMenuEl) return;
  const next = show === undefined ? arkRoleMenuEl.classList.contains('hidden') : show;
  arkRoleMenuEl.classList.toggle('hidden', !next);
  if (next) {
    document.querySelectorAll('#arkRoleMenu .ark-role-item').forEach(function (it) {
      it.classList.toggle('active', it.dataset.style === bgSettings.btnStyle);
    });
  }
}
$('arkThemeBtn').addEventListener('click', function (e) {
  e.stopPropagation();
  toggleArkRoleMenu();
});
document.addEventListener('click', function (e) {
  if (arkRoleMenuEl && !arkRoleMenuEl.classList.contains('hidden') && e.target && !e.target.closest('#arkRoleMenu') && !e.target.closest('#arkThemeBtn')) {
    arkRoleMenuEl.classList.add('hidden');
  }
});
document.querySelectorAll('#arkRoleMenu .ark-role-item').forEach(function (it) {
  it.addEventListener('click', function () {
    const key = it.dataset.style;
    if (key === 'off') {
      bgSettings.btnStyle = 'off';
      saveBgSettings();
      applyBtnStyle();
      applyArkTheme(false);
      if (statusLine) statusLine.textContent = '已关闭明日方舟主题';
    } else {
      bgSettings.btnStyle = key;
      saveBgSettings();
      applyBtnStyle();
      applyArkTheme(true);
      const label = it.querySelector('span');
      if (statusLine) statusLine.textContent = '已切换角色主题：' + (label ? label.textContent : key);
    }
    toggleArkRoleMenu(false);
  });
});
if (new URLSearchParams(window.location.search).get('ark') === '1') localStorage.setItem('qin-ark-theme', '1');
applyArkTheme();
$('bgBeatBtn').addEventListener('click', () => { bgSettings.beat = !bgSettings.beat; saveBgSettings(); applyBgSettings(); });
$('bgReadBtn').addEventListener('click', () => { bgSettings.readability = !bgSettings.readability; saveBgSettings(); applyBgSettings(); });

// 帧数选择（30 / 60 / 120，写入 qin-frame-cap 供渲染循环节流）
function applyFrameCapUI() {
  document.querySelectorAll('#frameCapSeg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.fps) === frameCap));
}
document.querySelectorAll('#frameCapSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    frameCap = Number(b.dataset.fps);
    localStorage.setItem('qin-frame-cap', String(frameCap));
    applyFrameCapUI();

    statusLine.textContent = '帧数已设为 ' + frameCap + ' FPS';
  });
});
applyFrameCapUI();

// ================= 歌词萌宠（Angelina GIF 跟随歌词 / 商籁动态） =================
const GIF_FX_LIST = [
  'assets/arknights/gif/纸飞机.gif',
  'assets/arknights/gif/坐坐.gif',
  'assets/arknights/gif/看书.gif',
  'assets/arknights/gif/海边.gif',
  'assets/arknights/gif/拍照.gif',
  'assets/arknights/gif/骑行.gif',
  'assets/arknights/gif/购物.gif',
  'assets/arknights/gif/潜水.gif',
  'assets/arknights/gif/探险.gif',
  'assets/arknights/gif/送货.gif'
];
let gifFxOn = true;
let gifFxIdx = -1;
let gifFxImgEl = null;
let gifFxLayerEl = null;
let gifFxTimer = null;
let gifStageRectCache = null;
window.addEventListener('resize', () => { gifStageRectCache = null; }, { passive: true });
function initGifFx() {
  gifFxLayerEl = document.getElementById('gifFxLayer');
  gifFxImgEl = document.getElementById('gifFxImg');
  if (!gifFxLayerEl || !gifFxImgEl) return;
  gifFxOn = bgSettings.gifFx !== false;
  gifFxLayerEl.classList.toggle('hidden', !gifFxOn);
  cycleGifFx();
  if (!gifFxTimer) gifFxTimer = setInterval(cycleGifFx, 16000);
}
function cycleGifFx() {
  if (!gifFxImgEl || !gifFxLayerEl || !gifFxOn) return;
  gifFxIdx = (gifFxIdx + 1) % GIF_FX_LIST.length;
  gifFxImgEl.src = GIF_FX_LIST[gifFxIdx];
}
let gifSmoothX = 0, gifSmoothY = 0, gifSmoothScale = 1;
function updateGifFx(t, dt) {
  if (!gifFxOn || !gifFxLayerEl || !gifFxImgEl) return;
  if (gifFxLayerEl.classList.contains('hidden')) return;
  if (!gifStageRectCache) gifStageRectCache = stageViewEl.getBoundingClientRect();
  const rect = gifStageRectCache;
  if (!rect.width || !rect.height) { gifStageRectCache = null; return; }
  const k = Math.min(1, dt * 5.5);
  let tx, ty;
  if (stageLineEl && stageLineEl.offsetWidth > 0) {
    const lr = stageLineEl.getBoundingClientRect();
    const gx = lr.left - rect.left;
    const gy = lr.top - rect.top;
    // 优先放歌词左侧偏上，左侧放不下切到右侧，始终错开歌词文字
    if (gx - 60 >= 56) tx = gx - 52;
    else tx = gx + lr.width + 52;
    ty = gy + lr.height * 0.3 - 8;
    tx = Math.max(56, Math.min(rect.width - 56, tx));
    ty = Math.max(70, Math.min(rect.height - 100, ty));
  } else {
    // 间奏 / 无歌词：舞台左上空白区慢满漂移，不挡歌词
    tx = rect.width * 0.14 + Math.sin(t * 0.21) * 60;
    ty = rect.height * 0.16 + Math.sin(t * 0.7 + 1.1) * 12;
  }
  if (!gifSmoothX && !gifSmoothY) { gifSmoothX = tx; gifSmoothY = ty; }
  gifSmoothX += (tx - gifSmoothX) * k;
  gifSmoothY += (ty - gifSmoothY) * k;
  const kick = beatKick || 0, bb = bass || 0, ch = chorusLevel || 0;
  const targetScale = 1 + bb * 0.16 + kick * 0.14 + ch * 0.05;
  gifSmoothScale += (targetScale - gifSmoothScale) * Math.min(1, dt * 8);
  const bob = kick * 26 + bb * 16;
  const rot = Math.sin(t * 0.5) * 4;
  gifFxImgEl.style.transform =
    'translate(' + gifSmoothX.toFixed(1) + 'px,' + (gifSmoothY + bob + Math.sin(t * 2.2) * 5).toFixed(1) + 'px) translate(-50%,-50%) scale(' + gifSmoothScale.toFixed(3) + ') rotate(' + rot.toFixed(1) + 'deg)';
  const op = Math.min(1, 0.82 + Math.min(1, bb * 0.3 + kick * 0.35)).toFixed(2);
  if (gifFxImgEl.__op !== op) { gifFxImgEl.__op = op; gifFxImgEl.style.opacity = op; }
}
initGifFx();
const gifFxSw = $('gifFxSw');
if (gifFxSw) gifFxSw.addEventListener('click', () => {
  gifFxOn = !gifFxOn;
  bgSettings.gifFx = gifFxOn;
  saveBgSettings();
  gifFxSw.classList.toggle('on', gifFxOn);
  if (gifFxLayerEl) gifFxLayerEl.classList.toggle('hidden', !gifFxOn);
  if (gifFxOn) cycleGifFx();
  if (statusLine) statusLine.textContent = gifFxOn ? '歌词萌宠已开启' : '歌词萌宠已关闭';
});

// ================= 快捷键 & 舞台交互 =================
addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); if (!audio.paused) audio.pause(); else audio.play(); }
  else if (e.code === 'ArrowRight') { if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
  else if (e.code === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); }
  else if (e.code === 'ArrowUp') { setVolume(+volume.value + 0.05); }
  else if (e.code === 'ArrowDown') { setVolume(+volume.value - 0.05); }
  else if (e.key === '[') adjustLyricOffset(-100);
  else if (e.key === ']') adjustLyricOffset(100);
  else if (e.key === '{') adjustLyricOffset(-20);
  else if (e.key === '}') adjustLyricOffset(20);
  else if (e.key === '0') { lyricOffsetMs = 0; saveLyricOffset(); statusLine.textContent = '歌词同步偏移已归零'; }
  else if (e.key === '1') setStageMode('sonnet');
  else if (e.key === '2') setStageMode('stage');
});
stageViewEl.addEventListener('dblclick', () => {
  if (audio.paused) audio.play(); else audio.pause();
});

// ================= 本地音乐 =================
$('localBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (!f) return;
  fmActive = false;
  queue = [];
  queueIndex = -1;
  initAudio();
  audio.src = URL.createObjectURL(f);
  audio.play().catch(() => {});
  setNowPlaying({ name: f.name.replace(/\.[^.]+$/, ''), artist: '本地文件', album: '', cover: '', id: null });
  lyricOffsetMs = 0;
  updateLyricOffsetChip();
  applyCover(null);
  showView('stage');
  updateQueueButtons();
  lyricsLines = [];
  lyricMeta = [];
  syncMrLyricMeta();
  stageLineEl = null;
  stageLineIdx = -1;
  lyricFloatEl.innerHTML = '';
  stageStatus.textContent = '本地音乐暂无歌词';
});

// ================= 平台切换 =================
document.querySelectorAll('.pill').forEach((p) => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((x) => x.classList.remove('active'));
    p.classList.add('active');
    const name = p.dataset.platform;
    if (name === 'qishui') {
      showToast('汽水音乐暂无稳定社区接口，请使用网易云或 QQ 音乐', 'info');
      statusLine.textContent = '汽水音乐暂无稳定社区接口，请使用网易云或 QQ 音乐';
      return;
    }
    activePlatform = name === 'qq' ? 'qq' : 'netease';
    statusLine.textContent = activePlatform === 'qq' ? '已切换至 QQ 音乐' : '已切换至网易云音乐';
    if (!views.home.classList.contains('hidden')) {
      loadHome();
    } else if (!views.search.classList.contains('hidden')) {
      if (displayedListKind) {
        // 正在查看歌单/我的喜欢：跳转到目标平台首页
        showView('home');
        loadHome();
      } else if (searchInput.value.trim()) {
        doSearch();
      }
    }
  });
});

// ================= 最近播放历史（本地记忆，Folia 没有的差异化功能） =================
function guessHistoryPlatform(h) {
  const id = String((h && h.id) || '');
  const cover = String((h && h.cover) || '');
  // QQ songmid 含字母，纯数字为网易云：以 id 特征为准纠正错误标记
  if (/[A-Za-z]/.test(id)) return 'qq';
  if (/^[0-9]+$/.test(id)) return 'netease';
  if (cover.indexOf('gtimg.cn') >= 0) return 'qq';
  if (cover.indexOf('126.net') >= 0) return 'netease';
  return (h && h.platform) || 'netease';
}
function getHistory() {
  try {
    const list = JSON.parse(localStorage.getItem('qin-history') || '[]');
    if (!Array.isArray(list)) return [];
    let changed = false;
    for (const h of list) {
      if (h) {
        const want = guessHistoryPlatform(h);
        if (want !== h.platform) { h.platform = want; changed = true; }
      }
    }
    if (changed) localStorage.setItem('qin-history', JSON.stringify(list));
    return list;
  } catch (err) { return []; }
}
function saveHistory(list) { localStorage.setItem('qin-history', JSON.stringify(list)); }

function recordHistory(song) {
  if (!song || !song.id) return;
  const plat = guessHistoryPlatform(song) || song.platform || activePlatform || 'netease';
  const list = getHistory().filter((h) => String(h.platform || 'netease') + ':' + String(h.id) !== String(plat) + ':' + String(song.id));
  list.unshift({ id: song.id, platform: plat, name: song.name, artist: song.artist, album: song.album, cover: song.cover, dt: song.dt, playedAt: Date.now() });
  saveHistory(list.slice(0, 60));
  renderHistoryStrip();
}

function renderHistoryStrip() {
  const sec = $('historySection');
  const strip = $('historyStrip');
  if (!sec || !strip) return;
  const list = getHistory();
  if (!list.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  strip.innerHTML = '';
  list.forEach((h) => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const cover = document.createElement('div');
    cover.className = 'mini-cover';
    if (h.cover) { const img = new Image(); img.onload = () => { cover.textContent = ''; cover.appendChild(img); }; img.src = h.cover; }
    else cover.innerHTML = svgIcon('note', 15);
    const info = document.createElement('div');
    info.className = 'h-info';
    info.innerHTML = '<div class="t"></div><div class="a"></div>';
    info.children[0].textContent = h.name;
    info.children[1].textContent = (h.artist || '') + (h.platform ? '  \u00B7  ' + (h.platform === 'qq' ? 'QQ' : '\u7F51\u6613') : '');
    card.append(cover, info);
    card.addEventListener('click', () => playSong(h, -1));
    strip.appendChild(card);
  });
}

// 全局媒体快捷键 / 系统托盘命令（主进程转发）
if (api.onMediaCommand) {
  api.onMediaCommand((cmd) => {
    if (cmd === 'toggle') { if (audio.paused) audio.play(); else audio.pause(); }
    else if (cmd === 'next') { goNext(false); }
    else if (cmd === 'prev') { goPrev(); }
    else if (cmd === 'desk-lyric') { deskLyricBtn.click(); }
  });
}
const historyClearBtn = $('historyClearBtn');
if (historyClearBtn) {
  historyClearBtn.addEventListener('click', () => {
    saveHistory([]);
    renderHistoryStrip();
    statusLine.textContent = '播放历史已清空';
  });
}

// ================= 特色功能：倍速 / 睡眠定时 / 音效 / 迷你模式 =================
const speedBtn = $('speedBtn');
const timerBtn = $('timerBtn');
const fxBtn = $('fxBtn');
const volBtn = $('volBtn');
const miniBtn = $('miniBtn');
const extraPanel = $('extraPanel');

let playRate = parseFloat(localStorage.getItem('qin-play-rate') || '1') || 1;
function applyPlayRate() {
  try { audio.playbackRate = playRate; } catch (err) { /* 未播放时忽略 */ }
  if (speedBtn) speedBtn.textContent = (Math.round(playRate * 100) / 100) + 'x';
}
function setPlayRate(r) {
  playRate = r;
  localStorage.setItem('qin-play-rate', String(r));
  applyPlayRate();
  document.querySelectorAll('#speedSeg button').forEach((b) => b.classList.toggle('active', +b.dataset.rate === r));
  if (speedBtn) speedBtn.classList.add('pulse'); void (speedBtn && speedBtn.offsetWidth); if (speedBtn) speedBtn.classList.remove('pulse');
}
if (speedBtn) {
  speedBtn.addEventListener('click', () => {
    const rates = [1, 1.25, 1.5, 2, 0.75];
    const i = rates.indexOf(playRate);
    setPlayRate(rates[(i + 1) % rates.length]);
    statusLine.textContent = '播放速度：' + playRate + 'x';
  });
  applyPlayRate();
}
const speedSeg = $('speedSeg');
if (speedSeg) {
  speedSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setPlayRate(+b.dataset.rate)));
  speedSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.rate === playRate));
}

// 音质选项（网易云 eapi 级别：标准/较高/极高/无损/Hi-Res）
const QUALITY_OPTIONS = [
  { key: 'standard', label: '标准' },
  { key: 'higher', label: '较高' },
  { key: 'exhigh', label: '极高' },
  { key: 'lossless', label: '无损' },
  { key: 'hires', label: 'Hi-Res' }
];
let qualityLevel = localStorage.getItem('qin-quality') || 'exhigh';
if (!QUALITY_OPTIONS.some((o) => o.key === qualityLevel)) qualityLevel = 'exhigh';
function qualityLabel(k) { const o = QUALITY_OPTIONS.find((q) => q.key === k); return o ? o.label : k; }
async function setQuality(level) {
  if (!QUALITY_OPTIONS.some((o) => o.key === level) || level === qualityLevel) return;
  qualityLevel = level;
  localStorage.setItem('qin-quality', level);
  document.querySelectorAll('#qualitySeg button').forEach((b) => b.classList.toggle('active', b.dataset.quality === level));
  // 清空已缓存地址与预取，避免旧音质复用
  urlCache.clear();
  urlPending.clear();
  if (audioNext) { try { audioNext.src = ''; } catch (err) { /* 忽略 */ } }
  statusLine.textContent = '音质：' + qualityLabel(level) + actualQualityLabel(currentSong && currentSong.id, currentSong && currentSong.platform);
  if (currentSong && audio && audio.src) {
    const pos = audio.currentTime || 0;
    const wasPlaying = !audio.paused;
    stageStatus.textContent = '切换音质…';
    setLoading(true, '切换音质…');
    try {
      const url = await cachedResolveUrl(currentSong.id);
      if (!url) throw new Error('该音质暂不可用');
      audio.src = url;
      audio.volume = baseVolume;
      audio.playbackRate = playRate;
      audio.addEventListener('loadedmetadata', function onMeta() {
        audio.removeEventListener('loadedmetadata', onMeta);
        setLoading(false);
        try { if (pos > 0.5 && audio.duration && pos < audio.duration - 2) audio.currentTime = pos; } catch (err) { /* 忽略 seek 失败 */ }
        if (wasPlaying) { const p = audio.play(); if (p) p.catch(() => {}); }
      });
      if (wasPlaying) { const p = audio.play(); if (p) p.catch(() => {}); }
      prefetchNextUrls();
      stageStatus.textContent = '音质：' + qualityLabel(level) + actualQualityLabel(currentSong && currentSong.id, currentSong && currentSong.platform);
    } catch (err) {
      setLoading(false);
      stageStatus.textContent = '音质切换失败';
      statusLine.textContent = '音质切换失败：' + err.message;
    }
  }
}
const qualitySeg = $('qualitySeg');
if (qualitySeg) {
  qualitySeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setQuality(b.dataset.quality); toggleExtraPanel(false); }));
  qualitySeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.quality === qualityLevel));
}

// 音效增强开关（低音 / 高音 / 空间感）
const fxBassSw = $('fxBassSw');
const fxTrebleSw = $('fxTrebleSw');
const fxSpaceSw = $('fxSpaceSw');
function setFx(name, on) {
  if (name === 'bass') fxBass = on;
  else if (name === 'treble') fxTreble = on;
  else fxSpace = on;
  localStorage.setItem('qin-fx-' + name, on ? '1' : '0');
  applyFx();
  const el = name === 'bass' ? fxBassSw : name === 'treble' ? fxTrebleSw : fxSpaceSw;
  if (el) el.classList.toggle('on', on);
}
if (fxBassSw) fxBassSw.addEventListener('click', () => setFx('bass', !fxBass));
if (fxTrebleSw) fxTrebleSw.addEventListener('click', () => setFx('treble', !fxTreble));
if (fxSpaceSw) fxSpaceSw.addEventListener('click', () => setFx('space', !fxSpace));
setFx('bass', fxBass); setFx('treble', fxTreble); setFx('space', fxSpace);

// 睡眠定时器
let sleepEndAt = 0;
let sleepTimer = null;
function updateTimerBtn() {
  if (!timerBtn) return;
  if (sleepEndAt) {
    const left = Math.max(1, Math.round((sleepEndAt - Date.now()) / 60000));
    timerBtn.innerHTML = '<span class="timer-num">' + left + '</span>';
  } else {
    timerBtn.innerHTML = svgIcon('timer', 16);
  }
}
function setSleepTimer(minutes) {
  if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = null; }
  sleepEndAt = minutes ? Date.now() + minutes * 60000 : 0;
  if (timerBtn) timerBtn.classList.toggle('on', !!minutes);
  updateTimerBtn();
  if (!minutes) { statusLine.textContent = '睡眠定时已取消'; return; }
  sleepTimer = setInterval(() => {
    if (Date.now() >= sleepEndAt) {
      clearInterval(sleepTimer); sleepTimer = null; sleepEndAt = 0;
      updateTimerBtn();
      fadeOut(() => { audio.pause(); }, 800);
      statusLine.textContent = '睡眠定时：已到时间，停止播放';
      pushMiniState(true);
    } else {
      updateTimerBtn();
    }
  }, 1000);
  statusLine.textContent = '睡眠定时：' + minutes + ' 分钟后停止播放';
}
if (timerBtn) updateTimerBtn();
const timerSeg = $('timerSeg');
if (timerSeg) {
  timerSeg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { setSleepTimer(+b.dataset.min || 0); toggleExtraPanel(false); });
  });
}

// 声音 & 定时面板
function toggleExtraPanel(show) {
  if (!extraPanel) return;
  const on = show === undefined ? extraPanel.classList.contains('hidden') : show;
  extraPanel.classList.toggle('hidden', !on);
  if (fxBtn) fxBtn.classList.toggle('on', on);
  if (volBtn) volBtn.classList.toggle('on', on);
}
if (fxBtn) fxBtn.addEventListener('click', () => toggleExtraPanel());
if (volBtn) volBtn.addEventListener('click', () => toggleExtraPanel());
if (extraPanel) {
  const ec = $('extraClose');
  if (ec) ec.addEventListener('click', () => toggleExtraPanel(false));
  document.addEventListener('click', (e) => {
    if (extraPanel.classList.contains('hidden')) return;
    if (extraPanel.contains(e.target)) return;
    if (fxBtn && fxBtn.contains(e.target)) return;
    if (volBtn && volBtn.contains(e.target)) return;
    toggleExtraPanel(false);
  });
}

// 迷你模式（置顶小窗）
if (miniBtn && api.toggleMini) {
  miniBtn.addEventListener('click', async () => {
    const on = await api.toggleMini();
    miniBtn.classList.toggle('on', !!on);
    if (on) pushMiniState(true);
  });
  if (api.onMiniClosed) api.onMiniClosed(() => miniBtn.classList.remove('on'));
}
let lastMiniPush = 0;
function pushMiniState(force) {
  if (!api.sendMiniState) return;
  const now = performance.now();
  if (!force && now - lastMiniPush < 400) return;
  lastMiniPush = now;
  const song = currentSong;
  if (!song) return;
  api.sendMiniState({
    title: song.name || '',
    artist: (song.artist || '') + (song.album ? ' · ' + song.album : ''),
    cover: song.cover || '',
    coverData: coverCache.get(song.cover) || '',
    playing: !audio.paused,
    cur: audio.currentTime || 0,
    dur: audio.duration || song.dt / 1000 || 0
  });
}

// ================= 工具 =================
function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00';
  sec = Math.floor(sec);
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

function fmtCount(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}

// ================= 首次启动动态封面 =================
function startIntroCanvas(introSplashEl) {
  const cv = $('introCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W = cv.width = innerWidth, H = cv.height = innerHeight;
  addEventListener('resize', () => { W = cv.width = innerWidth; H = cv.height = innerHeight; });
  const parts = [];
  for (let i = 0; i < 80; i++) {
    parts.push({
      x: Math.random() * W, y: Math.random() * H,
      r: 1 + Math.random() * 2.6,
      vx: (Math.random() - 0.5) * 0.5, vy: -0.25 - Math.random() * 0.7,
      hue: 195 + Math.random() * 75,
      a: 0.25 + Math.random() * 0.55
    });
  }
  (function introLoop() {
    if (!introSplashEl || !introSplashEl.parentNode) return;
    requestAnimationFrame(introLoop);
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(34,211,238,0.12)');
    g.addColorStop(0.5, 'rgba(99,102,241,0.08)');
    g.addColorStop(1, 'rgba(167,139,250,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const dx = parts[i].x - parts[j].x, dy = parts[i].y - parts[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 160 * 160) {
          ctx.strokeStyle = 'hsla(210, 90%, 78%, ' + (0.22 * (1 - d2 / 25600)).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(parts[i].x, parts[i].y); ctx.lineTo(parts[j].x, parts[j].y); ctx.stroke();
        }
      }
    }
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.y < -12) { p.y = H + 12; p.x = Math.random() * W; }
      if (p.x < -12) p.x = W + 12; else if (p.x > W + 12) p.x = -12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + p.hue + ', 90%, 72%, ' + p.a.toFixed(3) + ')';
      ctx.fill();
    }
  })();
}

// ================= 启动 =================
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
document.querySelectorAll('.nav-btn[data-view]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.view));
});

init3D();
initShaderBg();
applyBgSettings();
setStageMode(stageMode);
initMrParams();
initWallpaperControls();
refreshLogin();
refreshQqLogin();
renderHistoryStrip();
showView('home');

// 首次启动动态封面：点击进入，期间后台加载软件组件（init3D / loadHome 等已同步启动）
const introSplashEl = $('introSplash');
if (introSplashEl) {
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('nosplash') === '1') {
    introSplashEl.parentNode.removeChild(introSplashEl);
  } else {
    startIntroCanvas(introSplashEl);
    introSplashEl.addEventListener('click', () => {
      introSplashEl.classList.add('out');
      setTimeout(() => { if (introSplashEl.parentNode) introSplashEl.parentNode.removeChild(introSplashEl); }, 650);
    });
  }
}

// ================= 演示模式（--shot + --demo-mode 截图验证用） =================
const demoParams = new URLSearchParams(window.location.search);
let demoMode = demoParams.get('demo') === '1';
let demoTime = parseFloat(demoParams.get('t') || '0') || 0, demoLastBeat = 0;
let demoPaused = demoParams.get('p') === '1';
if (demoMode) {
  window.__demoAudio = true; // demo 模式绕过暂停音频衰减，让特效演示饱满
  const demoModeName = demoParams.get('mode') || 'sonnet';
  setStageMode(demoModeName);
  const demoBg = demoParams.get('bg');
  if (demoBg && ['roam', 'fade', 'static', 'arknights'].indexOf(demoBg) >= 0) {
    bgSettings.mode = demoBg;
    applyBgSettings();
  }
  const demoPreset = demoParams.get('preset');
  if (demoModeName === 'stage' && demoPreset != null) {
    ensureMrStage();
    if (mrStage && mrStage.setPreset) mrStage.setPreset(Number(demoPreset) || 0, { silent: true, noSave: true });
  }
  currentSong = { id: 'demo-mr', name: '晚霞', artist: 'YuMusic', album: '', dt: 0, cover: demoParams.get('cover') || 'https://p1.music.126.net/9gkE-74Bemt9zyQyx9V4hA==/632219185993597.jpg' };
  applyCover(currentSong.cover); // demo 也走代理封面链路，背景粒子拼出封面
  const demoText = [
    ['00:00.00', '夕阳把影子拉得很长很长'],
    ['00:02.30', '我们并肩走在旧操场上'],
    ['00:04.70', '风绕过耳边 轻轻唱着歌'],
    ['00:07.20', '好像时间 也为此刻停留'],
    ['00:09.60', '你说远方有海 也有星光'],
    ['00:12.00', '于是我把愿望 写进手掌'],
    ['00:14.40', '等一场雨 淋湿所有慌张'],
    ['00:16.80', '再把夏天 唱给你听'],
    ['00:19.20', '晚霞 晚霞 请慢些落下'],
    ['00:21.60', '让我 记住 你眼里的光'],
    ['00:24.00', '晚霞 晚霞 请慢些落下'],
    ['00:26.40', '明天 我们 还要去远方']
  ];
  lyricsLines = demoText.map((pair) => {
    const mm = pair[0].split(':');
    return { time: +mm[0] * 60 + +mm[1], text: pair[1] };
  });
  buildLyricMeta();
  chorusSet = detectChorus(lyricsLines);
  compileSonnetProgram();
  if (stageMode === 'sonnet') ensureSonnetRuntime();
  [0, 2, 4, 6, 8, 10].forEach((i) => { if (lyricMeta[i]) lyricMeta[i].trans = '· 演示翻译 ·'; });
  stageTitle.textContent = '演示模式 · ' + demoModeName;
  stageArtist.textContent = 'YuMusic 特效预览';
  stageStatus.textContent = '演示模式 · 歌词随特效流动';
  showView('stage');
  requestAnimationFrame(() => { if (lyricMeta.length) showStageLine(0); });
  window.__lyricDebug = () => ({ beats: beatTimes.slice(-20), chars: lyricMeta[stageLineIdx] ? lyricMeta[stageLineIdx].chars : [], idx: stageLineIdx, text: lyricMeta[stageLineIdx] ? lyricMeta[stageLineIdx].text : '', shotKind: lyricMeta[stageLineIdx] ? lyricMeta[stageLineIdx].shotKind : null, containerTF: stageLineEl ? stageLineEl.style.transform : '', words: (snProgram[stageLineIdx] || []).map(s => ({ t: s.text, r: s.role, bx: s.bx, by: s.by })), seed: lyricMeta[stageLineIdx] ? snHash(lyricMeta[stageLineIdx].text) : 0, kinds: lyricMeta.map(m => m.shotKind), t: demoTime, stageLineIdx, hueNow: curHue, c1h: getComputedStyle(document.documentElement).getPropertyValue('--c1h'), meta: lyricMeta.map(m => ({ time: m.time, end: m.end, chars: m.chars.length })) });
  window.__lyricSetTime = (t) => { demoTime = t; demoLastBeat = 0; };
  window.__lyricSetPaused = (v) => { demoPaused = v; };
window.__fxDebug = () => {
  const el = stageLineEl;
  if (!el) return null;
  const chars = Array.from(el.querySelectorAll('.lyric-char')).map((c) => ({ ch: c.textContent, on: c.classList.contains('on'), tf: c.style.transform, op: c.style.opacity }));
  const aux = {};
  const core = el.querySelector('.orbit-core');
  if (core) aux.core = { tf: core.style.transform, bs: core.style.boxShadow };
  if (el.querySelector('.orbit-core')) aux.spin = { v: Number(orbitSpinV.toFixed(3)), ang: Number((orbitAngle % (Math.PI * 2)).toFixed(3)) };
  const tet = el.querySelector('.orbit-tether');
  if (tet) aux.tether = { w: tet.style.width, tf: tet.style.transform, op: tet.style.opacity };
  aux.tracks = Array.from(el.querySelectorAll('.orbit-track')).map((t) => t.style.width);
  const com = el.querySelector('.lyric-char.on .orbit-comet, .lyric-char.holding .orbit-comet');
  if (com) aux.comet = { tf: com.style.transform, op: com.style.opacity };
  const dusts = Array.from(el.querySelectorAll('.orbit-dust')).map((d) => ({ tf: d.style.transform, op: d.style.opacity }));
  if (dusts.length) aux.dusts = dusts;
  const wv = el.querySelector('.cascade-wave');
  if (wv) aux.wave = { left: wv.style.left, op: wv.style.opacity };
  const pil = el.querySelector('.lyric-char.on .aurora-pillar');
  if (pil) aux.pillar = { h: pil.style.height, op: pil.style.opacity };
  return { mode: stageMode, sec: lyricSec(), chars, aux };
};
  window.__qinDebug = () => ({ playMode, queue: queue.map((sng) => ({ id: String(sng.id), name: sng.name })), queueIndex, urlCacheSize: urlCache.size, prefetchBusy, audioNextReady: audioNext ? audioNext.readyState : -1 });
  window.__qinSetQueue = (arr) => { queue = arr.map((sng, i) => ({ id: String(sng.id || i), name: sng.name || ('歌' + i), artist: sng.artist || '歌手', album: '', dt: 0, cover: '' })); queueIndex = 0; };
  window.__qinNextIndex = (auto) => nextTrackIndex(!!auto);
  window.__qinSetMode = (m) => setPlayMode(m);
}
window.__lyricParseDiag = (yrc, lrc) => {
  try {
    lyricsLines = parseLrc(lrc || '');
    yrcLines = parseYrc(yrc || '');
    lyricMeta = [];
    buildLyricMeta();
    return {
      yrcLines: yrcLines.length,
      meta: lyricMeta.length,
      wordTimed: lyricMeta.filter(function (m) { return m.wordTimed; }).length,
      charsTotal: lyricMeta.reduce(function (a, m) { return a + (m.chars ? m.chars.length : 0); }, 0),
      first: lyricMeta[0] ? { text: lyricMeta[0].text, chars: (lyricMeta[0].chars || []).slice(0, 3).map(function (c) { return { ch: c.ch, st: Math.round(c.start * 1000), en: Math.round(c.end * 1000) }; }) } : null
    };
  } catch (e) { return { err: String(e && e.message || e) }; }
};

window.__mrDebug = () => mrStage ? mrStage.getDebug() : null;
window.__mrStageDiag = () => { if (!mrStage || typeof mrStage.getDiag !== 'function') return { err: 'no stage' }; try { return mrStage.getDiag(); } catch (e) { return { err: String(e && e.message || e) }; } };
window.__mrSetStageParams = (p) => { if (mrStage && typeof mrStage.setParams === 'function') { mrStage.setParams(p || {}); return true; } return false; };
window.__mrPixels = () => { if (!mrStage) return { err: 'no mrStage' }; if (typeof mrStage.samplePixels !== 'function') return { err: 'no samplePixels api' }; return mrStage.samplePixels(40, 22); };
window.__qinSetStageMode = (m) => { setStageMode(m); };
window.__setWallpaperTest = (item) => {
  try {
    bgSettings.mode = 'wallpaper';
    saveBgSettings();
    applyBgSettings();
    const wl = ensureWallpaperLayer();
    wl.setType('we');
    wl.setWeItem(item);
    wl.setActive(true);
    return true;
  } catch (e) { return String(e && e.message || e); }
};
window.__wallDiag = () => {
  const v = document.getElementById('wallpaperVideo');
  const vb = document.getElementById('wallpaperVideoBlur');
  const ib = document.getElementById('wallpaperImgBlur');
  const im = document.getElementById('wallpaperImg');
  const c = document.getElementById('wallpaperCanvas');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { cw: Math.round(el.clientWidth), ch: Math.round(el.clientHeight), rectW: Math.round(b.width), rectH: Math.round(b.height), of: getComputedStyle(el).objectFit, op: getComputedStyle(el).opacity }; };
  return JSON.stringify({ video: r(v), videoBlur: r(vb), imgBlur: r(ib), img: r(im), canvas: r(c), vd: v ? { vw: v.videoWidth, vh: v.videoHeight, src: (v.currentSrc || v.src || '').slice(-40), paused: v.paused, ready: v.readyState } : null, vbd: vb ? { src: (vb.currentSrc || vb.src || '').slice(-40), paused: vb.paused } : null, layer: (() => { const L = document.getElementById('wallpaperLayer'); return L ? { cls: L.className, op: getComputedStyle(L).opacity } : null; })() });
};
window.__qinLoadLyrics = (id, platform, song) => loadLyrics(id, platform, song);
window.__qinPlaySong = (song) => playSong(song);
window.__qinLyricMetaNow = () => ({ meta: lyricMeta, yrc: yrcLines, lrc: lyricsLines });
window.__setBtnStyle = (k) => { bgSettings.btnStyle = k; saveBgSettings(); applyBtnStyle(); };
window.__mrSetPreset = (p) => { ensureMrStage(); if (mrStage && mrStage.setPreset) { mrStage.setPreset(Number(p) || 0, { preserveCamera: false }); } };
window.__qinSonnetTiming = () => (window.__sonnetTiming || null);
