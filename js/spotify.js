/**
 * SpotifyManager – Spotify Web API integration via PKCE OAuth.
 *
 * Provides:
 *  - Authentication (PKCE, no server needed)
 *  - Currently-playing track info
 *  - Audio features → game difficulty modifiers
 *
 * Usage:
 *  1. Create a free Spotify app at https://developer.spotify.com/dashboard
 *  2. Add your site URL to "Redirect URIs" in the app settings
 *  3. Paste your Client ID when prompted in the game
 */
class SpotifyManager {
  constructor() {
    this.clientId      = localStorage.getItem('spotify_client_id') || '';
    this.redirectUri   = `${location.origin}${location.pathname}`;
    this.accessToken   = null;
    this.currentTrack  = null;
    this.trackFeatures = null;
    this.isConnected   = false;

    this._scopes = [
      'user-read-playback-state',
      'user-read-currently-playing',
    ].join(' ');
  }

  /* ================================================================
     Auth – PKCE flow (no client secret needed)
     ================================================================ */

  setClientId(id) {
    this.clientId = id;
    localStorage.setItem('spotify_client_id', id);
  }

  async startAuth() {
    if (!this.clientId) throw new Error('Spotify Client ID is required.');

    const verifier   = this._randomB64(32);
    const challenge  = await this._sha256B64(verifier);

    sessionStorage.setItem('spotify_pkce_verifier', verifier);

    const params = new URLSearchParams({
      client_id:             this.clientId,
      response_type:         'code',
      redirect_uri:          this.redirectUri,
      scope:                 this._scopes,
      code_challenge_method: 'S256',
      code_challenge:        challenge,
    });

    location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  /**
   * Call this on page load. Returns true if the URL contains ?code=
   * and the token exchange succeeds.
   */
  async handleCallback() {
    const params = new URLSearchParams(location.search);
    const code   = params.get('code');
    const error  = params.get('error');

    if (error || !code) return false;

    const verifier = sessionStorage.getItem('spotify_pkce_verifier');
    if (!verifier) return false;

    const clientId = this.clientId || localStorage.getItem('spotify_client_id');
    if (!clientId) return false;

    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          client_id:     clientId,
          grant_type:    'authorization_code',
          code,
          redirect_uri:  this.redirectUri,
          code_verifier: verifier,
        }),
      });

      if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);

      const data = await res.json();
      this._saveTokens(data);
      this.clientId = clientId;

      /* Remove auth params from URL */
      history.replaceState({}, '', location.pathname);
      return true;
    } catch (err) {
      console.error('[SpotifyManager] handleCallback:', err);
      return false;
    }
  }

  /** Re-use an existing unexpired token from localStorage */
  async checkExistingToken() {
    const token   = localStorage.getItem('spotify_token');
    const expires = localStorage.getItem('spotify_expires');
    if (token && expires && Date.now() < parseInt(expires, 10)) {
      this.accessToken = token;
      this.isConnected = true;

      /* Attempt a silent refresh using the stored refresh token */
      const refresh = localStorage.getItem('spotify_refresh');
      if (refresh && Date.now() > parseInt(expires, 10) - 60_000) {
        await this._refresh(refresh).catch(() => {});
      }
      return true;
    }
    return false;
  }

  disconnect() {
    this.accessToken   = null;
    this.isConnected   = false;
    this.currentTrack  = null;
    this.trackFeatures = null;
    localStorage.removeItem('spotify_token');
    localStorage.removeItem('spotify_refresh');
    localStorage.removeItem('spotify_expires');
  }

  /* ================================================================
     API calls
     ================================================================ */

  /** Returns a currentTrack object or null */
  async getCurrentTrack() {
    if (!this.isConnected) return null;

    try {
      const res = await this._apiFetch('/me/player/currently-playing');
      if (!res || res.status === 204) return null;
      if (!res.ok) { this._handleApiError(res); return null; }

      const data = await res.json();
      if (!data?.item) return null;

      this.currentTrack = {
        id:       data.item.id,
        name:     data.item.name,
        artist:   data.item.artists.map(a => a.name).join(', '),
        albumArt: data.item.album?.images?.[0]?.url || null,
        playing:  data.is_playing,
      };
      return this.currentTrack;
    } catch {
      return null;
    }
  }

  /**
   * Fetch audio features for a track.
   * Note: Spotify deprecated this endpoint for new apps in Nov 2024.
   * We handle the 403 / 404 gracefully and fall back to defaults.
   */
  async getAudioFeatures(trackId) {
    if (!this.isConnected || !trackId) return null;

    try {
      const res = await this._apiFetch(`/audio-features/${trackId}`);
      if (!res?.ok) return null;

      const data = await res.json();
      this.trackFeatures = {
        energy:       data.energy       ?? 0.5,
        tempo:        data.tempo        ?? 120,
        valence:      data.valence      ?? 0.5,
        danceability: data.danceability ?? 0.5,
      };
      return this.trackFeatures;
    } catch {
      return null;
    }
  }

  /**
   * Convert track features into game difficulty modifiers.
   * Falls back sensibly if features are unavailable.
   */
  getGameModifiers() {
    const f = this.trackFeatures || {};
    const energy       = f.energy       ?? 0.5;
    const danceability = f.danceability ?? 0.5;

    return {
      speedMultiplier:   0.7 + energy * 0.8,          // 0.7 – 1.5×
      gapSizeMultiplier: 1.4 - danceability * 0.6,    // 0.8 – 1.4×
      spawnInterval:     null,                          // auto
    };
  }

  /* ================================================================
     Private helpers
     ================================================================ */

  async _apiFetch(path) {
    if (!this.accessToken) return null;
    return fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  _handleApiError(res) {
    if (res.status === 401) {
      /* Try refresh */
      const refresh = localStorage.getItem('spotify_refresh');
      if (refresh) this._refresh(refresh).catch(() => this.disconnect());
    }
  }

  async _refresh(refreshToken) {
    const clientId = this.clientId || localStorage.getItem('spotify_client_id');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     clientId,
      }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    const data = await res.json();
    this._saveTokens(data);
  }

  _saveTokens(data) {
    this.accessToken = data.access_token;
    this.isConnected = true;
    localStorage.setItem('spotify_token',   data.access_token);
    localStorage.setItem('spotify_expires', Date.now() + data.expires_in * 1000);
    if (data.refresh_token) {
      localStorage.setItem('spotify_refresh', data.refresh_token);
    }
  }

  /* PKCE crypto helpers */
  _randomB64(bytes) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async _sha256B64(str) {
    const data   = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}
