import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, freqToNote, nearestString, noteToFreq, TUNINGS } from '../public/tuner.js';

const SR = 44100;
const tone = (f, n = 4096, harmonics = [1, 0.5, 0.25]) =>
  Float32Array.from({ length: n }, (_, i) => harmonics.reduce((s, a, k) => s + a * Math.sin((2 * Math.PI * f * (k + 1) * i) / SR), 0) * 0.3);

test('frequencias de referencia', () => {
  assert.ok(Math.abs(noteToFreq('A4') - 440) < 1e-9);
  assert.ok(Math.abs(noteToFreq('E2') - 82.4069) < 0.01);
  assert.ok(Math.abs(noteToFreq('C4') - 261.626) < 0.01);
});

test('nota e centavos', () => {
  assert.deepEqual(freqToNote(440), { name: 'A', octave: 4, cents: 0, midi: 69 });
  assert.equal(freqToNote(446).cents, 23);
  assert.equal(freqToNote(82.41).name, 'E');
});

test('detecta as cordas do violao com erro menor que 3 centavos', () => {
  for (const s of TUNINGS.violao.strings) {
    const f = noteToFreq(s);
    const got = detectPitch(tone(f, 8192), SR);
    assert.ok(got, s);
    const err = Math.abs(1200 * Math.log2(got / f));
    assert.ok(err < 3, `${s}: ${err.toFixed(2)} centavos`);
  }
});

test('detecta desafinado e escolhe a corda-alvo', () => {
  const f = noteToFreq('A2') * 2 ** (-20 / 1200); // 20 centavos abaixo
  const got = detectPitch(tone(f, 8192), SR);
  const near = nearestString(got, TUNINGS.violao.strings);
  assert.equal(near.note, 'A2');
  assert.ok(Math.abs(near.cents + 20) <= 3, String(near.cents));
});

test('silencio e ruido nao geram nota', () => {
  assert.equal(detectPitch(new Float32Array(4096), SR), null);
  let seed = 1;
  const noise = Float32Array.from({ length: 4096 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4);
  assert.equal(detectPitch(noise, SR), null);
});
