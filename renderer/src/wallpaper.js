// ============================================================
// WallpaperLayer ? ?????? + ??????
// ============================================================
export const WALLPAPER_TYPES = [
  { key: 'stardust', name: '????' },
  { key: 'mist', name: '????' },
  { key: 'aurora', name: '????' },
  { key: 'moonlight', name: '???' },
  { key: 'firefly', name: '????' },
  { key: 'we', name: '????' }
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function weHost(item) {
  return item && item.src === 'local'
    ? 'local-' + encodeURIComponent(item.id)
    : encodeURIComponent(item.id || '');
}

export class WallpaperLayer {
  constructor() {
    this.layer = typeof document !== 'undefined' ? document.getElementById('wallpaperLayer') : null;
    this.canvas = typeof document !== 'undefined' ? document.getElementById('wallpaperCanvas') : null;
    this.video = typeof document !== 'undefined' ? document.getElementById('wallpaperVideo') : null;
    this.videoBlur = typeof document !== 'undefined' ? document.getElementById('wallpaperVideoBlur') : null;
    this.img = typeof document !== 'undefined' ? document.getElementById('wallpaperImg') : null;
    this.imgBlur = typeof document !== 'undefined' ? document.getElementById('wallpaperImgBlur') : null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.active = false;
    this.type = 'stardust';
    this.level = 1;
    this.beat = true;
    this.weItem = null;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.t = 0;
    this.stars = [];
    this.fireflies = [];
    this.fog = [];
    this.initParticles();
    this.resize();
    if (typeof window !== 'undefined') window.addEventListener('resize', () => this.resize());
  }

  initParticles() {
    this.stars = [];
    for (let i = 0; i < 120; i++) {
      this.stars.push({
        x: Math.random(), y: Math.random(),
        r: rand(0.6, 2.4), a: rand(0.2, 0.55),
        sp: rand(0.004, 0.016), ph: rand(0, 6.28), tw: rand(0.3, 1.4)
      });
    }
    this.fireflies = [];
    for (let i = 0; i < 40; i++) {
      this.fireflies.push({
        x: Math.random(), y: Math.random(),
        r: rand(1.0, 2.8), ph: rand(0, 6.28), sp: rand(0.002, 0.008),
        vx: rand(-0.15, 0.15), vy: rand(-0.1, 0.04)
      });
    }
    this.fog = [];
    for (let i = 0; i < 8; i++) {
      this.fog.push({
        x: Math.random(), y: Math.random(),
        r: rand(0.5, 0.95), a: rand(0.08, 0.16),
        ax: rand(0.6, 1.6), ay: rand(0.4, 1.1), px: rand(0, 6.28), py: rand(0, 6.28)
      });
    }
  }

  resize() {
    if (!this.canvas) return;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (this.ctx) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.type === 'we' && this.active) this.refreshBlurFill();
  }

  setActive(v) {
    this.active = !!v;
    if (v) {
      this.resize();
      if (this.type === 'we' && this.weItem) this.applyWe(this.weItem);
    } else {
      this.pauseVideo();
    }
  }

  setType(key) {
    const ok = WALLPAPER_TYPES.some(p => p.key === key);
    if (!ok) key = 'stardust';
    this.type = key;
    if (key !== 'we') {
      this.pauseVideo();
      if (this.layer) { this.layer.classList.remove('has-we'); this.layer.classList.remove('has-blurfill'); }
      if (this.video) this.video.style.opacity = '0';
      if (this.img) this.img.style.opacity = '0';
      this.clearBlur();
      if (this.canvas) this.canvas.style.opacity = '1';
    } else if (this.weItem) {
      this.applyWe(this.weItem);
    }
  }

  setLevel(v) { this.level = clamp(Number(v) || 1, 0.4, 1.5); }
  setBeat(on) { this.beat = !!on; }

  setWeItem(item) {
    this.weItem = item || null;
    if (this.type === 'we' && this.active && item) this.applyWe(item);
  }

  applyWe(item) {
    this.pauseVideo();
    if (this.layer) this.layer.classList.add('has-we');
    if (this.canvas) this.canvas.style.opacity = '0';
    if (this.img) this.img.style.opacity = '0';
    this.clearBlur();
    if (item.src === 'file' && item.full) {
      const fileUrl = 'file:///' + String(item.full).replace(/\\/g, '/');
      if (item.video && this.video) {
        if (this.video.src !== fileUrl) this.video.src = fileUrl;
        this.video.muted = true;
        this.video.style.opacity = '1';
        const tryPlay = () => { const pr = this.video.play(); if (pr && pr.catch) pr.catch(() => {}); };
        tryPlay();
        this.video.oncanplay = tryPlay;
        this.video.onloadedmetadata = () => this.refreshBlurFill();
      } else if (this.img) {
        this.img.src = fileUrl;
        this.img.style.opacity = '1';
        this.img.onload = () => this.refreshBlurFill();
      }
      return;
    }
    const base = 'wallpaper://' + weHost(item) + '/';
    if (item.video && this.video) {
      const src = base + encodeURIComponent(item.video);
      if (this.video.src !== src) this.video.src = src;
      this.video.muted = true;
      this.video.style.opacity = '1';
      const tryPlay = () => { const pr = this.video.play(); if (pr && pr.catch) pr.catch(() => {}); };
      tryPlay();
      this.video.oncanplay = tryPlay;
      this.video.onloadedmetadata = () => this.refreshBlurFill();
    } else if (this.img) {
      const src = base + encodeURIComponent(item.image || item.preview || 'preview.jpg');
      this.img.src = src;
      this.img.style.opacity = '1';
      this.img.onload = () => this.refreshBlurFill();
    }
  }

  // 当壁纸与窗口比例差超过 8% 时启用模糊填充（前景 contain 完整展示，背景同源模糊铺满）
  refreshBlurFill() {
    const v = this.video;
    const im = this.img;
    let need = false;
    if (v && v.videoWidth && v.videoHeight) {
      need = this.aspectMismatch(v.clientWidth || window.innerWidth, v.clientHeight || window.innerHeight, v.videoWidth, v.videoHeight);
    } else if (im && im.naturalWidth && im.naturalHeight) {
      need = this.aspectMismatch(im.clientWidth || window.innerWidth, im.clientHeight || window.innerHeight, im.naturalWidth, im.naturalHeight);
    }
    this.setBlurFill(need);
    if (need) {
      const src = v ? (v.currentSrc || v.src) : (im ? im.src : '');
      if (v && this.videoBlur && src && this.videoBlur.src !== src) {
        this.videoBlur.src = src;
        this.videoBlur.muted = true;
        const tb = () => { const pr = this.videoBlur.play(); if (pr && pr.catch) pr.catch(() => {}); };
        this.videoBlur.oncanplay = tb;
        tb();
      } else if (im && this.imgBlur && src && this.imgBlur.src !== src) {
        this.imgBlur.src = src;
      }
    }
  }

  aspectMismatch(cw, ch, nw, nh) {
    if (!cw || !ch || !nw || !nh) return false;
    const a1 = nw / nh;
    const a2 = cw / ch;
    return Math.abs(a1 - a2) / Math.max(a1, a2) > 0.08;
  }

  setBlurFill(on) {
    if (!this.layer) return;
    this.layer.classList.toggle('has-blurfill', !!on);
    if (this.videoBlur) this.videoBlur.style.opacity = on ? '1' : '0';
    if (this.imgBlur) this.imgBlur.style.opacity = on ? '1' : '0';
  }

  clearBlur() {
    if (this.layer) this.layer.classList.remove('has-blurfill');
    if (this.videoBlur) { try { this.videoBlur.pause(); } catch (e) { /* ignore */ } this.videoBlur.removeAttribute('src'); try { this.videoBlur.load(); } catch (e) { /* ignore */ } }
    if (this.imgBlur) this.imgBlur.removeAttribute('src');
  }

  pauseVideo() {
    if (this.video) {
      try { this.video.pause(); } catch (e) { /* ignore */ }
    }
    if (this.videoBlur) {
      try { this.videoBlur.pause(); } catch (e) { /* ignore */ }
    }
  }

  render(t, bass, power) {
    if (!this.ctx || !this.active) return;
    if (this.type === 'we') return;
    this.t = t;
    const b = this.beat ? (bass || 0) : 0;
    switch (this.type) {
      case 'stardust': this.renderStardust(t, b); break;
      case 'mist': this.renderMist(t, b); break;
      case 'aurora': this.renderAurora(t, b); break;
      case 'moonlight': this.renderMoonlight(t, b); break;
      case 'firefly': this.renderFirefly(t, b); break;
    }
  }

  renderStardust(t, b) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b1226');
    g.addColorStop(0.55, '#111a33');
    g.addColorStop(1, '#182644');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const lvl = this.level * (1 + b * 0.18);
    for (const s of this.stars) {
      s.y -= s.sp * (1 + b * 0.5) * 0.004;
      if (s.y < -0.02) { s.y = 1.02; s.x = Math.random(); }
      const tw = 0.6 + 0.4 * Math.sin(t * s.tw + s.ph);
      const x = (s.x + Math.sin(t * 0.05 + s.ph) * 0.01) * w;
      const y = s.y * h;
      const a = s.a * tw * lvl * 0.9;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(196, 214, 245, ' + clamp(a, 0, 0.75).toFixed(3) + ')';
      ctx.fill();
    }
  }

  renderMist(t, b) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#101a28');
    g.addColorStop(1, '#1a2836');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const R = Math.max(w, h);
    for (const f of this.fog) {
      const cx = (f.x + Math.sin(t * 0.02 * f.ax + f.px) * 0.12) * w;
      const cy = (f.y + Math.cos(t * 0.015 * f.ay + f.py) * 0.1) * h;
      const r = f.r * R;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const a = f.a * this.level * (1 + b * 0.3);
      rg.addColorStop(0, 'rgba(176, 208, 226, ' + clamp(a, 0, 0.22).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(176, 208, 226, 0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
  }

  renderAurora(t, b) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a1428');
    g.addColorStop(0.5, '#101c38');
    g.addColorStop(1, '#182a4c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const bands = [
      { c: '168, 235, 190', y: 0.3, amp: 0.055, f1: 0.0016, f2: 0.0032, sp: 0.012, base: 0.16 },
      { c: '150, 178, 255', y: 0.5, amp: 0.06, f1: 0.0012, f2: 0.0024, sp: 0.008, base: 0.15 },
      { c: '255, 160, 214', y: 0.72, amp: 0.048, f1: 0.002, f2: 0.0014, sp: 0.01, base: 0.11 }
    ];
    const lvl = this.level;
    for (const band of bands) {
      const boost = this.beat ? 1 + b * 0.5 : 1;
      ctx.beginPath();
      ctx.moveTo(0, h * band.y);
      for (let x = 0; x <= w; x += 12) {
        const u = x / w;
        const y = h * (band.y +
          band.amp * Math.sin(u * 9 * Math.PI * band.f1 * 400 + t * band.sp) +
          band.amp * 0.5 * Math.sin(u * 4 * Math.PI * band.f2 * 400 - t * band.sp * 0.6));
        ctx.lineTo(x, y);
      }
      for (let x = w; x >= 0; x -= 12) {
        const u = x / w;
        const y = h * (band.y +
          band.amp * Math.sin(u * 9 * Math.PI * band.f1 * 400 + t * band.sp) +
          band.amp * 0.5 * Math.sin(u * 4 * Math.PI * band.f2 * 400 - t * band.sp * 0.6) + 0.1);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(' + band.c + ', ' + clamp(band.base * lvl * boost, 0, 0.34).toFixed(3) + ')';
      ctx.fill();
    }
  }

  renderMoonlight(t, b) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a1428');
    g.addColorStop(1, '#16283f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const mx = w * 0.78, my = h * 0.2;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, Math.min(w, h) * 0.24);
    mg.addColorStop(0, 'rgba(222, 234, 250, ' + (0.14 * this.level).toFixed(3) + ')');
    mg.addColorStop(0.5, 'rgba(180, 205, 240, ' + (0.06 * this.level).toFixed(3) + ')');
    mg.addColorStop(1, 'rgba(180, 205, 240, 0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, w, h);
    const boost = this.beat ? 1 + b * 0.4 : 1;
    for (let i = 0; i < 6; i++) {
      const y0 = h * (0.52 + i * 0.09);
      const amp = (8 + i * 4) * boost;
      const sp = 0.12 + i * 0.03;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 10) {
        const u = x / w;
        const y = y0 + amp * Math.sin(u * 4 * Math.PI + t * sp) +
          amp * 0.4 * Math.sin(u * 9 * Math.PI - t * sp * 0.7);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120, 156, 210, ' + clamp((0.10 + i * 0.016) * this.level, 0, 0.24).toFixed(3) + ')';
      ctx.fill();
    }
  }

  renderFirefly(t, b) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a1a12');
    g.addColorStop(1, '#12281a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const lvl = this.level;
    for (const f of this.fireflies) {
      f.x += f.vx * 0.0006;
      f.y += f.vy * 0.0006;
      if (f.x < -0.02) f.x = 1.02;
      if (f.x > 1.02) f.x = -0.02;
      if (f.y < -0.02) f.y = 1.02;
      if (f.y > 1.02) f.y = -0.02;
      const tw = 0.5 + 0.5 * Math.sin(t * f.sp * 20 + f.ph);
      const a = (0.14 + 0.42 * tw) * lvl * (this.beat ? 1 + b * 0.35 : 1);
      const x = f.x * w, y = f.y * h;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, f.r * 5);
      rg.addColorStop(0, 'rgba(220, 246, 178, ' + clamp(a, 0, 0.55).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(220, 246, 178, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, f.r * 5, 0, 6.2832);
      ctx.fill();
    }
  }
}
