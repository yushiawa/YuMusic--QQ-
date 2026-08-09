if (localStorage.getItem('qin-ark-theme') === '1') document.body.classList.add('ark-theme');
const cover = document.getElementById('cover');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const curEl = document.getElementById('cur');
const durEl = document.getElementById('dur');
const barFill = document.getElementById('barFill');
const playBtn = document.getElementById('playBtn');
const eq = document.getElementById('eq');

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 5.8v12.4c0 .9 1 1.5 1.8 1L20 13c.8-.5.8-1.6 0-2.1L10.3 4.8c-.8-.5-1.8.1-1.8 1Z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="5.5" width="3.6" height="13" rx="1.2"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1.2"/></svg>';

function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00';
  sec = Math.floor(sec);
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

window.mini.onState((s) => {
  titleEl.textContent = s.title || '未在播放';
  artistEl.textContent = s.artist || 'QinMusic · 迷你模式';
  if (s.coverData) {
    cover.innerHTML = '';
    const img = document.createElement('img');
    img.src = s.coverData;
    img.onerror = () => { cover.textContent = '♪'; };
    cover.appendChild(img);
  } else if (s.cover) {
    cover.innerHTML = '';
    const img = document.createElement('img');
    img.src = s.cover;
    img.onerror = () => { cover.textContent = '♪'; };
    cover.appendChild(img);
  } else {
    cover.innerHTML = '♪';
  }
  const dur = s.dur || 0;
  curEl.textContent = fmt(s.cur);
  durEl.textContent = fmt(dur);
  barFill.style.width = dur > 0 ? Math.min(100, (s.cur / dur) * 100) + '%' : '0%';
  playBtn.innerHTML = s.playing ? PAUSE_ICON : PLAY_ICON;
  playBtn.title = s.playing ? '暂停' : '播放';
  eq.classList.toggle('on', !!s.playing && !!s.title);
});

document.getElementById('playBtn').addEventListener('click', () => window.mini.command('toggle'));
document.getElementById('prevBtn').addEventListener('click', () => window.mini.command('prev'));
document.getElementById('nextBtn').addEventListener('click', () => window.mini.command('next'));
document.getElementById('closeBtn').addEventListener('click', () => window.mini.command('close'));