import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importBackup, parseBackup } from '../public/migrate.js';

const backup = {
  songs: [
    { ref: 0, title: 'A', artist: 'X', style: '', tone: 'C', capo: 0, body: 'C\nla' },
    { ref: 1, title: 'B', artist: 'Y', style: '', tone: 'G', capo: 2, body: 'G\nli' },
  ],
  setlists: [{ title: 'Show', style: '', items: [0, { label: 'Parte 2' }, 1, 99] }],
};

test('parseBackup rejeita formato invalido', () => {
  assert.throws(() => parseBackup('nao json'));
  assert.throws(() => parseBackup('{"songs":[]}'));
  assert.equal(parseBackup(JSON.stringify(backup)).songs.length, 2);
});

test('importBackup cria musicas e repertorio, pula duplicadas e mapeia ids', async () => {
  const songs = []; const sets = [];
  const api = {
    putSong: async (_id, b) => { songs.push(b); return { id: 100 + songs.length }; },
    putSetlist: async (_id, b) => { sets.push(b); return { id: 1 }; },
  };
  const r = await importBackup(backup, { songs: [{ id: 7, title: 'a', artist: 'x' }], setlists: [] }, api);
  assert.equal(r.songsAdded, 1); assert.equal(r.songsSkipped, 1); assert.equal(r.setsAdded, 1);
  assert.deepEqual(sets[0].items, [{ songId: 7 }, { label: 'Parte 2' }, { songId: 101 }]);
  const again = await importBackup(backup, { songs: [], setlists: [{ title: 'SHOW' }] }, api);
  assert.equal(again.setsSkipped, 1);
});
