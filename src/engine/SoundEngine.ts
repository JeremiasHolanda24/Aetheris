const LASER_AUDIO_URL = `${import.meta.env.BASE_URL}assets/audio/Spaceship_laser_cann__3-1795449680461_a36c0711.mp3`;
const ATMOSPHERE_ENTRY_AUDIO_URL = `${import.meta.env.BASE_URL}assets/audio/Spaceship_entering_p__3-1795449171341_080b202b.mp3`;

/**
 * Low-latency Web Audio engine for Starfighter laser cannon bursts
 * and continuous planetary atmosphere re-entry soundscapes.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private laserBuffer: AudioBuffer | null = null;
  private reentryBuffer: AudioBuffer | null = null;
  private rawLaser: Promise<ArrayBuffer | null>;
  private rawReentry: Promise<ArrayBuffer | null>;
  private loadStarted = false;

  private reentrySource: AudioBufferSourceNode | null = null;
  private reentryGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastLaserTime = 0;
  private muted = false;
  private paused = false;
  private disposed = false;

  constructor() {
    const fetchRaw = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
    this.rawLaser = fetchRaw(LASER_AUDIO_URL);
    this.rawReentry = fetchRaw(ATMOSPHERE_ENTRY_AUDIO_URL);
  }

  public unlock(): void {
    if (this.disposed) return;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.18;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.9;

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    if (!this.loadStarted) {
      this.loadStarted = true;
      void this.loadBuffers();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : 0.9,
        this.ctx.currentTime,
        0.04,
      );
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx || this.disposed) return;
    if (paused) {
      void this.ctx.suspend();
    } else if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private async loadBuffers(): Promise<void> {
    if (!this.ctx || this.disposed) return;

    const decodeRaw = async (
      rawPromise: Promise<ArrayBuffer | null>,
    ): Promise<AudioBuffer | null> => {
      try {
        const arr = await rawPromise;
        if (!arr || !this.ctx || this.disposed) return null;
        return await this.ctx.decodeAudioData(arr);
      } catch {
        return null;
      }
    };

    const [laser, reentry] = await Promise.all([
      decodeRaw(this.rawLaser),
      decodeRaw(this.rawReentry),
    ]);

    if (this.disposed) return;
    this.laserBuffer = laser;
    this.reentryBuffer = reentry;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.16));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  public playLaser(): void {
    this.unlock();
    if (
      this.disposed ||
      this.muted ||
      this.paused ||
      !this.ctx ||
      !this.compressor ||
      !this.laserBuffer
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    if (now - this.lastLaserTime < 0.08) return;
    this.lastLaserTime = now;

    const source = this.ctx.createBufferSource();
    source.buffer = this.laserBuffer;
    // Slight pitch variation makes rapid-fire twin wing cannons sound natural
    source.playbackRate.value = 0.96 + Math.random() * 0.09;

    const shotGain = this.ctx.createGain();
    shotGain.gain.setValueAtTime(0.42, now);
    shotGain.gain.exponentialRampToValueAtTime(0.01, now + Math.min(this.laserBuffer.duration, 1.35));

    source.connect(shotGain);
    shotGain.connect(this.compressor);

    source.onended = () => {
      source.disconnect();
      shotGain.disconnect();
    };
    source.start(now, 0, Math.min(this.laserBuffer.duration, 1.4));
  }

  public playGear(extending: boolean): void {
    if (
      this.disposed ||
      this.muted ||
      this.paused ||
      !this.ctx ||
      !this.compressor ||
      this.ctx.state !== 'running'
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const dur = 0.6;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(extending ? 180 : 260, now);
    osc.frequency.linearRampToValueAtTime(extending ? 260 : 180, now + dur);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(extending ? 420 : 520, now);
    filter.frequency.linearRampToValueAtTime(extending ? 580 : 380, now + dur);
    filter.Q.value = 3.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.04);
    gain.gain.setValueAtTime(0.05, now + dur - 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.compressor);

    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  public playTouchdown(): void {
    if (
      this.disposed ||
      this.muted ||
      this.paused ||
      !this.ctx ||
      !this.compressor ||
      this.ctx.state !== 'running'
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const thumpDur = 0.25;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + thumpDur);

    const thumpGain = this.ctx.createGain();
    thumpGain.gain.setValueAtTime(0.2, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + thumpDur);

    osc.connect(thumpGain);
    thumpGain.connect(this.compressor);

    osc.onended = () => {
      osc.disconnect();
      thumpGain.disconnect();
    };
    osc.start(now);
    osc.stop(now + thumpDur + 0.01);

    const noiseDur = 0.14;
    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = this.getNoiseBuffer(this.ctx);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);

    noiseSrc.connect(lp);
    lp.connect(noiseGain);
    noiseGain.connect(this.compressor);

    noiseSrc.onended = () => {
      noiseSrc.disconnect();
      lp.disconnect();
      noiseGain.disconnect();
    };
    noiseSrc.start(now, 0, noiseDur);
  }

  public updateAtmosphereEntry(reentryIntensity: number): void {
    if (
      this.disposed ||
      !this.ctx ||
      !this.compressor ||
      !this.reentryBuffer
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const active = !this.muted && !this.paused && reentryIntensity > 0.04;

    if (active && !this.reentrySource) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.reentryBuffer;
      source.loop = true;
      // Seamless loop across the dense sustained atmospheric roar segment
      const dur = this.reentryBuffer.duration;
      if (dur > 6) {
        source.loopStart = 1.6;
        source.loopEnd = Math.max(4.5, dur - 2.4);
      }

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);

      source.connect(gain);
      gain.connect(this.compressor);
      source.start(now);

      this.reentrySource = source;
      this.reentryGain = gain;
    }

    if (this.reentryGain && this.reentrySource) {
      const targetVol = active
        ? Math.min(0.85, 0.14 + reentryIntensity * 0.72)
        : 0;
      this.reentryGain.gain.setTargetAtTime(targetVol, now, active ? 0.14 : 0.22);
      this.reentrySource.playbackRate.setTargetAtTime(
        0.92 + reentryIntensity * 0.16,
        now,
        0.15,
      );

      if (!active && this.reentryGain.gain.value < 0.005) {
        try {
          this.reentrySource.stop();
        } catch {
          // Ignore if already stopped
        }
        this.reentrySource.disconnect();
        this.reentryGain.disconnect();
        this.reentrySource = null;
        this.reentryGain = null;
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.noiseBuffer = null;
    if (this.reentrySource) {
      try {
        this.reentrySource.stop();
      } catch {
        // Ignore
      }
      this.reentrySource.disconnect();
      this.reentrySource = null;
    }
    if (this.reentryGain) {
      this.reentryGain.disconnect();
      this.reentryGain = null;
    }
    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
    }
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
