/**
 * AudioManager – wraps the Web Audio API for microphone input.
 *
 * Falls back to a procedurally-generated waveform if the user denies
 * microphone permission, so the game is always playable.
 */
class AudioManager {
  constructor() {
    this.context   = null;
    this.analyser  = null;
    this.source    = null;
    this.isActive  = false;   // true when real mic data is flowing

    /* shared buffer sizes */
    this.fftSize      = 2048;
    this.bufferLength = this.fftSize / 2;

    /* simulation state */
    this._simPhase = 0;
    this._simTarget = 0.2;
    this._simCurrent = 0.2;
  }

  /* ----------------------------------------------------------
   * Initialise – returns true when mic was granted
   * ---------------------------------------------------------- */
  async init() {
    try {
      /* AudioContext must be created after a user gesture */
      this.context = new (window.AudioContext || window.webkitAudioContext)();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize               = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.82;

      this.source = this.context.createMediaStreamSource(stream);
      this.source.connect(this.analyser);

      this.bufferLength = this.analyser.frequencyBinCount;
      this.isActive = true;
      return true;
    } catch (err) {
      console.warn('[AudioManager] Mic unavailable – using simulation.', err.message);
      this.isActive = false;
      return false;
    }
  }

  /* ----------------------------------------------------------
   * Return the current RMS amplitude, 0–1
   * ---------------------------------------------------------- */
  getAmplitude() {
    if (this.isActive && this.analyser) {
      const data = new Uint8Array(this.bufferLength);
      this.analyser.getByteTimeDomainData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] / 128) - 1;
        sum += v * v;
      }
      /* scale up so normal speech / breath reads around 0.3–0.8 */
      return Math.min(1, Math.sqrt(sum / data.length) * 6);
    }
    return this._simulateAmplitude();
  }

  /* ----------------------------------------------------------
   * Return raw time-domain waveform buffer (Uint8Array, 0–255)
   * ---------------------------------------------------------- */
  getWaveformData() {
    if (this.isActive && this.analyser) {
      const data = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(data);
      return data;
    }
    return this._simulateWaveform();
  }

  /* ----------------------------------------------------------
   * Return frequency-domain data (Uint8Array, 0–255)
   * ---------------------------------------------------------- */
  getFrequencyData() {
    if (this.isActive && this.analyser) {
      const data = new Uint8Array(this.bufferLength);
      this.analyser.getByteFrequencyData(data);
      return data;
    }
    return new Uint8Array(this.bufferLength).fill(0);
  }

  /* ----------------------------------------------------------
   * Manual boost – lets touch/keyboard push amplitude up
   * ---------------------------------------------------------- */
  applyBoost(value = 0.6) {
    this._boostLevel = Math.min(1, value);
    clearTimeout(this._boostTimer);
    this._boostTimer = setTimeout(() => { this._boostLevel = 0; }, 100);
  }

  /* ----------------------------------------------------------
   * Simulation helpers
   * ---------------------------------------------------------- */
  _simulateAmplitude() {
    this._simPhase += 0.04;

    /* random walk for target */
    this._simTarget += (Math.random() - 0.5) * 0.06;
    this._simTarget  = Math.max(0.1, Math.min(0.7, this._simTarget));

    /* smooth towards target */
    this._simCurrent += (this._simTarget - this._simCurrent) * 0.1;

    const base = this._simCurrent + 0.1 * Math.sin(this._simPhase * 1.3);
    const boost = this._boostLevel || 0;
    return Math.max(0, Math.min(1, base + boost));
  }

  _simulateWaveform() {
    const buf = new Uint8Array(this.fftSize);
    const amp = (this._simCurrent || 0.2) * 50;
    for (let i = 0; i < buf.length; i++) {
      buf[i] = 128
        + amp * Math.sin((i * 0.08) + this._simPhase)
        + (amp * 0.3) * Math.sin((i * 0.03) + this._simPhase * 0.7);
    }
    this._simPhase += 0.02;
    return buf;
  }

  destroy() {
    if (this.context) {
      this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
