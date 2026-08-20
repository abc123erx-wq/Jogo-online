/**
 * Sintetiza os sons do mod (WAV 16-bit PCM mono 22050 Hz) sem dependências:
 *   fute_kick    - chute da bola
 *   fute_bounce  - quique da bola
 *   fute_pickup  - pegar a bola
 *   fute_count   - beep de confirmação
 *   fute_whistle - apito do árbitro (2 toques)
 *   fute_goal    - gol (torcida + apito)
 *   fute_hat     - fanfarra de hat-trick
 *   fute_crowd   - ambiente de torcida (loop curto, re-disparado)
 *   fute_end     - fim de jogo (apito longo + torcida)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RATE = 22050;
const OUT = path.join(__dirname, '..', 'src', 'resource', 'sounds');
fs.mkdirSync(OUT, { recursive: true });

function writeWav(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);       // fmt chunk size
  buf.writeUInt16LE(1, 20);        // PCM
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);        // block align
  buf.writeUInt16LE(16, 34);       // bits
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log(file, '->', (buf.length / 1024).toFixed(1), 'KB');
}

function noise() { return Math.random() * 2 - 1; }
function lpf(x, cutoff, rate = RATE) {
  const a = 1 / (1 + rate / (2 * Math.PI * cutoff));
  let y = 0;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); out[i] = y; }
  return out;
}
function env(s, a, d, sus = 0, rel = 0) {
  // envelope AD(sustain)R simplificado em samples
  const A = Math.floor(a * RATE), D = Math.floor(d * RATE), R = Math.floor(rel * RATE);
  for (let i = 0; i < s.length; i++) {
    let g;
    if (i < A) g = i / A;
    else if (i < A + D) g = 1 - (1 - sus) * ((i - A) / D);
    else if (i < s.length - R) g = sus;
    else g = sus * (1 - (i - (s.length - R)) / R);
    s[i] *= Math.max(0, g);
  }
  return s;
}
function mix(...arrays) {
  const n = Math.max(...arrays.map((a) => a.length));
  const out = new Float32Array(n);
  for (const a of arrays) for (let i = 0; i < a.length; i++) out[i] += a[i];
  return out;
}
function at(arr, start, into) {
  for (let i = 0; i < arr.length && start + i < into.length; i++) into[start + i] += arr[i];
  return into;
}
function tone(freq, dur, shape = 'sine', vol = 0.5, slideTo = null) {
  const n = Math.floor(dur * RATE);
  const s = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = slideTo ? freq + (slideTo - freq) * (i / n) : freq;
    ph += (2 * Math.PI * f) / RATE;
    let v;
    if (shape === 'sine') v = Math.sin(ph);
    else if (shape === 'square') v = Math.sign(Math.sin(ph));
    else if (shape === 'pluck') v = Math.sin(ph) * Math.exp(-3 * t) + 0.3 * Math.sin(3 * ph) * Math.exp(-5 * t);
    else v = Math.sin(ph);
    s[i] = v * vol;
  }
  return env(s, 0.005, 0.01, 0.7, Math.max(0.05, dur * 0.4));
}

// ---------- sons ----------

// chute: impacto surdo + ruído
{
  const n = Math.floor(0.22 * RATE);
  const s = new Float32Array(n);
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i++) nz[i] = noise();
  const nzf = lpf(nz, 700);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 130 - 70 * (i / n);
    ph += (2 * Math.PI * f) / RATE;
    s[i] = 0.65 * Math.sin(ph) * Math.exp(-t * 26) + 0.5 * nzf[i] * Math.exp(-t * 30);
  }
  writeWav('fute_kick.wav', s);
}

// quique
{
  const n = Math.floor(0.12 * RATE);
  const s = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 95 - 50 * (i / n);
    ph += (2 * Math.PI * f) / RATE;
    s[i] = 0.55 * Math.sin(ph) * Math.exp(-t * 34) + 0.18 * noise() * Math.exp(-t * 40);
  }
  writeWav('fute_bounce.wav', s);
}

// pegar
{
  const s = mix(tone(430, 0.05, 'sine', 0.4, 700), tone(760, 0.12, 'pluck', 0.5, 980));
  writeWav('fute_pickup.wav', s);
}

// beep
{
  writeWav('fute_count.wav', tone(990, 0.12, 'sine', 0.5));
}

// apito: 2 toques de siren
function whistle(dur, f0 = 2350, amp = 0.4) {
  const n = Math.floor(dur * RATE);
  const s = new Float32Array(n);
  let ph = 0, phA = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    ph += (2 * Math.PI * f0) / RATE;
    phA += (2 * Math.PI * 38) / RATE;
    s[i] = Math.sin(ph) * (0.65 + 0.35 * Math.sin(phA)) * amp;
  }
  return env(s, 0.01, 0.02, 1, 0.08);
}
{
  const n = Math.floor(1.0 * RATE);
  const s = new Float32Array(n);
  at(whistle(0.3), 0, s);
  at(whistle(0.55), Math.floor(0.45 * RATE), s);
  writeWav('fute_whistle.wav', s);
}

// torcida: ruído filtrado com inchaço
function crowd(dur, vol = 0.4, attack = 0.35) {
  const n = Math.floor(dur * RATE);
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i++) nz[i] = noise();
  const nzf = lpf(nz, 1100);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const swell = t < attack ? t / attack : Math.max(0, 1 - (t - attack) / (dur - attack));
    const chatter = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.7 * t) * Math.sin(2 * Math.PI * 0.23 * t + 1.3);
    s[i] = nzf[i] * swell * chatter * vol;
  }
  return s;
}

// gol: torcida + toques + apito final
{
  const dur = 2.6;
  const n = Math.floor(dur * RATE);
  const s = new Float32Array(n);
  at(crowd(dur, 0.5, 0.5), 0, s);
  // "vai vai vai"
  for (const t0 of [0.45, 0.85, 1.25]) at(tone(520, 0.16, 'pluck', 0.25, 880), Math.floor(t0 * RATE), s);
  at(whistle(0.5, 2350, 0.35), Math.floor(1.9 * RATE), s);
  writeWav('fute_goal.wav', s);
}

// hat-trick: fanfarra
{
  const dur = 2.2;
  const n = Math.floor(dur * RATE);
  const s = new Float32Array(n);
  at(crowd(dur, 0.4, 0.2), 0, s);
  const notes = [392, 523, 659, 784, 1047]; // G4 C5 E5 G5 C6
  let t0 = 0.05;
  for (const f of notes) {
    at(tone(f, 0.2, 'pluck', 0.5), Math.floor(t0 * RATE), s);
    at(tone(f / 2, 0.2, 'sine', 0.3), Math.floor(t0 * RATE), s);
    t0 += f === 1047 ? 0 : 0.17;
    if (f === 784) t0 += 0.08;
  }
  at(tone(1047, 0.8, 'pluck', 0.55), Math.floor(t0 * RATE), s);
  at(tone(524, 0.8, 'pluck', 0.4), Math.floor(t0 * RATE), s);
  at(whistle(0.45, 2350, 0.3), Math.floor(t0 * RATE + 0.05 * RATE), s);
  writeWav('fute_hat.wav', s);
}

// ambiente de torcida (loop curto)
{
  const dur = 3.0;
  const n = Math.floor(dur * RATE);
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i++) nz[i] = noise();
  const nzf = lpf(nz, 900);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.3 * t);
    // fade in/out para o loop soar contínuo
    const fade = Math.min(1, t / 0.5, (dur - t) / 0.5);
    s[i] = nzf[i] * swell * fade * 0.3;
  }
  writeWav('fute_crowd.wav', s);
}

// fim de jogo: apito longo + torcida
{
  const dur = 2.4;
  const n = Math.floor(dur * RATE);
  const s = new Float32Array(n);
  at(crowd(dur, 0.45, 0.6), 0, s);
  at(whistle(1.1, 2350, 0.42), 0, s);
  writeWav('fute_end.wav', s);
}

console.log('✅ Sons gerados em', OUT);
