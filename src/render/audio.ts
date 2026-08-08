/**
 * Sound, synthesized on the fly — no audio files to ship or load.
 *
 * A low hum that rises as the chamber charges, a hit at the implosion, and a
 * shimmer on the reveal. Off by default; browsers also refuse to start audio
 * before a user gesture, and pressing Draw is that gesture.
 */

import type { Phase } from './chamber.ts';

export class Sound {
  private ctx: AudioContext | null = null;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  enabled = false;

  private context(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = globalThis.AudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  onPhase(phase: Phase): void {
    const ctx = this.context();
    if (!ctx) return;

    switch (phase) {
      case 'charge':
        this.startHum(ctx);
        break;
      case 'collapse':
        this.sweepHum(ctx, 180, 0.78);
        break;
      case 'bloom':
        this.stopHum(ctx);
        this.impact(ctx);
        this.shimmer(ctx);
        break;
      default:
        this.stopHum(ctx);
        break;
    }
  }

  private startHum(ctx: AudioContext): void {
    this.stopHum(ctx);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(42, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(96, ctx.currentTime + 1.15);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 1.15);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.5);

    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();

    this.hum = osc;
    this.humGain = gain;
  }

  private sweepHum(ctx: AudioContext, to: number, seconds: number): void {
    this.hum?.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + seconds);
  }

  private stopHum(ctx: AudioContext): void {
    if (!this.hum || !this.humGain) return;
    const osc = this.hum;
    this.humGain.gain.cancelScheduledValues(ctx.currentTime);
    this.humGain.gain.setValueAtTime(this.humGain.gain.value, ctx.currentTime);
    this.humGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.stop(ctx.currentTime + 0.2);
    this.hum = null;
    this.humGain = null;
  }

  private impact(ctx: AudioContext): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }

  private shimmer(ctx: AudioContext): void {
    // A fifth and an octave above, arriving just behind the hit.
    [784, 1176, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + 0.04 + i * 0.045;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.055, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 1);
    });
  }
}
