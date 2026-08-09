// ============================================================
// Mineradio Stage —— 完整移植 Mineradio 歌词舞台系统 (GPL-3.0)
// 源码: https://github.com/XxHuberrr/Mineradio
//   02-visual 全套 8000+ 行原样拼接执行（源文件见 ./mr/*.js），
//   仅注入最小运行垫片（renderer/scene/camera/uniforms/fx/beatCam 等）。
// 驱动接口与旧版 MineradioStage 保持一致（buildLine/update/setHue/setVisible）。
// ============================================================
import * as THREE from 'three';
import { MR_SOURCES } from './mr-stage-data.js';
import { SKULL_POINTS_B64 } from './mr-skull-data.js';

// ============================================================
// 运行垫片（在同一个函数作用域内，先于拼接源码执行）
// ============================================================
const SHIM = String.raw`
// ---------------- QinMusic shim for Mineradio stage ----------------
var __stageCanvas = typeof document !== 'undefined' ? document.getElementById('mrStage') : null;
var renderer = new THREE.WebGLRenderer({ canvas: __stageCanvas, antialias: false, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1), 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.style.background = 'transparent';
renderer.domElement.style.display = 'block';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
var scene = new THREE.Scene();
scene.background = null;
var camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 6.6);
var uniforms = null; // 由 00-pointer-cover-particles.js 完整初始化
var SKULL_PRESET_INDEX = 6;
var SONIC_PRESET_INDEX = 7;
var MAX_VISUAL_PRESET_INDEX = 8;
var presetMeta = [{},{},{},{},{},{},{},{},{}];
var orbit = { rotating: false, last: { x: 0, y: 0 }, centerLocked: false, recentering: false, userTheta: 0, userPhi: 0.08, userRadius: 6.6, theta: 0, phi: 0.08, radius: 6.6, minPhi: -1.4, maxPhi: 1.4, minRadius: 2.4, maxRadius: 14, baselineTheta: 0, baselinePhi: 0.08, baselineRadius: 6.6, lookAt: new THREE.Vector3(0, 0, 0) };
var pointerTarget = new THREE.Vector2(0, 0);
var particleSpin = { vx: 0, vy: 0 };
var freeCamera = null;
var freeCameraPointer = { x: 0, y: 0, seen: false };
var beatCam = { punch: 0, radiusKick: 0, thetaKick: 0, phiKick: 0, rollKick: 0 };
var shelfManager = null;
var song = { id: '', name: '', artist: '', cover: '' };
var renderPerfState = { lastRenderAt: 0, fps: 0, frames: 0 };
var startupVisualPreviewActive = false;
var playbackVisualPreset = -1;
var skullParticleGroup = null;
var skullLyricMouthQuat = new THREE.Quaternion();
var skullLyricMouthTarget = new THREE.Vector3();
var skullLyricMouthForward = new THREE.Vector3();
var skullLyricMouthLocal = new THREE.Vector3();
var skullLyricReadableQuat = new THREE.Quaternion();
var skullBeatFlash = 0;
var skullWheelZoomTarget = 0;
var backCoverGroup = null;
var floatGroup = null;
var presetTransition = { active: false, start: -10, duration: 0.92, from: 0, to: 0 };
var djMode = { active: false, sectionChange: 0, sectionEnergy: 0, sectionDuration: 0, energy: 0 };
var headParallax = { x: 0, y: 0, active: false };
var pointerParallax = { x: 0, y: 0 };
var __qinMousePush = 1;
var __qinAudioSens = 1;
var __qinTimeScale = 1;
var __qinLyricFollow = 1;
var __qinLyricFollowOff = { x: 0, y: 0 };
var __qinFollowQuat = new THREE.Quaternion();
var __qinFollowEuler = new THREE.Euler();
var __qinSpinSens = 1;
var gestureRotation = { x: 0, y: 0, vx: 0, vy: 0 };
var mainFrameGates = { lyricsParticles: { name: 'lyrics-particles', targetFps: 60, runs: 0, skips: 0, lastDt: 0, pendingDt: 0 }, stageLyrics: { name: 'stage-lyrics', targetFps: 60, runs: 0, skips: 0, lastDt: 0, pendingDt: 0 } };
var __playbackSecondsOverride = null;
var __lyricTimeOffset = 0;
var __QIN_SKULL_B64 = SKULL_POINTS_B64 || '';
var lowMidBand = 0, vocalBand = 0;
// ---------------- 存储读取桩（其余 00-state 模块由本应用接管） ----------------
function readAudioFadePreference() { return { fadeInMs: 0, fadeOutMs: 0 }; }
function readDiyModePreference() { return null; }
function readCustomCoverMap() { return null; }
function readCustomLyricMap() { return null; }
function readCustomLyricPrefs() { return null; }
function readLocalBeatMapCache() { return null; }
function readLocalBeatPrefs() { return null; }
function readPlaybackQualityPreference() { return {}; }
function getProviderPlaybackQuality() { return 'exhigh'; }
function readAudioOutputDevicePreference() { return null; }
function readAudioOutputMirrorPreference() { return null; }
function readAudioInputBridgePreference() { return null; }
function loadListenStatsState() { return null; }
function packagedDefaultLyricLayoutRaw() { return null; }
function normalizeCustomBackgroundMedia(v) { return v ? String(v) : ''; }
function normalizeCustomBackgroundImage(v) { return v ? String(v) : ''; }
function markRenderInteraction() {}
function isRenderInteractionActive() { return false; }
function isDeepBackgroundMode() { return false; }
function isHiddenForBackgroundOptimization() { return false; }
function scheduleVisualApply(fn, delay) { if (fn) return setTimeout(fn, Math.max(0, delay || 0)); return 0; }
function installRenderPowerHooks() {}
function applyRendererPowerMode() {}
function unlockCenteredView() {}
var PARTICLE_POINTER_SPIN_X = 0.0048;
var PARTICLE_POINTER_SPIN_Y = 0.0048;
function clampParticleSpinVelocity(v) { return Math.max(-0.06, Math.min(0.06, v)); }
function applyParticleSpinDrag(dx, dy, dt) {
  var rx = dy * PARTICLE_POINTER_SPIN_X * __qinSpinSens;
  var ry = dx * PARTICLE_POINTER_SPIN_Y * __qinSpinSens;
  gestureRotation.x += rx;
  gestureRotation.y += ry;
  if (dt > 0) {
    particleSpin.vx = clampParticleSpinVelocity(rx / dt * 0.46);
    particleSpin.vy = clampParticleSpinVelocity(ry / dt * 0.46);
  }
}
function recenterCamera() {}
function saveFreeCameraState() {}
function resetFreeCameraToDefault() {}
function requestFreeCameraPointerLock() {}
function freeCameraPointerLockActive() { return false; }
function idleGuidePointerDown() {}
function idleGuidePointerMove() {}
function idleGuidePointerUp() {}
function idleGuidePointerLeave() {}
function idleGuideWheel() {}
function tickGestureRotation(dt) {
  var d = Math.pow(0.001, Math.max(0, Number(dt) || 0.016));
  gestureRotation.x *= d; gestureRotation.y *= d; gestureRotation.vx *= d; gestureRotation.vy *= d;
}
function updateBeatCamera(dt) {
  var p = Math.pow(0.08, Math.max(0, Number(dt) || 0.016));
  beatCam.punch *= p;
  beatCam.thetaKick *= p; beatCam.phiKick *= p; beatCam.radiusKick *= p; beatCam.rollKick *= p;
}
function sampleAdaptiveFrameCost() { return null; }
function resetSkullPresetView() {}
function syncSkullParticleColors() {}
function destroyFloatLayer() {}
function refreshBackCoverColorsFromCanvas() {}
function refreshFloatColorsFromCover() {}
function showAIDepthChip() {}
function hideAIDepthChip() {}
function currentLyricFallbackText() { return song && song.name ? song.name : ''; }
function getAdjustedLyricPlaybackTime(t) { return __playbackSecondsOverride != null ? Math.max(0, Number(__playbackSecondsOverride)) : (Number(t) || 0) + __lyricTimeOffset; }
function isProgressDragPreviewActive() { return false; }
function getProgressDragPreviewSeconds() { return null; }
function currentAppliedLyricRenderSignature() { return ''; }
function songProviderKey(s) { return s && (s.id || s.mid || s.name) ? String(s.id || s.mid || s.name) : ''; }
function songCoverSrc(s) { return s && s.cover ? s.cover : ''; }
function shouldAvoidStageLyricsForShelf() { return false; }
function shouldUseWallpaperLyricCameraLock() { return false; }
function shouldDimWallpaperForShelf() { return false; }
function shouldOffsetLyricsForShelfDetail() { return false; }
function loadCoverFromUrl(url, opts) { if (url && typeof applyCoverCanvas === 'function') { var img = new Image(); img.crossOrigin = 'anonymous'; img.onload = function () { var cv = document.createElement('canvas'); cv.width = img.naturalWidth || 640; cv.height = img.naturalHeight || 640; cv.getContext('2d').drawImage(img, 0, 0); applyCoverCanvas(cv, '', opts || {}); }; img.src = url; } }
function applyCoverDataUrl(dataUrl, opts) { if (!dataUrl || typeof applyCoverCanvas !== 'function') return; var img = new Image(); img.onload = function () { var cv = document.createElement('canvas'); cv.width = img.naturalWidth || 640; cv.height = img.naturalHeight || 640; cv.getContext('2d').drawImage(img, 0, 0); applyCoverCanvas(cv, '', opts || {}); }; img.src = dataUrl; }
function normalizeLyricTranslationText(text) {
  text = normalizeStageLyricText(text);
  if (!text || isNoLyricText(text)) return '';
  return text;
}
function isNoLyricText(text) {
  var compact = String(text || '').replace(/\s+/g, '').replace(/[\uff0c\uff0c.\u3002!\uff01?\uff1f\u3001\uff5e\uff5e]/g, '');
  return !compact ||
    compact === '\u7eaf\u97f3\u4e50\u8bf7\u6b23\u8d4f' ||
    compact === '\u6682\u65e0\u6b4c\u8bcd' ||
    compact === '\u6682\u65e0\u6b4c\u8bcd\u656c\u8bf7\u671f\u5f85' ||
    compact === '\u6b64\u6b4c\u66f2\u4e3a\u6ca1\u6709\u586b\u8bcd\u7684\u7eaf\u97f3\u4e50\u8bf7\u60a8\u6b23\u8d4f';
}
function updateControlsAutoHideFromPointer() {}
function resetFrameGate() {}
function showToast() {}
function yieldToIdle() { return Promise.resolve(); }
function pipe(v) { return Promise.resolve(v); }
function ensureAudiblePlaybackGain() {}
function scheduleMainRendererViewportRefresh() {}
function updatePlaybackQualityUi() {}
function updateLyricTimingOffsetUi() {}
function updateSonicGroundColorControls() {}
function updateSonicWorkshopColorControls() {}
var coverProcessToken = 0;
var coverDepthCache = Object.create(null), coverDepthCacheKeys = [];

if (typeof window !== 'undefined') {
  window.MineradioSonicTopography = { isActive: function () { return false; }, pointerRipple: function () {} };
  window.MineradioSonicWorkshop = {};
}
`;

