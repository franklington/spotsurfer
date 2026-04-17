# SpotSurfer 🌊

**SpotSurfer** is a Progressive Web App (PWA) game where you *surf the audio wave* in full **vaporwave** style.  
Your voice (or any sound picked up by your microphone) is the controller — speak louder to rise, softer to descend. Dodge the neon obstacles and rack up a high score!

---

## Features

| Feature | Description |
|---------|-------------|
| 🎤 **Microphone control** | Real-time Web Audio API amplitude drives the surfer's height |
| 🎮 **Touch / keyboard fallback** | Hold the screen (or Space/↑) to boost upward — works without a mic |
| 🌊 **Vaporwave aesthetic** | Retro perspective grid, animated sun, neon color palette, scanlines |
| 🚧 **Obstacle dodging** | Neon pillars with gaps; gap size and spawn rate increase with score |
| 🎵 **Spotify integration** | Connect Spotify to display the current track and tune difficulty based on energy & danceability |
| 📱 **PWA** | Installable on iOS / Android / desktop; works fully offline after first load |

---

## Quick Start

### Local dev server (HTTPS required for microphone access in most browsers)

```bash
npm install
npm start          # opens http://localhost:3000 via `serve`
```

For microphone access you may need to run with HTTPS. An easy option:

```bash
npx serve . --ssl-cert <cert.pem> --ssl-key <key.pem>
```

Or deploy to any static host (Netlify, Vercel, GitHub Pages, etc.) — HTTPS is provided automatically.

---

## Spotify Integration

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create a **free** app.  
2. Add your site URL (e.g. `https://your-site.com/`) to **Redirect URIs** in the app settings.  
3. Click **🎵 Connect Spotify** in SpotSurfer and paste your **Client ID** when prompted.  
4. Authorise — you'll be redirected back and connected automatically.  

> **Note:** Spotify's `/audio-features` endpoint is deprecated for newly created apps (Nov 2024).  
> SpotSurfer falls back gracefully — if features are unavailable the game uses sensible defaults.

---

## Controls

| Input | Action |
|-------|--------|
| 🎤 Mic (loud) | Surfer goes **UP** |
| 🎤 Mic (quiet) | Surfer goes **DOWN** |
| 👆 Touch & hold | Boost **UP** |
| ⎵ Space / ↑ Arrow | Boost **UP** (keyboard) |

---

## Regenerating Icons

PNG icons are pre-generated but can be rebuilt from the SVG source:

```bash
npm run icons
```

---

## Technology

- **Vanilla HTML / CSS / JS** – no framework, no bundler
- **Web Audio API** – `getUserMedia`, `AnalyserNode` for real-time amplitude & waveform
- **Canvas API** – 60 fps game loop with layered vaporwave rendering
- **Spotify Web API** – PKCE OAuth (no server required), playback state & audio features
- **Service Worker** – cache-first strategy for offline support
