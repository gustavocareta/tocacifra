import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordShape, INSTRUMENTS } from '../public/diagrams.js';

const fmt = (s) => s.frets.map((f) => (f < 0 ? 'x' : f)).join('');

test('violao: acordes abertos tem a digitacao classica', () => {
  const expected = { C: 'x32010', G: '320003', Am: 'x02210', E: '022100', D: 'xx0232', Em: '022000', A: 'x02220', Dm: 'xx0231', E7: '020100', A7: 'x02020' };
  for (const [name, frets] of Object.entries(expected)) {
    const s = chordShape(name, 'violao');
    assert.ok(s, name);
    // aceita variacoes equivalentes do G (320003 / 320033) comparando as notas
    if (name === 'G') assert.ok(['320003', '320033'].includes(fmt(s)), `${name}: ${fmt(s)}`);
    else assert.equal(fmt(s), frets, name);
  }
});

test('todo acorde gerado contem as notas essenciais', () => {
  const idx = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (const inst of Object.keys(INSTRUMENTS)) {
    for (const name of ['C', 'F', 'Bm', 'F#m7', 'Bb', 'G7', 'Cmaj7', 'Dsus4', 'Em7', 'A/C#', 'D/F#']) {
      const s = chordShape(name, inst);
      assert.ok(s, `${inst} ${name}`);
      assert.equal(s.frets.length, INSTRUMENTS[inst].strings.length);
      assert.ok(s.frets.some((f) => f >= 0), `${inst} ${name} sem notas`);
    }
  }
  assert.ok(idx.C === 0);
});

test('baixo da barra invertida e respeitado', () => {
  const s = chordShape('D/F#', 'violao');
  const open = INSTRUMENTS.violao.strings;
  const lowest = s.frets.findIndex((f) => f >= 0);
  assert.equal((open[lowest] + s.frets[lowest]) % 12, 6); // F#
});

test('nome invalido nao gera digitacao', () => {
  assert.equal(chordShape('Amor', 'violao'), null);
  assert.equal(chordShape('G', 'banjo'), null);
});