// ============================================================
// 拼接源码（保持 mineradio 原始加载顺序；function 声明会整体提升）
// ============================================================
const FX_INIT = String.raw`
// ---------------- fx 初始化（QinMusic 默认值，preset=2 星球模式） ----------------
var fx = Object.assign({}, fxDefaults, {
  preset: 0,
  color: 1.55,
  visualTintMode: 'custom',
  visualTintColor: '#9db8cf',
  particleLyrics: true,
  lyricDisplayMode: 'cinema',
  lyricTranslationMode: 'multi',
  lyricMotionStyle: 'float',
  lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowStrength: 0.45,
  lyricGlowParticles: true,
  lyricScale: 1.0,
  lyricCameraLock: false,
  lyricEdgeFade: 0.30,
  lyricContextOpacity: 0.5,
  lyricContextSpread: 1.6,
  lyricTranslationGap: 0.85,
  lyricTranslationScale: 0.68,
  lyricTranslationOpacity: 0.86,
  lyricWeight: 700,
  lyricTextureClarity: 1.25,
  performanceQuality: 'eco',
  aiDepth: false,
  backgroundColorMode: 'cover',
  backgroundOpacity: 1,
  coverResolution: 1.55
});
`;

const SOURCES = [
  MR_SOURCES[0],
  MR_SOURCES[1],
  FX_INIT,
  MR_SOURCES[2],
  MR_SOURCES[3],
  MR_SOURCES[4],
  MR_SOURCES[5],
  MR_SOURCES[6],
  MR_SOURCES[7],
  MR_SOURCES[8],
  MR_SOURCES[9],
  MR_SOURCES[10],
  MR_SOURCES[11],
  MR_SOURCES[12],
  MR_SOURCES[13],
  MR_SOURCES[14],
  MR_SOURCES[15],
  MR_SOURCES[16],
  MR_SOURCES[17],
  MR_SOURCES[18],
  MR_SOURCES[19],
  MR_SOURCES[20],
  MR_SOURCES[21],
  MR_SOURCES[22],
  MR_SOURCES[23],
  MR_SOURCES[24],
  MR_SOURCES[24],].join('\n\n');

