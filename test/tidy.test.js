import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChordLine, lyricFor, tidyCifra } from '../public/chords.js';

test('tidyCifra junta acordes com a letra quando ha linha em branco no meio', () => {
  const body = 'C     G\n\nLinha de exemplo\n\nAm    F\n\n\nOutra linha';
  assert.equal(tidyCifra(body), 'C     G\nLinha de exemplo\n\nAm    F\nOutra linha');
});

test('tidyCifra nao mexe em cifra que ja esta certa nem cola em titulos de parte', () => {
  const ok = 'C   G\nLinha\n\nAm\nOutra';
  assert.equal(tidyCifra(ok), ok);
  const head = 'Intro: C G\n\n[Refrão]\nLetra';
  assert.equal(tidyCifra(head), head);
  assert.equal(tidyCifra('C G\n\n[Refrão]\nLetra'), 'C G\n\n[Refrão]\nLetra');
});

test('lyricFor pula linhas em branco e ignora acordes seguidos de acordes', () => {
  const L = (t) => ({ text: t, chord: isChordLine(t) });
  const lines = ['C G', '', 'letra', 'Am', 'F'].map(L);
  assert.equal(lyricFor(lines, 0), 2);
  assert.equal(lyricFor(lines, 3), -1);
});

test('isChordLine tolera parenteses e marcas de repeticao', () => {
  assert.equal(isChordLine('( D G )'), true);
  assert.equal(isChordLine('D G (2x)'), true);
  assert.equal(isChordLine('(2x)'), false);
  assert.equal(isChordLine('Eu vou cantar essa musica'), false);
});
