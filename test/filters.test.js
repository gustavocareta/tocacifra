import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facets, filterSongs, norm } from '../public/filters.js';

const songs = [
  { id: 1, title: 'Alfa', artist: 'Zé Ramalho', style: 'MPB', tone: 'G' },
  { id: 2, title: 'Beta', artist: 'ze ramalho', style: 'MPB', tone: 'Am' }, // mesma pessoa, digitada sem acento
  { id: 3, title: 'Gama', artist: 'Leo Jaime', style: 'Rock', tone: 'G' },
  { id: 4, title: 'Ação e Reação', artist: 'Banda Teste', style: 'Rock', tone: '' },
  { id: 5, title: 'Sem artista', artist: '', style: '', tone: 'C' },
];

test('norm ignora acento, caixa e espacos extras', () => {
  assert.equal(norm('  Zé   Ramalho '), 'ze ramalho');
  assert.equal(norm(null), '');
});

test('facets agrupa variacoes, conta e ordena', () => {
  const f = facets(songs);
  assert.deepEqual(f.artists.map((a) => [a.name, a.count]), [['Banda Teste', 1], ['Leo Jaime', 1], ['Zé Ramalho', 2]]);
  assert.deepEqual(f.styles.map((a) => [a.name, a.count]), [['MPB', 2], ['Rock', 2]]);
  assert.deepEqual(f.tones.map((a) => a.name), ['Am', 'C', 'G']);
});

test('filtro por artista pega as variacoes do mesmo nome', () => {
  const key = facets(songs).artists.find((a) => a.name === 'Zé Ramalho').key;
  assert.deepEqual(filterSongs(songs, { artist: key }).map((s) => s.id), [1, 2]);
});

test('filtros combinam e a busca ignora acento', () => {
  assert.deepEqual(filterSongs(songs, { style: 'rock' }).map((s) => s.id), [3, 4]);
  assert.deepEqual(filterSongs(songs, { style: 'rock', term: 'acao' }).map((s) => s.id), [4]);
  assert.deepEqual(filterSongs(songs, { tone: 'g' }).map((s) => s.id), [1, 3]);
  assert.deepEqual(filterSongs(songs, { term: 'RAMALHO' }).map((s) => s.id), [1, 2]);
  assert.deepEqual(filterSongs(songs, { artist: 'inexistente' }), []);
  assert.equal(filterSongs(songs, {}).length, 5);
});
