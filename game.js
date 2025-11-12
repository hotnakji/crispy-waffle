// Hitting Tiles - Space Edition (Step 1)
// - Canvas-based falling tiles
// - Click a tile to remove it and gain +1 score
// - Press Space / ArrowDown to 'hit' any tile crossing the hit line
// - Tiles that reach the bottom reduce lives by 1
// - Simple score and lives UI; minimal game over handling

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI elements
const scoreEl = document.getElementById('scoreVal');
const livesEl = document.getElementById('livesVal');
const overlay = document.getElementById('overlay');
const finalScore = document.getElementById('finalScore');
const restartBtn = document.getElementById('restartBtn');
// difficulty selector element (from index.html)
const diffSelect = document.getElementById('difficulty');
// overlay difficulty selector (from overlay)
const overlayDiff = document.getElementById('overlayDifficulty');

// apply difficulty settings helper
function applyDifficulty(mode, resetCurrent = false) {
  const s = difficultySettings[mode] || difficultySettings.normal;
  spawnInterval = s.spawnInterval;
  tileSpeed = s.tileSpeed;
  if (resetCurrent) lives = s.lives;
}

// respond to difficulty selector changes
if (diffSelect) {
  diffSelect.addEventListener('change', (e) => {
    difficulty = e.target.value;
    // if the game isn't running, update start values immediately
    if (!running) applyDifficulty(difficulty, true);
    else {
      // if running, apply the spawn/speed but don't reset current lives
      const s = difficultySettings[difficulty] || difficultySettings.normal;
      spawnInterval = s.spawnInterval;
      tileSpeed = s.tileSpeed;
    }
  });
}

// --- Audio (small WebAudio hit sound) ---
let audioCtx = null;
function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// mute state and UI
const muteBtn = document.getElementById('muteBtn');
let muted = false;
// load saved mute state
try {
  const saved = localStorage.getItem('muted');
  if (saved === '1') muted = true;
} catch (e) {}

function setMuted(v) {
  muted = !!v;
  if (muteBtn) muteBtn.textContent = muted ? '🔇' : '🔊';
  try {
    localStorage.setItem('muted', muted ? '1' : '0');
  } catch (e) {}
  // optionally suspend/resume audio context
  try {
    if (audioCtx && audioCtx.state) {
      if (muted && audioCtx.state === 'running') audioCtx.suspend && audioCtx.suspend();
      if (!muted && audioCtx.state === 'suspended') audioCtx.resume && audioCtx.resume();
    }
  } catch (e) {}
}

if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    setMuted(!muted);
  });
}

function playHitSound() {
  try {
    if (muted) return;
    ensureAudioContext();
    const now = audioCtx.currentTime;
    // short sine tone with quick attack/decay
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880 + Math.random() * 120, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (err) {
    // fail silently if audio is blocked
    // console.log('Audio error', err);
  }
}

// short death sound: a low descending tone
function playDeathSound() {
  try {
    if (muted) return;
    ensureAudioContext();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    // start a bit higher then drop
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.7);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.95);
  } catch (err) {
    // ignore audio errors
  }
}

// miss sound: short click / noise
function playMissSound() {
  try {
    if (muted) return;
    ensureAudioContext();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420 + Math.random() * 200, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  } catch (err) {}
}

let width = 800, height = 600;
let DPR = window.devicePixelRatio || 1;

