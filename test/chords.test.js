import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChord, isChordLine, transposeChord, transposeBody, guessKey, stepsBetween } from '../public/chords.js';

test('reconhece acordes', () => {
  for (const c of ['G', 'Am', 'C#m7', 'Bb', 'D7(9)', 'G/B', 'Em7/D', 'Asus4', 'F#dim']) assert.ok(isChord(c), c);
  for (const w of ['Amor', 'casa', 'Bebe', 'x', '(Intro)']) assert.ok(!isChord(w), w);
});

test('linha de acordes x linha de letra', () => {
  assert.ok(isChordLine('(Intro) G G/B C C/D'));
  assert.ok(isChordLine('   C        D'));
  assert.ok(!isChordLine('E eu'));
  assert.ok(!isChordLine('Uma frase qualquer de letra'));
  assert.ok(!isChordLine(''));
});

test('transposicao de acordes', () => {
  assert.equal(transposeChord('G', 2), 'A');
  assert.equal(transposeChord('B', 1), 'C');
  assert.equal(transposeChord('G/B', 2), 'A/C#');
  assert.equal(transposeChord('Bb', 2), 'C');
  assert.equal(transposeChord('Ebm7', -1), 'Dm7');
  assert.equal(transposeChord('A', -12), 'A');
});

test('transposicao do corpo so altera linhas de acordes e mantem alinhamento', () => {
  const body = 'G      D\nEu e voce\nC#m   F#';
  const out = transposeBody(body, 2).split('\n');
  assert.equal(out[0], 'A      E');
  assert.equal(out[1], 'Eu e voce');
  assert.equal(out[2], 'D#m   G#');
});

test('tom provavel e distancia entre tons', () => {
  assert.equal(guessKey('(Intro)\nAm  G\nletra'), 'Am');
  assert.equal(stepsBetween('G', 'A'), 2);
  assert.equal(stepsBetween('A', 'G'), 10);
});
