/**
 * Game – canvas-based vaporwave surfing game.
 *
 * The player's microphone amplitude (or touch/keyboard) controls the
 * vertical position of a surfer riding the scrolling audio waveform.
 * Neon obstacles must be dodged; 3 lives before game over.
 */
class Game {
  constructor(canvas, audioManager) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.audio  = audioManager;

    /* ── State ─────────────────────────────── */
    this.state      = 'idle';   // idle | running | paused | gameover
    this.score      = 0;
    this.lives      = 3;
    this.frameCount = 0;
    this.speed      = 4;        // base horizontal scroll speed (px/frame)

    /* ── Surfer ────────────────────────────── */
    this.surfer = {
      x: 0, y: 0,
      w: 44, h: 44,
      targetY: 0,
      hitW: 22, hitH: 18,   // hitbox (smaller than visual)
    };

    /* ── Obstacles ─────────────────────────── */
    this.obstacles = [];

    /* ── Visual state ──────────────────────── */
    this.stars       = [];
    this.particles   = [];
    this.waveTrail   = [];      // historical surfer Y positions
    this.gridOffset  = 0;       // horizontal scroll for grid
    this.sunStripes  = 0;       // animation counter for sun

    /* ── Invincibility after hit ───────────── */
    this.invincible      = false;
    this.invincibleTimer = 0;

    /* ── Touch fallback ────────────────────── */
    this._touchBoost = false;
    this._rafHandle  = null;

    /* ── Callbacks (set by App) ────────────── */
    this.onScoreUpdate  = null;
    this.onLivesUpdate  = null;
    this.onGameOver     = null;
    this.onAudioLevel   = null;