function resizeCanvas() {
  // match CSS size while keeping sharp rendering on HiDPI
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  canvas.width = Math.round(width * DPR);
  canvas.height = Math.round(height * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// Game state
let tiles = [];
let lastSpawn = 0;
let spawnInterval = 900; // ms between tiles at start
let tileSpeed = 100; // pixels per second base
let score = 0;
let lives = 3;
let running = false;
let lastTime = 0;

// difficulty base settings (updated by selector)
let difficulty = 'normal';
const difficultySettings = {
  easy:   { spawnInterval: 1300, tileSpeed: 70,  lives: 5, minMult: 0.85, maxMult: 1.15 },
  normal: { spawnInterval: 900,  tileSpeed: 110, lives: 3, minMult: 0.95, maxMult: 1.45 },
  hard:   { spawnInterval: 650,  tileSpeed: 160, lives: 2, minMult: 1.05, maxMult: 1.9 }
};

// flash effect on miss (seconds)
let flashTime = 0;

// Hit zone near bottom (in px)
const hitZoneHeight = 90;

class Tile {
  constructor(x, w, h, speed) {
    this.x = x;
    this.y = -h - 10;
    this.w = w;
    this.h = h;
    this.speed = speed; // px / s
    this.color = `hsl(${Math.random()*60 + 180}, 70%, ${Math.random()*20 + 40}%)`;
    this.id = Math.random().toString(36).slice(2,9);
  }
  update(dt) {
    this.y += this.speed * dt;
  }
  draw(ctx) {
    // simple rounded rectangle meteor-like tile
    ctx.fillStyle = this.color;
    roundRect(ctx, this.x, this.y, this.w, this.h, 6);
    ctx.fill();
    // add a small white highlight
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(this.x + 6, this.y + 6, Math.min(12, this.w - 12), 6);
  }
  isPointInside(px, py) {
    return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function spawnTile() {
  // width depends on canvas width
  const margin = 16;
  const w = Math.max(40, Math.min(100, width * (0.08 + Math.random()*0.07)));
  const h = Math.max(24, Math.round(w * (0.5 + Math.random()*0.6)));
  const x = margin + Math.random() * (width - w - margin*2);
  // use difficulty-specific multiplier range for more distinct speeds
  const s = difficultySettings[difficulty] || difficultySettings.normal;
  const minM = s.minMult ?? 0.9;
  const maxM = s.maxMult ?? 1.5;
  const mult = minM + Math.random() * (maxM - minM);
  const speed = tileSpeed * mult;
  tiles.push(new Tile(x, w, h, speed));
}

// centralized miss penalty (mouse miss or wrong-key press)
function penalizeMiss() {
  lives -= 1;
  flashTime = 0.22;
  try { ensureAudioContext(); audioCtx.resume && audioCtx.resume().then(() => playMissSound()); } catch(e) {}
  // increase difficulty gradually
  tileSpeed *= 1.06;
  if (spawnInterval > 280) spawnInterval *= 0.92;
  updateUI();
  if (lives <= 0) endGame();
}

function update(dt) {
  // spawn logic
  lastSpawn += dt * 1000;
  if (lastSpawn > spawnInterval) {
    lastSpawn = 0;
    spawnTile();
  }

  // update tiles
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i];
    t.update(dt);
    // check bottom reach
    if (t.y > height) {
      // missed (tile reached bottom)
      tiles.splice(i,1);
      lives -= 1;
      // play miss sound for a fallen tile
      try { ensureAudioContext(); audioCtx.resume && audioCtx.resume().then(() => playMissSound()); } catch(e) {}
      updateUI();
      if (lives <= 0) {
        endGame();
      }
    }
  }

}

function draw() {
  // clear
  ctx.clearRect(0,0,width,height);

  // subtle star field (drawn on canvas for some parallax)
  drawStars();

  // draw tiles
  for (const t of tiles) t.draw(ctx);

  // draw hit line
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  const lineY = height - hitZoneHeight;
  ctx.fillRect(0, lineY, width, 2);
  ctx.fillStyle = 'rgba(200,220,255,0.035)';
  ctx.fillRect(0, lineY + 2, width, hitZoneHeight - 10);

    // flash red on miss
    if (flashTime > 0) {
      ctx.fillStyle = `rgba(255,40,40, ${Math.min(0.45, flashTime * 2)})`;
      ctx.fillRect(0,0,width,height);
    }
}

// small canvas star drawing for depth
function drawStars() {
  // draw a few moving stars with subtle opacity
  ctx.save();
  for (let i=0;i<30;i++){
    const x = (i*73) % width;
    const y = (i*47) % height;
    const r = (i%3)+0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function gameLoop(ts) {
  if (!running) return;
  if (!lastTime) lastTime = ts;
  const dt = (ts - lastTime) / 1000;
  lastTime = ts;

  update(dt);
  draw();

  // reduce flash timer
  if (flashTime > 0) flashTime = Math.max(0, flashTime - dt);

  requestAnimationFrame(gameLoop);
}

function startGame() {
  tiles = [];
  score = 0;
  // apply chosen difficulty for a fresh start
  applyDifficulty(difficulty, true);
  lastSpawn = 0;
  lastTime = 0;
  running = true;
  // Explicitly hide overlay using inline style to avoid any CSS race
  overlay.style.display = 'none';
  // ensure the restart button disappears when gameplay begins
  restartBtn.classList.add('hidden');
  updateUI();
  requestAnimationFrame(gameLoop);
}

function endGame() {
  running = false;
  finalScore.textContent = score;
  // play death sound (try to resume AudioContext if needed)
  try { ensureAudioContext(); audioCtx.resume && audioCtx.resume().then(() => playDeathSound()); } catch(e) {}
  // show restart button when game is over
  restartBtn.classList.remove('hidden');
  // set overlay difficulty selector to current difficulty
  if (overlayDiff) overlayDiff.value = difficulty;
  // Use inline style to ensure the overlay is visible above the canvas
  overlay.style.display = 'flex';
}

function updateUI(){
  scoreEl.textContent = String(score);
  livesEl.textContent = String(lives);
}

// Input handling: mouse click on tile
canvas.addEventListener('click', (e) => {
  if (!running) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  for (let i = tiles.length - 1; i >= 0; i--) {
    if (tiles[i].isPointInside(x, y)) {
      tiles.splice(i,1);
      score += 1;
      updateUI();
      // play hit sound (resume/create AudioContext on first gesture)
      try { ensureAudioContext(); audioCtx.resume && audioCtx.resume().then(() => playHitSound()); } catch(e) {}
      return;
    }
  }
  // if we get here, it was a miss-click (clicked empty space)
  penalizeMiss();
});

// Keyboard: Space or ArrowDown to 'hit' tiles crossing the hit zone
window.addEventListener('keydown', (e) => {
  if (!running) {
    // allow Enter to start quickly
    if (e.key === 'Enter') startGame();
    return;
  }
  if (e.code === 'Space' || e.key === 'ArrowDown') {
    // find a tile overlapping the hit zone (closest to bottom)
    const hitY = height - hitZoneHeight;
    let candidateIndex = -1;
    let bestY = -Infinity;
    for (let i=0;i<tiles.length;i++){
      const t = tiles[i];
      if (t.y + t.h >= hitY && t.y <= height) {
        if (t.y + t.h > bestY) { bestY = t.y + t.h; candidateIndex = i; }
      }
    }
    if (candidateIndex >= 0) {
      tiles.splice(candidateIndex,1);
      score += 1;
      updateUI();
      // play hit sound
      try { ensureAudioContext(); audioCtx.resume && audioCtx.resume().then(() => playHitSound()); } catch(e) {}
      // slightly increase difficulty over time
      tileSpeed *= 1.002;
      if (spawnInterval > 380) spawnInterval *= 0.998;
    } else {
      // no tile in hit zone -> count as a miss
      penalizeMiss();
    }
  }
});

// Restart: explicitly hide the overlay then start the game
restartBtn.addEventListener('click', () => {
  // hide the restart button immediately so it "disappears" on click
  restartBtn.classList.add('hidden');
  // read selected difficulty from overlay chooser (if present)
  const chosen = overlayDiff && overlayDiff.value ? overlayDiff.value : difficulty;
  difficulty = chosen;
  // apply chosen difficulty for the fresh start (reset lives)
  applyDifficulty(difficulty, true);
  // sync top selector UI
  if (diffSelect) diffSelect.value = difficulty;
  // hide overlay and begin a fresh game
  overlay.style.display = 'none';
  startGame();
});

// simple focus helper so keyboard works after clicking canvas
canvas.addEventListener('mousedown', () => canvas.focus());

// initial setup and start
function init() {
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  // ensure overlay/restart button start hidden
  overlay.style.display = 'none';
  restartBtn.classList.add('hidden');

  // set difficulty selector default visually
  if (diffSelect) diffSelect.value = difficulty;
  // set overlay difficulty default
  if (overlayDiff) overlayDiff.value = difficulty;

  // reflect mute state in UI and audio context
  setMuted(muted);

  // Start automatically for this step so user can play immediately
  startGame();
}

// Kick off
init();