// ============================================================
// 导出 API（闭包捕获所有 var 声明）
// ============================================================
const EXPORT = String.raw`
// ---------------- QinMusic export bridge ----------------
function __setAudio(a) { audio = a || null; }
var __lastPlayingState = null;
function __setPlaying(v) {
  playing = !!v;
  if (playing === __lastPlayingState) return;
  __lastPlayingState = playing;
  if (typeof tweenParticleAlpha === 'function') {
    tweenParticleAlpha(uniforms.uAlpha.value || 0, playing ? 1.0 : 0.96, playing ? 260 : 920);
  }
}
function __setSong(s) {
  song = s || { id: '', name: '', artist: '', cover: '' };
  // Sonic Workshop 通过 playQueue/playlist 读取当前歌曲与封面
  if (typeof window !== 'undefined') {
    try {
      window.playQueue = [song];
      window.playlist = [song];
      window.currentIdx = 0;
    } catch (e) { /* ignore */ }
  }
}
function __setLines(lines) {
  lyricsLines = Array.isArray(lines) ? lines : [];
  lyricsHasNativeKaraoke = lyricsLines.some(function (l) { return l && Array.isArray(l.words) && l.words.length; });
}
function __setTranslationLines(t) { lyricsTranslationLines = Array.isArray(t) ? t : []; }
function __setTimeOffset(v) { __lyricTimeOffset = Number(v) || 0; }
function __setPlaybackSeconds(v) { __playbackSecondsOverride = (v == null || !isFinite(Number(v))) ? null : Math.max(0, Number(v)); }
function __setAnalysis(a) {
  if (!a) return;
  var t = Number(a.t) || 0;
  var ab = clampRange((Number(a.bass) || 0) * __qinAudioSens, 0, 1.6);
  var am = clampRange((Number(a.mid) || 0) * __qinAudioSens, 0, 1.6);
  var at = clampRange((Number(a.treble) || 0) * __qinAudioSens, 0, 1.6);
  var abt = clampRange((Number(a.beat) || 0) * __qinAudioSens, 0, 1.6);
  var ae = clampRange((Number(a.energy) || 0) * __qinAudioSens, 0, 1.6);
  var abu = clampRange((Number(a.burst) || 0) * __qinAudioSens, 0, 1);
  var alow = clampRange((Number(a.lowMid) || 0) * __qinAudioSens, 0, 1.6);
  var avoc = clampRange((Number(a.vocal) || 0) * __qinAudioSens, 0, 1.6);
  if (uniforms) {
    uniforms.uBass.value = ab;
    uniforms.uMid.value = am;
    uniforms.uTreble.value = at;
    uniforms.uBeat.value = abt;
    uniforms.uEnergy.value = ae;
    uniforms.uBurstAmt.value = abu;
  }
  // ?????????updateRipples / ?? / ???? / ????????
  beatPulse = abt;
  bass = ab;
  mid = am;
  treble = at;
  audioEnergy = ae;
  lowMidBand = alow;
  vocalBand = avoc;
  lyricSunEnergy = Math.max(lyricSunEnergy, ae * 0.9);
  lyricSunEnergy += (ae - lyricSunEnergy) * 0.18;
  beatCam.punch = abt * 0.7 + ab * 0.3;
  beatCam.radiusKick = abt * 0.55 + ab * 0.25;
  beatCam.thetaKick = Math.sin(t * 1.7) * abt * 0.14;
  beatCam.phiKick = Math.cos(t * 2.1) * abt * 0.12;
  beatCam.rollKick = Math.sin(t * 2.6 + 1.2) * abt * 0.10;
}
function __setStageParams(p) {
  p = p || {};
  try {
    if (fx && typeof syncFxUniforms === 'function') {
      if (p.point != null) fx.point = layoutNumber(p.point, fxDefaults.point, 0.5, 2.2);
      if (p.speed != null) fx.speed = layoutNumber(p.speed, fxDefaults.speed, 0.2, 2.5);
      if (p.twist != null) fx.twist = layoutNumber(p.twist, fxDefaults.twist, 0, 0.6);
      if (p.color != null) fx.color = layoutNumber(p.color, fxDefaults.color, 0.5, 2.0);
      if (p.scatter != null) fx.scatter = layoutNumber(p.scatter, fxDefaults.scatter, 0, 0.5);
      if (p.bgFade != null) fx.bgFade = layoutNumber(p.bgFade, fxDefaults.bgFade, 0, 1.2);
      if (p.bloom != null) fx.bloom = !!p.bloom;
      if (p.bloomStrength != null) fx.bloomStrength = layoutNumber(p.bloomStrength, fxDefaults.bloomStrength, 0, 1.6);
      syncFxUniforms();
    }
    if (p.density != null && typeof applyCoverParticleResolution === 'function') {
      applyCoverParticleResolution(Number(p.density) || fx.coverResolution, { silent: true });
    }
    if (p.zoom != null && orbit) {
      orbit.userRadius = Math.max(orbit.minRadius, Math.min(orbit.maxRadius, Number(p.zoom) || orbit.userRadius));
      if (orbit.recentering) orbit.recentering = false;
    }
    if (p.lyricFollow != null) __qinLyricFollow = p.lyricFollow ? 1 : 0;
    if (p.spinSens != null) __qinSpinSens = Math.max(0.2, Math.min(3, Number(p.spinSens) || 1));
    if (p.mousePush != null) __qinMousePush = Math.max(0, Math.min(2, Number(p.mousePush) || 0));
    if (p.audioSens != null) __qinAudioSens = Math.max(0.2, Math.min(2.5, Number(p.audioSens) || 1));
    if (p.timeScale != null) __qinTimeScale = Math.max(0.3, Math.min(3, Number(p.timeScale) || 1));
  } catch (err) { if (typeof console !== 'undefined') console.warn('stage params:', err && err.message); }
}
var __frameSample = { tickCount: 0, renderCount: 0, center: [0,0,0,0], p40: [0,0,0,0], lit: 0, lastErr: '' };
var __debugSampling = (typeof window !== 'undefined' && window.location && /[?&]demo=1/.test(window.location.search));
function __sampleFrame() {
  if (!__debugSampling) return;
  try {
    var gl = renderer.getContext();
    var dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight;
    if (!dw || !dh) return;
    var px = new Uint8Array(4);
    gl.readPixels(Math.floor(dw / 2), Math.floor(dh * 0.4), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    __frameSample.p40 = Array.from(px);
    gl.readPixels(Math.floor(dw / 2), Math.floor(dh / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    __frameSample.center = Array.from(px);
    var lit = 0, n = 0;
    var buf = new Uint8Array(dw * dh * 4);
    gl.readPixels(0, 0, dw, dh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (var i = 0; i < buf.length; i += 16) {
      var mx = Math.max(buf[i], buf[i+1], buf[i+2]);
      if (mx > 60) lit++;
      n++;
    }
    __frameSample.lit = n ? lit / n : 0;
    var gw = 96, gh = 40, grid = [];
    var chars = ' .:-=+*#%@';
    for (var gy = 0; gy < gh; gy++) {
      var row = '';
      for (var gx = 0; gx < gw; gx++) {
        var x0 = Math.floor((gx / gw) * dw), y0 = Math.floor((gy / gh) * dh);
        var o = ((dh - 1 - y0) * dw + x0) * 4;
        var mx = Math.max(buf[o], buf[o+1], buf[o+2]);
        row += chars[Math.min(9, Math.floor(mx * 10 / 256))];
      }
      grid.push(row);
    }
    __frameSample.grid = grid.join('|');
  } catch (e) { __frameSample.lastErr = String(e && e.message || e); }
}
var __fpsStats = { last: performance.now(), frames: 0, raf: 0 };
function __tick(dt) {
  var now = performance.now();
  __fpsStats.frames++;
  if (now - __fpsStats.last >= 1000) {
    __fpsStats.raf = Math.round(__fpsStats.frames * 1000 / (now - __fpsStats.last));
    __fpsStats.frames = 0;
    __fpsStats.last = now;
    if (__debugSampling && typeof console !== 'undefined') console.warn('[perf] fps=' + __fpsStats.raf + ' pcount=' + (typeof PCOUNT !== 'undefined' ? PCOUNT : '?'));
  }
  var step = isFinite(Number(dt)) && Number(dt) > 0 ? Math.min(Number(dt), 0.05) : 0.016;
  __frameSample.tickCount++;
  if (uniforms && uniforms.uTime) uniforms.uTime.value += step * (Number(__qinTimeScale) > 0 ? Number(__qinTimeScale) : 1);
  if (typeof updateParticlePointerFrame === 'function') updateParticlePointerFrame();
  if (uniforms && uniforms.uMouseXY && typeof mouseWorld !== 'undefined') {
    uniforms.uMouseXY.value.set(mouseWorld.x, mouseWorld.y);
    uniforms.uMouseActive.value = mouseActive ? clamp01(Number(__qinMousePush) || 1) : 0;
  }
  // 鼠标视差：粒子群跟随指针平滑倾斜（空间位置随鼠标移动变化）
  if (mouseActive) {
    pointerParallax.x += (pointerTarget.x - pointerParallax.x) * 0.08;
    pointerParallax.y += (pointerTarget.y - pointerParallax.y) * 0.08;
  } else {
    pointerParallax.x *= 0.93;
    pointerParallax.y *= 0.93;
  }

  // ---- Mineradio ?????????? 11-main-loop.js?----
  var skullPresetActive = fx && fx.preset === SKULL_PRESET_INDEX;
  var workshopPresetActive = window.MineradioSonicWorkshop && typeof MineradioSonicWorkshop.isActive === 'function' && MineradioSonicWorkshop.isActive(fx);
  var presetUsesStarRiverParticles = fx && (Number(fx.preset) === 5 || (typeof SONIC_PRESET_INDEX !== 'undefined' && Number(fx.preset) === SONIC_PRESET_INDEX));
  var presetStarRiverMuted = presetUsesStarRiverParticles && fx.backgroundStarRiver === false;
  if (particles) particles.visible = !skullPresetActive && !workshopPresetActive && !presetStarRiverMuted;
  if (bloomParticles) bloomParticles.visible = !skullPresetActive && !workshopPresetActive && !presetStarRiverMuted && fx.bloom && fx.bloomStrength > 0.01;
  if (floatGroup) floatGroup.visible = !skullPresetActive && !workshopPresetActive;
  if (backCoverGroup) backCoverGroup.visible = !skullPresetActive && !workshopPresetActive;
  var targetRotY = orbit.centerLocked ? 0 : (headParallax.active ? headParallax.x * 0.5 : 0) + pointerParallax.x * 0.34 + gestureRotation.y;
  var targetRotX = orbit.centerLocked ? 0 : (headParallax.active ? -headParallax.y * 0.35 : 0) - pointerParallax.y * 0.24 + gestureRotation.x;
  if (particles) {
    particles.rotation.y += (targetRotY - particles.rotation.y) * 0.055;
    particles.rotation.x += (targetRotX - particles.rotation.x) * 0.055;
  }
  if (bloomParticles) bloomParticles.rotation.copy(particles.rotation);
  if (floatGroup) floatGroup.rotation.copy(particles.rotation);
  if (backCoverGroup) backCoverGroup.rotation.copy(particles.rotation);

  if (typeof updateRipples === 'function') updateRipples(step);
  if (typeof updateFloatLayer === 'function') updateFloatLayer(step);
  if (typeof tickLyricsParticles === 'function') tickLyricsParticles();
  if (typeof updateCinema === 'function') updateCinema(step);
  if (typeof updateFreeCamera === 'function') updateFreeCamera(step);
  if (typeof updateCamera === 'function') updateCamera();
  if (typeof applySkullCameraPose === 'function') applySkullCameraPose(step);
  if (typeof tickGestureRotation === 'function') tickGestureRotation(step);
  if (typeof updateSkullParticleLayer === 'function') updateSkullParticleLayer(step);
  if (window.MineradioSonicTopography && typeof MineradioSonicTopography.update === 'function') {
    try {
      MineradioSonicTopography.update(step, {
        scene: scene, fx: fx, time: uniforms.uTime.value,
        screenHeight: innerHeight, dpr: renderer.getPixelRatio ? renderer.getPixelRatio() : 1,
        visualRotation: particles ? particles.rotation : null,
        visualRotationActive: !!(orbit && orbit.rotating),
        audio: {
        bass: bass, mid: mid, treble: treble, beat: beatPulse, energy: audioEnergy,
        subBass: clamp01(bass * 0.75 + beatPulse * 0.5),
        lowMid: lowMidBand,
        highMid: clamp01(vocalBand * 0.62 + treble * 0.38),
        presence: vocalBand,
        brilliance: clamp01(treble * 0.72 + vocalBand * 0.28),
        air: treble
      }
      });
    } catch (err) { if (__frameSample.tickCount % 300 === 1 && typeof console !== 'undefined') console.warn('sonic topo:', err); }
  }
  if (window.MineradioSonicWorkshop && typeof MineradioSonicWorkshop.update === 'function') {
    try {
      MineradioSonicWorkshop.update(step, {
        scene: scene, fx: fx, time: uniforms.uTime.value,
        audio: {
        bass: bass, mid: mid, treble: treble, beat: beatPulse, energy: audioEnergy,
        subBass: clamp01(bass * 0.75 + beatPulse * 0.5),
        lowMid: lowMidBand,
        highMid: clamp01(vocalBand * 0.62 + treble * 0.38),
        presence: vocalBand,
        brilliance: clamp01(treble * 0.72 + vocalBand * 0.28),
        air: treble
      }
      });
    } catch (err) { if (__frameSample.tickCount % 300 === 1 && typeof console !== 'undefined') console.warn('sonic workshop:', err); }
  }
  if (typeof updateStageLyrics3D === 'function') updateStageLyrics3D(step);
  // 歌词跟手：自由漂浮模式下随鼠标轻微平移（叠加在粒子跟随之上）
  var qinOffX = 0, qinOffY = 0;
  if (stageLyrics && stageLyrics.group && fx && __qinLyricFollow > 0 && !fx.lyricCameraLock) {
    var followMag = Math.abs(pointerParallax.x) + Math.abs(pointerParallax.y);
    if (mouseActive || followMag > 0.02) {
      qinOffX = pointerParallax.x * 0.55;
      qinOffY = -pointerParallax.y * 0.46;
      stageLyrics.group.position.x += qinOffX;
      stageLyrics.group.position.y += qinOffY;
      stageLyrics.group.position.z += Math.abs(pointerParallax.y) * 0.10;
      __qinFollowEuler.set(pointerParallax.y * -0.07, 0, pointerParallax.x * -0.09);
      __qinFollowQuat.setFromEuler(__qinFollowEuler);
      stageLyrics.group.quaternion.multiply(__qinFollowQuat);
    }
  }
  __qinLyricFollowOff.x = qinOffX;
  __qinLyricFollowOff.y = qinOffY;
  if (typeof updateBackgroundStarRiverState === 'function') updateBackgroundStarRiverState(step, false);
  if (typeof tickPresetTransition === 'function') tickPresetTransition();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
    __frameSample.renderCount++;
    if (__frameSample.tickCount % 10 === 0) __sampleFrame();
  }
}
function __resize(w, h) {
  w = Math.max(64, Number(w) || innerWidth);
  h = Math.max(64, Number(h) || innerHeight);
  if (renderer) renderer.setSize(w, h);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (uniforms && uniforms.uPixel) uniforms.uPixel.value = renderer ? renderer.getPixelRatio() : 1;
  if (uniforms && uniforms.uViewH) uniforms.uViewH.value = h || innerHeight;
}
function __setHue(h) {
  var hue = (Number(h) || 210) % 360;
  var c1 = hslToRgb(hue / 360, 0.86, 0.70);
  var c2 = hslToRgb(((hue + 46) % 360) / 360, 0.92, 0.72);
  var hi = hslToRgb(((hue + 16) % 360) / 360, 0.96, 0.88);
  var pal = {
    primary: rgbCss(c1),
    secondary: rgbCss(c2),
    highlight: rgbCss(hi),
    shadow: 'rgba(2,8,12,0.42)',
    glow: 'rgba(' + c1.r + ',' + c1.g + ',' + c1.b + ',0.34)',
    glowColor: rgbCss(c2)
  };
  if (typeof setStageLyricPalette === 'function') setStageLyricPalette(pal, { immediate: true, durationMs: 1 });
  else if (stageLyrics) stageLyrics.palette = pal;
  if (fx) fx.visualTintColor = rgbCss(c1);
  if (uniforms && uniforms.uTintColor) uniforms.uTintColor.value.set(rgbCss(c1));
  if (uniforms && uniforms.uTintStrength) uniforms.uTintStrength.value = 0; // 封面粒子保持封面本色，不施加色相染色
}
function __showIndex(idx) {
  idx = Math.max(0, Math.round(Number(idx) || 0));
  if (lyricsLines && lyricsLines[idx]) {
    if (typeof scheduleStageLyricFullTrackWarmup === 'function') scheduleStageLyricFullTrackWarmup('track-ready-fast', 120);
    if (typeof requestStageLyricWarmup === 'function') requestStageLyricWarmup('playback-started', 90);
  }
  var p = (typeof buildStageLyricPlaybackPayload === 'function') ? buildStageLyricPlaybackPayload(idx) : null;
  if (p) showStageLine(p);
  else if (lyricsLines && lyricsLines[idx]) showStageLine(lyricsLines[idx]);
}
function __applyCover(imgOrCanvas) {
  if (!imgOrCanvas || typeof applyCoverCanvas !== 'function') return;
  var cv = null;
  if (typeof HTMLCanvasElement !== 'undefined' && imgOrCanvas instanceof HTMLCanvasElement) cv = imgOrCanvas;
  else if (typeof ImageBitmap !== 'undefined' && imgOrCanvas instanceof ImageBitmap) {
    cv = document.createElement('canvas');
    cv.width = imgOrCanvas.width || 640; cv.height = imgOrCanvas.height || 640;
    cv.getContext('2d').drawImage(imgOrCanvas, 0, 0);
  } else if (imgOrCanvas && imgOrCanvas.tagName === 'IMG') {
    cv = document.createElement('canvas');
    cv.width = imgOrCanvas.naturalWidth || imgOrCanvas.width || 640;
    cv.height = imgOrCanvas.naturalHeight || imgOrCanvas.height || 640;
    cv.getContext('2d').drawImage(imgOrCanvas, 0, 0);
  }
  if (!cv) return;
  try {
    currentCoverSource = { kind: 'data', src: 'qin-cover' };
    applyCoverCanvas(cv, '', { trackToken: trackSwitchToken, noCoverTransition: true });
    if (uniforms) uniforms.uHasCover.value = 1;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('MrStage cover failed:', err);
  }
}
function __clear() {
  if (typeof clearStageLyrics === 'function') clearStageLyrics();
  if (typeof disposeLyricsParticles === 'function') disposeLyricsParticles();
  if (typeof disposeLyricStarRiver === 'function') disposeLyricStarRiver();
}
function __getLines() { return lyricsLines; }
function __getCurrentIndex() { return stageLyrics ? stageLyrics.currentIdx : -1; }
function __getCurrentText() { return stageLyrics ? stageLyrics.currentText : ''; }
function __samplePixels(cols, rows) {
  cols = Math.max(4, Math.min(80, Number(cols) || 32));
  rows = Math.max(3, Math.min(40, Number(rows) || 18));
  try {
    var gl = renderer.getContext();
    var dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight;
    if (!dw || !dh) return null;
    var out = [];
    var px = new Uint8Array(4);
    for (var r = 0; r < rows; r++) {
      var row = [];
      var y = Math.round((r + 0.5) / rows * dh);
      for (var c = 0; c < cols; c++) {
        var x = Math.round((c + 0.5) / cols * dw);
        try { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); row.push([px[0], px[1], px[2]]); }
        catch (e) { row.push([0, 0, 0]); }
      }
      out.push(row);
    }
    return out;
  } catch (e) { return { err: String(e && e.message || e) }; }
}

function __getDebug() {
  var info = {
    currentIdx: stageLyrics ? stageLyrics.currentIdx : -1,
    currentText: stageLyrics ? stageLyrics.currentText : '',
    lineCount: lyricsLines ? lyricsLines.length : 0,
    hasStageLyrics: !!stageLyrics,
    hasParticleLyrics: !!(stageLyrics && stageLyrics.group),
    canvasW: renderer ? renderer.domElement.width : 0,
    canvasH: renderer ? renderer.domElement.height : 0,
    pixelRatio: renderer ? renderer.getPixelRatio() : 0,
    lyricDisplayMode: fx ? fx.lyricDisplayMode : '',
    preset: fx ? fx.preset : -1,
    uHasCover: (typeof uniforms !== 'undefined' && uniforms && uniforms.uHasCover) ? uniforms.uHasCover.value : -1,
    uAlpha: (typeof uniforms !== 'undefined' && uniforms && uniforms.uAlpha) ? uniforms.uAlpha.value : -1,
    uPixel: (typeof uniforms !== 'undefined' && uniforms && uniforms.uPixel) ? uniforms.uPixel.value : -1,
    uPointScale: (typeof uniforms !== 'undefined' && uniforms && uniforms.uPointScale) ? uniforms.uPointScale.value : -1,
    uColorBoost: (typeof uniforms !== 'undefined' && uniforms && uniforms.uColorBoost) ? uniforms.uColorBoost.value : -1,
    uCoverRes: (typeof uniforms !== 'undefined' && uniforms && uniforms.uCoverRes) ? uniforms.uCoverRes.value : -1,
    uBgFade: (typeof uniforms !== 'undefined' && uniforms && uniforms.uBgFade) ? uniforms.uBgFade.value : -1,
    uTintStrength: (typeof uniforms !== 'undefined' && uniforms && uniforms.uTintStrength) ? uniforms.uTintStrength.value : -1,
    uBloomStrength: (typeof uniforms !== 'undefined' && uniforms && uniforms.uBloomStrength) ? uniforms.uBloomStrength.value : -1,
    uBass: (typeof uniforms !== 'undefined' && uniforms && uniforms.uBass) ? uniforms.uBass.value : -1,
    uBurstAmt: (typeof uniforms !== 'undefined' && uniforms && uniforms.uBurstAmt) ? uniforms.uBurstAmt.value : -1,
    uLoading: (typeof uniforms !== 'undefined' && uniforms && uniforms.uLoading) ? uniforms.uLoading.value : -1,
    uHasDepth: (typeof uniforms !== 'undefined' && uniforms && uniforms.uHasDepth) ? uniforms.uHasDepth.value : -1,
    uParticleDim: (typeof uniforms !== 'undefined' && uniforms && uniforms.uParticleDim) ? uniforms.uParticleDim.value : -1,
    uColorMixT: (typeof uniforms !== 'undefined' && uniforms && uniforms.uColorMixT) ? uniforms.uColorMixT.value : -1,
    uViewH: (typeof uniforms !== 'undefined' && uniforms && uniforms.uViewH) ? uniforms.uViewH.value : -1,
    grid: (typeof GRID_X !== 'undefined' && GRID_X) ? GRID_X + 'x' + (GRID_Y || GRID_X) : '',
    pcount: (typeof PCOUNT !== 'undefined') ? PCOUNT : -1,
    planeSize: (typeof PLANE_SIZE !== 'undefined') ? PLANE_SIZE : -1,
    camPos: (typeof camera !== 'undefined' && camera) ? [Math.round(camera.position.x * 100) / 100, Math.round(camera.position.y * 100) / 100, Math.round(camera.position.z * 100) / 100] : null,
    camFov: (typeof camera !== 'undefined' && camera) ? Math.round(camera.fov * 100) / 100 : null,
    camLookAt: (typeof camera !== 'undefined' && camera) ? (function(){ try { var v = new THREE.Vector3(); camera.getWorldDirection(v); return [Math.round(v.x*100)/100, Math.round(v.y*100)/100, Math.round(v.z*100)/100]; } catch(e){ return null; } })() : null,
    particleRot: (typeof particles !== 'undefined' && particles && particles.rotation) ? [Math.round(particles.rotation.x*1000)/1000, Math.round(particles.rotation.y*1000)/1000, Math.round(particles.rotation.z*1000)/1000] : null,
    geoBounds: (function(){ try { var g = (typeof particles !== 'undefined' && particles && particles.geometry) ? particles.geometry : null; if (!g) return null; var p = g.attributes.position; if (!p) return null; var mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9]; for (var i=0;i<p.count;i++){ for(var k=0;k<3;k++){ var v=p.getX? (k===0?p.getX(i):(k===1?p.getY(i):p.getZ(i))) : p.array[i*3+k]; if (v<mn[k]) mn[k]=v; if (v>mx[k]) mx[k]=v; } } return { count: p.count, min: mn, max: mx }; } catch(e){ return {err:String(e&&e.message||e)}; } })(),
    coverSrc: (typeof currentCoverSource !== 'undefined' && currentCoverSource) ? String(currentCoverSource.src).slice(0, 60) : '',
    coverTexReady: (typeof coverTex !== 'undefined' && coverTex && coverTex.image) ? true : false,
    coverSize: (typeof coverTex !== 'undefined' && coverTex && coverTex.image) ? (coverTex.image.width || 0) + 'x' + (coverTex.image.height || 0) : 'none',
    coverUrl: (typeof currentCoverSource !== 'undefined' && currentCoverSource) ? String(currentCoverSource.src || '').slice(0, 80) : '',
    coverPalette: (function () { try { var p = (typeof stageLyrics !== 'undefined' && stageLyrics) ? (stageLyrics.coverPalette || stageLyrics.palette) : null; if (!p) return null; return { primary: p.primary || '', secondary: p.secondary || '', highlight: p.highlight || '', rawPrimary: p.rawPrimary || '', rawAverage: p.rawAverage || '', rawLight: p.rawLight || '', rawAreaPrimary: p.rawAreaPrimary || '' }; } catch (e) { return { err: String(e && e.message || e) }; } })(),
    coverPixels: (function () {
      try {
        var ci = (typeof coverTex !== 'undefined' && coverTex && coverTex.image) ? coverTex.image : null;
        if (!ci || !ci.getContext) return null;
        var w = ci.width || 0, h = ci.height || 0;
        if (!w || !h) return null;
        var g = ci.getContext('2d');
        var px = function (x, y) { var d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
        return {
          w: w, h: h,
          center: px(Math.floor(w / 2), Math.floor(h / 2)),
          tl: px(2, 2),
          tr: px(w - 3, 2),
          bl: px(2, h - 3),
          br: px(w - 3, h - 3)
        };
      } catch (e) { return { err: String(e && e.message || e) }; }
    })()
  };
  try {
    info.tickCount = __frameSample.tickCount;
    info.renderCount = __frameSample.renderCount;
    info.litRatio = __frameSample.lit;
    info.centerPixel = __frameSample.center;
    info.pixelAt40pct = __frameSample.p40;
    info.sampleErr = __frameSample.lastErr;
    info.grid = __frameSample.grid;
    info.fps = __fpsStats.raf;
  } catch (e) { info.pixelErr = String(e && e.message || e); }
  return info;
}
return {
  setAudio: __setAudio,
  setPlaying: __setPlaying,
  setSong: __setSong,
  setLines: __setLines,
  setTranslationLines: __setTranslationLines,
  setTimeOffset: __setTimeOffset,
  setPlaybackSeconds: __setPlaybackSeconds,
  setAnalysis: __setAnalysis,
  tick: __tick,
  resize: __resize,
  setHue: __setHue,
  showStageLine: showStageLine,
  showIndex: __showIndex,
  applyCover: __applyCover,
  applyCoverDataUrl: applyCoverDataUrl,
  clear: __clear,
  getLines: __getLines,
  getCurrentIndex: __getCurrentIndex,
  getCurrentText: __getCurrentText,
  getRenderer: function () { return renderer; },
  getCamera: function () { return camera; },
  getStageLyrics: function () { return stageLyrics; },
  samplePixels: __samplePixels,  getDebug: __getDebug,
  createLyricsParticles: createLyricsParticles,
  setPreset: function (p, opts) { if (typeof setPreset === 'function') setPreset(p, opts || {}); },
  getPreset: function () { return fx ? fx.preset : -1; },
  getPresetCount: function () { return presetMeta ? presetMeta.length : 0; },
  getPresetMeta: function () { return presetMeta ? presetMeta.map(function (p) { return { name: p.name, desc: p.desc }; }) : []; },
  getFx: function () { return fx || null; },
  setFx: function (patch) { if (!fx || !patch) return; Object.keys(patch).forEach(function (k) { fx[k] = patch[k]; }); if (typeof syncFxUniforms === 'function') syncFxUniforms(); },
  setStageParams: function (p) { if (typeof __setStageParams === 'function') __setStageParams(p || {}); },
  getDiag: function () {
    return {
      preset: fx ? fx.preset : -1,
      fx: fx ? { point: fx.point, speed: fx.speed, twist: fx.twist, color: fx.color, scatter: fx.scatter, bloom: !!fx.bloom, bloomStrength: fx.bloomStrength, coverResolution: fx.coverResolution } : null,
      pcount: typeof PCOUNT !== 'undefined' ? PCOUNT : -1,
      grid: typeof GRID_X !== 'undefined' ? GRID_X : -1,
      orbit: orbit ? { userRadius: orbit.userRadius, userTheta: orbit.userTheta, userPhi: orbit.userPhi, rotating: orbit.rotating } : null,
      mouseActive: typeof mouseActive !== 'undefined' ? !!mouseActive : null,
      mouseWorld: (typeof mouseWorld !== 'undefined' && mouseWorld) ? [Number(mouseWorld.x.toFixed(3)), Number(mouseWorld.y.toFixed(3))] : null,
      gestureRotation: gestureRotation ? [Number(gestureRotation.x.toFixed(4)), Number(gestureRotation.y.toFixed(4))] : null,
      uMouse: (uniforms && uniforms.uMouseXY && uniforms.uMouseActive) ? [uniforms.uMouseXY.value.x, uniforms.uMouseXY.value.y, uniforms.uMouseActive.value] : null,
      spin: particleSpin ? [Number(particleSpin.vx.toFixed(4)), Number(particleSpin.vy.toFixed(4))] : null,
      particlesRot: particles ? [Number(particles.rotation.x.toFixed(3)), Number(particles.rotation.y.toFixed(3))] : null,
      lyricLock: fx ? !!fx.lyricCameraLock : null,
      lyricFollow: typeof __qinLyricFollow !== 'undefined' && __qinLyricFollow > 0,
      lyricFollowOff: (typeof __qinLyricFollowOff !== 'undefined' && __qinLyricFollowOff) ? [Number(__qinLyricFollowOff.x.toFixed(3)), Number(__qinLyricFollowOff.y.toFixed(3))] : null,
      lyricsRot: (typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group) ? [Number(stageLyrics.group.rotation.x.toFixed(3)), Number(stageLyrics.group.rotation.y.toFixed(3)), Number(stageLyrics.group.rotation.z.toFixed(3))] : null,
      camera: camera ? [Number(camera.position.x.toFixed(3)), Number(camera.position.y.toFixed(3)), Number(camera.position.z.toFixed(3))] : null,
      rayProbe: (function () {
        try {
          var out = new THREE.Vector3();
          var hit = particleLocalPointFromNdc(0, 0, out);
          return { hit: !!hit, x: Number(out.x.toFixed(3)), y: Number(out.y.toFixed(3)), z: Number(out.z.toFixed(3)) };
        } catch (e) { return { err: String(e && e.message || e) }; }
      })()
    };
  },
  recenterCamera: function () { if (typeof recenterCamera === 'function') recenterCamera(); },
  setLyricCameraLock: function (v) { if (fx) fx.lyricCameraLock = !!v; }
};
`;