    /* ── Spotify game modifiers ─────────────── */
    this.speedMultiplier       = 1;
    this.gapSizeMultiplier     = 1;
    this.spawnIntervalOverride = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._attachInputListeners();
  }

  /* ================================================================
     Public API
     ================================================================ */

  start() {
    if (this._rafHandle) cancelAnimationFrame(this._rafHandle);

    this.score      = 0;
    this.lives      = 3;
    this.frameCount = 0;
    this.speed      = 4;
    this.obstacles  = [];
    this.particles  = [];
    this.waveTrail  = [];
    this.invincible = false;

    this.surfer.y       = this.canvas.height / 2;
    this.surfer.targetY = this.canvas.height / 2;

    this._initStars();

    this.state = 'running';
    this._loop();
  }

  pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      if (this._rafHandle) {
        cancelAnimationFrame(this._rafHandle);
        this._rafHandle = null;
      }
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      this._loop();
    }
  }

  applySpotifyModifiers({ speedMultiplier = 1, gapSizeMultiplier = 1, spawnInterval = null } = {}) {
    this.speedMultiplier       = speedMultiplier;
    this.gapSizeMultiplier     = gapSizeMultiplier;
    this.spawnIntervalOverride = spawnInterval;
  }

  /* ================================================================
     Private: Game loop
     ================================================================ */

  _loop() {
    this._update();
    this._render();
    this._rafHandle = requestAnimationFrame(() => {
      if (this.state === 'running') this._loop();
    });
  }

  /* ================================================================
     Private: Update
     ================================================================ */

  _update() {
    this.frameCount++;

    /* ── Score / speed ramp ─────────────────── */
    this.score += 0.12 * this.speedMultiplier;
    if (this.onScoreUpdate) this.onScoreUpdate(Math.floor(this.score));

    const level = Math.floor(this.score / 300);
    this.speed  = (4 + level * 0.6) * this.speedMultiplier;

    /* ── Audio → surfer Y ───────────────────── */
    const amp = this.audio.getAmplitude();
    if (this.onAudioLevel) this.onAudioLevel(amp);

    /* loud = high on screen (low Y) */
    const minY = this.surfer.h;
    const maxY = this.canvas.height - this.surfer.h;
    this.surfer.targetY = maxY - amp * (maxY - minY);

    /* touch boost: surfer jumps toward top */
    if (this._touchBoost) {
      this.surfer.targetY = Math.min(this.surfer.targetY, this.canvas.height * 0.25);
    }

    this.surfer.targetY = Math.max(minY, Math.min(maxY, this.surfer.targetY));

    /* smooth lerp */
    this.surfer.y += (this.surfer.targetY - this.surfer.y) * 0.18;

    /* ── Wave trail ─────────────────────────── */
    this.waveTrail.unshift(this.surfer.y);
    const maxTrail = Math.ceil(this.canvas.width * 0.8 / 2);
    if (this.waveTrail.length > maxTrail) this.waveTrail.length = maxTrail;

    /* ── Grid scroll ────────────────────────── */
    this.gridOffset = (this.gridOffset + this.speed) % 60;
    this.sunStripes++;

    /* ── Obstacles ──────────────────────────── */
    const spawnInterval = this.spawnIntervalOverride
      || Math.max(60, 130 - level * 6);

    if (this.frameCount % spawnInterval === 0) this._spawnObstacle();

    this.obstacles = this.obstacles.filter(obs => {
      obs.x -= this.speed;

      /* passed – bonus score */
      if (!obs.passed && obs.x + obs.w < this.surfer.x - this.surfer.hitW / 2) {
        obs.passed = true;
        this.score += 25;
      }

      /* collision */
      if (!this.invincible && this._collides(obs)) this._hit();

      return obs.x + obs.w > -20;
    });

    /* ── Invincibility countdown ────────────── */
    if (this.invincible) {
      this.invincibleTimer--;
      if (this.invincibleTimer <= 0) this.invincible = false;
    }

    /* ── Stars ──────────────────────────────── */
    this.stars.forEach(s => {
      s.x -= s.speed * (this.speed / 4);
      if (s.x < 0) {
        s.x = this.canvas.width;
        s.y = Math.random() * this.canvas.height * 0.55;
      }
      s.twinkle = 0.5 + 0.5 * Math.sin(this.frameCount * 0.06 + s.phase);
    });

    /* ── Particles ──────────────────────────── */
    this.particles = this.particles.filter(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.12;   // gravity
      p.life--;
      p.alpha = p.life / p.maxLife;
      return p.life > 0;
    });
  }

  /* ================================================================
     Private: Obstacles
     ================================================================ */

  _spawnObstacle() {
    const level    = Math.floor(this.score / 300);
    const gapBase  = Math.max(110, 200 - level * 8);
    const gapSize  = gapBase * this.gapSizeMultiplier;
    const gapCentY = this.canvas.height * (0.18 + Math.random() * 0.58);
    const w        = 28 + Math.random() * 18;

    this.obstacles.push({
      x:      this.canvas.width + 10,
      w,
      gapCentY,
      gapHalf: gapSize / 2,
      passed:  false,
      color:   this._neonColor(),
    });
  }

  _collides(obs) {
    const sx  = this.surfer.x;
    const sy  = this.surfer.y;
    const hw  = this.surfer.hitW / 2;
    const hh  = this.surfer.hitH / 2;
    const inX = sx + hw > obs.x && sx - hw < obs.x + obs.w;
    if (!inX) return false;

    const clearTop    = sy - hh > obs.gapCentY - obs.gapHalf;
    const clearBottom = sy + hh < obs.gapCentY + obs.gapHalf;
    return !(clearTop && clearBottom);
  }

  _hit() {
    this.lives--;
    if (this.onLivesUpdate) this.onLivesUpdate(this.lives);
    this._burst(this.surfer.x, this.surfer.y, '#ff00ff', 18);

    if (this.lives <= 0) {
      this.state = 'gameover';
      if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
      if (this.onGameOver) this.onGameOver(Math.floor(this.score));
      return;
    }

    this.invincible      = true;
    this.invincibleTimer = 110;
  }

  /* ================================================================
     Private: Render
     ================================================================ */

  _render() {
    const { ctx, canvas } = this;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d0d2b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this._drawStars();
    this._drawSun();
    this._drawGrid();
    this._drawWaveTrail();
    this._drawObstacles();
    this._drawSurfer();
    this._drawParticles();
    this._drawScanlines();
  }

  _drawStars() {
    const { ctx } = this;
    ctx.save();
    this.stars.forEach(s => {
      ctx.globalAlpha = s.twinkle * 0.85;
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawSun() {
    const { ctx, canvas } = this;
    const cx = canvas.width  / 2;
    const cy = canvas.height * 0.5;   // sit at horizon
    const r  = canvas.height * 0.21;

    ctx.save();

    /* Clip to circle */
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    /* Gradient body */
    const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    grad.addColorStop(0,    '#fff700');
    grad.addColorStop(0.35, '#ff8c00');
    grad.addColorStop(0.65, '#ff1493');
    grad.addColorStop(1,    '#b967ff');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    /* Horizontal stripe cuts in lower half */
    ctx.fillStyle = '#0d0d2b';
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      const t         = i / stripes;
      const lineY     = cy + t * r;
      const thickness = 2 + i * 2.2;
      ctx.fillRect(cx - r, lineY, r * 2, thickness);
    }

    ctx.restore();

    /* Outer glow ring */
    ctx.save();
    ctx.shadowBlur  = 60;
    ctx.shadowColor = '#ff00ff';
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth   = 4;
    ctx.stroke();
    ctx.restore();
  }

  _drawGrid() {
    const { ctx, canvas } = this;
    const horizon  = canvas.height * 0.5;
    const vp       = { x: canvas.width / 2, y: horizon };

    ctx.save();

    /* ── Horizontal perspective lines ──────── */
    const hLines = 14;
    for (let i = 1; i <= hLines; i++) {
      const t = i / hLines;
      const y = horizon + Math.pow(t, 1.5) * (canvas.height - horizon);
      ctx.globalAlpha  = 0.12 + t * 0.5;
      ctx.strokeStyle  = '#ff00ff';
      ctx.lineWidth    = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    /* ── Vertical perspective lines ─────────── */
    const vLines = 22;
    ctx.lineWidth = 0.6;
    for (let i = 0; i <= vLines; i++) {
      const x = (canvas.width / vLines) * i;
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#b967ff';
      ctx.beginPath();
      ctx.moveTo(vp.x, vp.y);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    /* ── Moving vertical lines (depth) ──────── */
    ctx.lineWidth   = 1;
    ctx.strokeStyle = '#01cdfe';
    ctx.globalAlpha = 0.08;
    const spacing   = 60;
    const off       = canvas.width - (this.gridOffset % spacing);
    for (let x = off % spacing; x < canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, horizon);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawWaveTrail() {
    const { ctx, canvas } = this;
    if (this.waveTrail.length < 2) return;

    ctx.save();
    ctx.lineJoin  = 'round';
    ctx.lineWidth = 3;

    /* Glow layer */
    ctx.shadowBlur  = 18;
    ctx.shadowColor = '#00ffff';
    ctx.strokeStyle = '#00ffff';
    ctx.globalAlpha = 0.75;

    ctx.beginPath();
    /* Trail goes left from surfer */
    ctx.moveTo(this.surfer.x, this.waveTrail[0]);
    const step = 2; // every-other frame = 2px apart
    for (let i = 1; i < this.waveTrail.length; i++) {
      const x = this.surfer.x - i * step;
      if (x < 0) break;
      ctx.lineTo(x, this.waveTrail[i]);
    }
    ctx.stroke();

    /* Pink echo */
    ctx.shadowColor = '#ff00ff';
    ctx.strokeStyle = '#ff00ff';
    ctx.globalAlpha = 0.25;
    ctx.lineWidth   = 6;
    ctx.stroke();

    ctx.restore();
  }

  _drawObstacles() {
    const { ctx, canvas } = this;

    this.obstacles.forEach(obs => {
      const topH    = obs.gapCentY - obs.gapHalf;
      const botY    = obs.gapCentY + obs.gapHalf;
      const botH    = canvas.height - botY;

      ctx.save();
      ctx.shadowBlur  = 22;
      ctx.shadowColor = obs.color;
      ctx.fillStyle   = obs.color;
      ctx.globalAlpha = 0.9;

      /* top pillar */
      if (topH > 0) ctx.fillRect(obs.x, 0, obs.w, topH);
      /* bottom pillar */
      if (botH > 0) ctx.fillRect(obs.x, botY, obs.w, botH);

      /* inner highlight stripe */
      ctx.fillStyle   = 'rgba(255,255,255,0.15)';
      ctx.globalAlpha = 1;
      if (topH > 0) ctx.fillRect(obs.x + 2, 0, 3, topH);
      if (botH > 0) ctx.fillRect(obs.x + 2, botY, 3, botH);

      ctx.restore();
    });
  }

  _drawSurfer() {
    const { ctx } = this;
    const { x, y } = this.surfer;

    /* flash when invincible */
    if (this.invincible && Math.floor(this.invincibleTimer / 7) % 2 === 0) return;

    ctx.save();
    ctx.shadowBlur  = 28;
    ctx.shadowColor = '#ff71ce';

    /* surfboard */
    ctx.fillStyle   = '#ff71ce';
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 26, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    /* body */
    ctx.fillStyle = '#b967ff';
    ctx.beginPath();
    ctx.ellipse(x - 4, y - 2, 9, 13, -0.15, 0, Math.PI * 2);
    ctx.fill();

    /* head */
    ctx.fillStyle = '#fff700';
    ctx.shadowColor = '#fff700';
    ctx.beginPath();
    ctx.arc(x - 4, y - 17, 7, 0, Math.PI * 2);
    ctx.fill();

    /* speed lines / motion blur behind surfer */
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#ff71ce';
    ctx.lineWidth   = 2;
    for (let i = 1; i <= 4; i++) {
      ctx.globalAlpha = 0.12 / i;
      ctx.beginPath();
      ctx.moveTo(x - 30 - i * 10, y + 12 - i);
      ctx.lineTo(x - 30 - i * 10, y + 12 + i);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawParticles() {
    const { ctx } = this;
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle   = p.color;
      ctx.shadowBlur  = 10;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  _drawScanlines() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.globalAlpha = 0.035;
    ctx.fillStyle   = '#000';
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillRect(0, y, canvas.width, 2);
    }
    ctx.restore();
  }

  /* ================================================================
     Private: Helpers
     ================================================================ */

  _burst(x, y, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd   = 2 + Math.random() * 4;
      const life  = 35 + Math.random() * 25;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 1,
        color,
        size:    2 + Math.random() * 3,
        life,
        maxLife: life,
        alpha:   1,
      });
    }
  }

  _neonColor() {
    const colors = ['#ff00ff', '#00ffff', '#ff71ce', '#b967ff', '#01cdfe', '#05ffa1'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.surfer.x      = this.canvas.width * 0.22;
    if (this.state !== 'running') {
      this.surfer.y = this.canvas.height / 2;
    }
    this._initStars();
  }

  _initStars() {
    this.stars = [];
    for (let i = 0; i < 160; i++) {
      this.stars.push({
        x:      Math.random() * this.canvas.width,
        y:      Math.random() * this.canvas.height * 0.52,
        size:   Math.random() * 1.8 + 0.4,
        speed:  Math.random() * 0.6 + 0.1,
        phase:  Math.random() * Math.PI * 2,
        twinkle: 1,
      });
    }
  }

  /* ── Input listeners (touch + keyboard) ─────────────── */
  _attachInputListeners() {
    /* Touch: hold to boost upward */
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      this._touchBoost = true;
      this.audio.applyBoost(0.65);
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      this._touchBoost = false;
    });

    /* Mouse click (for desktop testing) */
    this.canvas.addEventListener('mousedown', () => {
      this._touchBoost = true;
      this.audio.applyBoost(0.65);
    });
    this.canvas.addEventListener('mouseup', () => {
      this._touchBoost = false;
    });

    /* Keyboard: Space / ArrowUp = boost */
    document.addEventListener('keydown', e => {
      if ((e.code === 'Space' || e.code === 'ArrowUp') && this.state === 'running') {
        e.preventDefault();
        this._touchBoost = true;
        this.audio.applyBoost(0.65);
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        this._touchBoost = false;
      }
    });
  }
}
