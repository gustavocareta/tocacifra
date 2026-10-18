import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapPair } from '../public/chords.js';

const chord = '        G                    D                 Em';
const lyric = 'Esta e uma linha de exemplo bem comprida inventada para testar a quebra';

test('wrapPair nao altera linha que cabe', () => {
  assert.deepEqual(wrapPair('C   G', 'la la la', 40), [{ chord: 'C   G', lyric: 'la la la' }]);
});

test('wrapPair quebra em inicio de palavra e respeita a largura', () => {
  const parts = wrapPair(chord, lyric, 30);
  assert.ok(parts.length > 1);
  for (const p of parts) { assert.ok(p.lyric.length <= 30); assert.ok(p.chord.length <= 30); }
  assert.equal(parts.map((p) => p.lyric).join(' '), lyric);
});

test('wrapPair mantem cada acorde sobre a mesma silaba', () => {
  const parts = wrapPair(chord, lyric, 30);
  const where = (c, l, ch) => l[c.indexOf(ch)];
  // "G" estava sobre a letra de indice 8 ('a' de "uma"? posicao original) e continua sobre a mesma letra
  assert.equal(where(parts[0].chord, parts[0].lyric, 'G'), lyric[chord.indexOf('G')]);
  const all = parts.map((p) => p.chord.trim()).join(' ').split(/\s+/).filter(Boolean);
  assert.deepEqual(all, ['G', 'D', 'Em']);
});

test('wrapPair de linha so de acordes quebra entre acordes', () => {
  const parts = wrapPair('C  G  Am  F  C  G  Am  F  C  G  Am  F', '', 12);
  for (const p of parts) assert.ok(p.chord.length <= 12 && !/^\s|\s$/.test(p.chord));
  assert.equal(parts.map((p) => p.chord).join(' ').split(/\s+/).join(' '), 'C G Am F C G Am F C G Am F');
});

test('wrapPair com palavra maior que a linha corta no limite', () => {
  const parts = wrapPair('', 'a'.repeat(50), 20);
  assert.ok(parts.every((p) => p.lyric.length <= 20));
  assert.equal(parts.map((p) => p.lyric).join(''), 'a'.repeat(50));
});