// ============================================================
// 工厂：new Function 保证 var/function 共享同一作用域
// ============================================================
function buildMrApi() {
  const factory = new Function('THREE', 'window', 'document', 'performance', 'SKULL_POINTS_B64', SHIM + '\n' + SOURCES + '\n' + EXPORT);
  return factory(THREE, window, document, performance, SKULL_POINTS_B64);
}

// ============================================================
// 包装类（接口与旧版一致，app.js 无需改动驱动方式）
// ============================================================
export class MineradioStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.visible = false;
    this.hue = 210;
    this._song = null;
    this._coverUrl = '';
    this._coverLoading = false;
    this._metaRef = null;
    this._lines = [];
    this._trans = [];
    this._api = buildMrApi();
    this._api.setAudio(document.getElementById('audio') || null);
    this._api.setPlaying(false);
    this._api.setLines([]);
    this._api.setHue(this.hue);
    this._api.createLyricsParticles();
    this._onResize = () => { if (this.visible) this._api.resize(innerWidth, innerHeight); };
    window.addEventListener('resize', this._onResize);
    this._api.resize(innerWidth, innerHeight);
  }

  setVisible(v) {
    v = !!v;
    if (v === this.visible) return;
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
    if (this._api) {
      if (v) this._api.resize(innerWidth, innerHeight);
      const audioEl = typeof document !== 'undefined' ? document.getElementById('audio') : null;
      this._api.setPlaying(v && !!audioEl && !audioEl.paused);
    }
  }

  setHue(h1) {
    this.hue = Number(h1) || 210;
    if (this._api) this._api.setHue(this.hue);
  }

  setPreset(p, opts) {
    if (this._api && this._api.setPreset) this._api.setPreset(Number(p) || 0, opts || {});
  }

  setParams(params) {
    if (this._api && this._api.setStageParams) this._api.setStageParams(params || {});
  }

  getDiag() {
    if (!this._api || typeof this._api.getDiag !== 'function') return null;
    try { return this._api.getDiag(); } catch (e) { return { error: String(e && e.message || e) }; }
  }

  getPreset() {
    return this._api ? this._api.getPreset() : 0;
  }

  getPresetMeta() {
    return this._api ? this._api.getPresetMeta() : [];
  }

  // 由 app.js 切行时调用：同步歌词 + 显示对应行
  buildLine(meta) {
    if (!meta) return;
    this._syncLines();
    const idx = this._lines.findIndex((l) => l && l.text === meta.text);
    this._api.setPlaying(true);
    if (idx >= 0) this._api.showIndex(idx);
    else this._api.showStageLine(this._lineFromMeta(meta));
  }

  syncSong(song) {
    if (!song) return;
    if (this._song === song) return;
    this._song = song;
    this._api.setSong({ id: song.id, name: song.name, artist: song.artist, cover: song.cover || '' });
  }

  setCoverData(dataUrl, url) {
    if (!dataUrl) return;
    if (url) this._coverUrl = url;
    this._coverLoading = false;
    if (this._api) this._api.applyCoverDataUrl(dataUrl);
  }

  setCover(url) {
    if (!url || url === this._coverUrl) return;
    const cached = (typeof window !== 'undefined') && window.__coverDataCache;
    if (cached && cached.data && cached.url === url) {
      // 优先用主进程代理后的封面数据，绕开 CDN CORS 直连失败
      this._coverUrl = url;
      this._coverLoading = false;
      if (this._api) this._api.applyCoverDataUrl(cached.data);
      return;
    }
    this._coverUrl = url;
    if (this._coverLoading) return;
    this._coverLoading = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this._coverLoading = false;
      if (this._coverUrl === url && this._api) this._api.applyCover(img);
    };
    img.onerror = () => { this._coverLoading = false; };
    img.src = url;
  }

  update(t, dt, sec, beat, bass, chorus, vocal, mid, treble, lowMid, energy) {
    if (!this.visible || !this._api) return;
    if (this._song && this._song.cover && this._song.cover !== this._coverUrl) this.setCover(this._song.cover);
    this._api.setPlaybackSeconds(sec);
    this._api.setAnalysis({
      t: Number(t) || 0,
      bass: Number(bass) || 0,
      mid: Number(mid) || 0,
      treble: Number(treble) || 0,
      beat: Number(beat) || 0,
      energy: Math.max(Number(energy) || 0, Number(bass) || 0, (Number(beat) || 0) * 0.6),
      burst: Number(chorus) || 0,
      lowMid: Number(lowMid) || 0,
      vocal: Number(vocal) || 0
    });
    this._api.tick(Number(dt) || 0.016);
  }

  getDebug() {
    if (!this._api) return null;
    try { return this._api.getDebug(); } catch (e) { return { error: String(e && e.message || e) }; }
  }

  samplePixels(cols, rows) {
    if (!this._api || typeof this._api.samplePixels !== 'function') return { err: 'no api' };
    try { return this._api.samplePixels(cols, rows); } catch (e) { return { err: String(e && e.message || e) }; }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this._api) {
      this._api.setPlaying(false);
      this._api.clear();
    }
  }

  // ---- 内部 ----
  _syncLines() {
    const meta = window.__qinLyricMeta;
    if (!meta || meta === this._metaRef) return;
    this._metaRef = meta;
    this._lines = meta.map((m) => this._lineFromMeta(m));
    this._trans = meta.map((m) => (m.trans ? { t: m.time, text: m.trans } : null)).filter(Boolean);
    this._api.setLines(this._lines);
    this._api.setTranslationLines(this._trans);
  }

  _lineFromMeta(meta) {
    const words = [];
    const chars = meta.chars && meta.chars.length ? meta.chars : null;
    if (chars && chars.length) {
      let c0 = 0;
      for (const ch of chars) {
        const start = Number(ch.start) || 0;
        const end = Number(ch.end) || (start + 0.3);
        words.push({ text: String(ch.ch || ''), t: start, d: Math.max(0.06, end - start), c0, c1: c0 + 1 });
        c0 += 1;
      }
    }
    const text = String(meta.text || '');
return {
      t: Number(meta.time) || 0,
      duration: Math.max(0.8, (Number(meta.end) || (Number(meta.time) || 0) + 4) - (Number(meta.time) || 0)),
      text,
      words,
      charCount: Math.max(1, text.length),
      translation: meta.trans || undefined
    };
  }
}
