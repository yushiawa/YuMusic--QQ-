if (localStorage.getItem('qin-ark-theme') === '1') document.body.classList.add('ark-theme');
try {
  const bg = JSON.parse(localStorage.getItem('qin-bg-settings') || '{}');
  if (bg.btnStyle) document.body.dataset.btnStyle = bg.btnStyle;
} catch (err) { /* 忽略 */ }
const $ = (id) => document.getElementById(id);
const titleEl = $('title'), artistEl = $('artist'), coverEl = $('cover');
const lyricText = $('lyricText'), lyricFill = $('lyricFill'), transEl = $('trans'), barFill = $('barFill');

// 拖拽移动（无边框窗口）
let dragging = false, offX = 0, offY = 0;
const wrap = document.getElementById('wrap');
wrap.addEventListener('mousedown', (e) => {
  dragging = true; offX = e.screenX - window.screenX; offY = e.screenY - window.screenY;
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  window.moveTo(e.screenX - offX, e.screenY - offY);
});
window.addEventListener('mouseup', () => { dragging = false; });

// 双击关闭
wrap.addEventListener('dblclick', () => {
  window.lyricApi.close();
});

// 卡拉 OK 逐字平滑：本地 rAF 按 audioSec + 流逝时间插值，不再依赖 4Hz 的 timeupdate
let line = null;          // { lineStart, lineEnd, audioSec, sentAt }
let playing = false;
let barTarget = 0;

function tick(now) {
  if (line && line.lineEnd > line.lineStart && playing) {
    const audioNow = line.audioSec + (now - line.sentAt) / 1000;
    const p = Math.max(0, Math.min(1, (audioNow - line.lineStart) / (line.lineEnd - line.lineStart)));
    lyricFill.style.width = (p * 100).toFixed(2) + '%';
    // 整首歌进度本地插值，进度条平滑跟随，不再等下一行刷新
    if (line.duration > 0) {
      const songNow = line.songBase + Math.max(0, audioNow - line.lineStart);
      barTarget = Math.max(0, Math.min(100, (songNow / line.duration) * 100));
    }
  }
  barFill.style.width = barTarget.toFixed(2) + '%';
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.lyricApi.onLine((d) => {
  if (!d || !d.text) return;
  lyricText.textContent = d.text;
  lyricFill.textContent = d.text;
  line = {
    lineStart: d.lineStart || 0,
    lineEnd: d.lineEnd || 0,
    audioSec: d.audioSec || 0,
    sentAt: performance.now(),
    songBase: Math.max(0, (d.audioSec || 0) - (d.lineStart || 0)),
    duration: d.duration || 0
  };
  playing = !!d.playing;
  transEl.textContent = d.trans || '';
  titleEl.textContent = d.title || 'QinMusic';
  artistEl.textContent = d.artist || '';
  if (d.cover) {
    coverEl.textContent = '';
    const img = new Image();
    img.onload = () => { coverEl.textContent = ''; coverEl.appendChild(img); };
    img.src = d.cover;
  } else {
    coverEl.textContent = '';
    coverEl.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }
  if (d.songProgress != null) barTarget = d.songProgress;
});
