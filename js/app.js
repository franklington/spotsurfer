/**
 * app.js – SpotSurfer main application controller.
 *
 * Wires together AudioManager, Game, and SpotifyManager.
 * Handles screen navigation, PWA registration, and Spotify polling.
 */

/* ── Globals ──────────────────────────────────────────────── */
const audio   = new AudioManager();
const spotify = new SpotifyManager();
let   game    = null;
let   spotifyPollTimer = null;

/* ================================================================
   Utility – Screen navigation
   ================================================================ */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

/* ================================================================
   Boot
   ================================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  /* Register service worker for PWA */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.warn('[SW] Registration failed:', err)
    );
  }

  /* Handle Spotify OAuth callback (URL contains ?code=…) */
  if (location.search.includes('code=') || location.search.includes('error=')) {
    showScreen('spotify-screen');
    const ok = await spotify.handleCallback();
    setSpotifyStatus(ok ? '✅ Connected to Spotify!' : '❌ Spotify connection failed.');
    showScreen('start-screen');
    updateSpotifyUI();
    return;
  }

  /* Check for an existing valid Spotify token */
  await spotify.checkExistingToken();

  updateSpotifyUI();
  showScreen('start-screen');
  bindStartScreenEvents();
});

/* ================================================================
   Start Screen
   ================================================================ */

function bindStartScreenEvents() {
  document.getElementById('start-btn')
    .addEventListener('click', startGame);

  document.getElementById('spotify-btn')
    .addEventListener('click', handleSpotifyButton);

  document.getElementById('pause-btn')
    .addEventListener('click', handlePause);

  document.getElementById('resume-btn')
    .addEventListener('click', handleResume);

  document.getElementById('quit-btn')
    .addEventListener('click', () => {
      if (game) game.state = 'idle';
      clearSpotifyPoll();
      showScreen('start-screen');
      updateSpotifyUI();
    });

  document.getElementById('retry-btn')
    .addEventListener('click', startGame);

  document.getElementById('menu-btn')
    .addEventListener('click', () => {
      clearSpotifyPoll();
      showScreen('start-screen');
      updateSpotifyUI();
    });
}

/* ================================================================
   Game start / resume / pause
   ================================================================ */

async function startGame() {
  showScreen('game-screen');

  /* Init audio (must happen after user gesture) */
  const hasMic = await audio.init();

  const banner = document.getElementById('mic-denied-banner');
  banner.classList.toggle('hidden', hasMic);

  /* Create (or reuse) game instance */
  const canvas = document.getElementById('game-canvas');
  if (!game) {
    game = new Game(canvas, audio);
    wireGameCallbacks();
  }

  /* Apply Spotify modifiers if connected */
  if (spotify.isConnected) {
    await pollSpotify(/* immediate */ true);
    startSpotifyPoll();
  }

  /* Hide pause overlay in case it was visible */
  document.getElementById('pause-overlay').classList.add('hidden');

  game.start();
}

function wireGameCallbacks() {
  game.onScoreUpdate = score => {
    document.getElementById('score').textContent = score;
  };

  game.onLivesUpdate = lives => {
    document.getElementById('lives').textContent = '❤️'.repeat(Math.max(0, lives));
  };

  game.onGameOver = score => {
    clearSpotifyPoll();
    const hi = parseInt(localStorage.getItem('spotsurfer_hi') || '0', 10);
    document.getElementById('final-score').textContent = score;
    const hiMsg = document.getElementById('high-score-msg');
    if (score > hi) {
      localStorage.setItem('spotsurfer_hi', score);
      hiMsg.textContent = '🏆 New High Score!';
    } else {
      hiMsg.textContent = hi > 0 ? `Best: ${hi}` : '';
    }
    showScreen('gameover-screen');
  };

  game.onAudioLevel = level => {
    const fill = document.getElementById('level-fill');
    if (fill) fill.style.width = Math.min(100, level * 100).toFixed(0) + '%';
  };
}

function handlePause() {
  if (!game || game.state === 'idle') return;
  game.pause();
  document.getElementById('pause-overlay').classList.remove('hidden');
}

function handleResume() {
  document.getElementById('pause-overlay').classList.add('hidden');
  if (game) game.resume();
}

/* ================================================================
   Spotify integration
   ================================================================ */

async function handleSpotifyButton() {
  if (spotify.isConnected) {
    spotify.disconnect();
    updateSpotifyUI();
    return;
  }

  /* Prompt for Client ID if we don't have one */
  if (!spotify.clientId) {
    const id = prompt(
      'Enter your Spotify Client ID:\n\n' +
      '1. Go to https://developer.spotify.com/dashboard\n' +
      '2. Create an app (free)\n' +
      `3. Add "${location.origin}${location.pathname}" as a Redirect URI\n` +
      '4. Copy the Client ID below:',
      localStorage.getItem('spotify_client_id') || ''
    );
    if (!id?.trim()) return;
    spotify.setClientId(id.trim());
  }

  try {
    await spotify.startAuth(); // redirects to Spotify
  } catch (err) {
    setSpotifyStatus('❌ ' + err.message);
  }
}

function startSpotifyPoll() {
  clearSpotifyPoll();
  spotifyPollTimer = setInterval(() => pollSpotify(false), 12_000);
}

function clearSpotifyPoll() {
  clearInterval(spotifyPollTimer);
  spotifyPollTimer = null;
}

let _lastTrackId = null;

async function pollSpotify(immediate = false) {
  const track = await spotify.getCurrentTrack();

  if (!track) {
    updateNowPlaying(null);
    return;
  }

  updateNowPlaying(track);

  /* Fetch features only when track changes */
  if (immediate || track.id !== _lastTrackId) {
    _lastTrackId = track.id;
    const features = await spotify.getAudioFeatures(track.id);

    if (game) {
      /* Apply modifiers even if features failed (falls back to defaults) */
      const mods = spotify.getGameModifiers();
      game.applySpotifyModifiers(mods);
      console.info('[SpotSurfer] Track:', track.name, '| Modifiers:', mods);
    }
  }
}

function updateNowPlaying(track) {
  const el = document.getElementById('now-playing');
  if (!el) return;
  if (!track) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = `🎵 ${track.artist} – ${track.name}`;
  el.classList.remove('hidden');
}

function updateSpotifyUI() {
  const btn = document.getElementById('spotify-btn');
  if (spotify.isConnected) {
    btn.textContent = '🟢 Disconnect Spotify';
    btn.classList.add('connected');
    setSpotifyStatus('Ready – music modifies difficulty!');
  } else {
    btn.textContent = '🎵 Connect Spotify';
    btn.classList.remove('connected');
    setSpotifyStatus('');
  }
}

function setSpotifyStatus(msg) {
  document.getElementById('spotify-status').textContent = msg;
}
