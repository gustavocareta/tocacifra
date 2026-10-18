import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, compareVersions, shaFromNotes, shortSha } from '../public/update.js';

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

test('shaFromNotes le o identificador da release', () => {
  assert.equal(shaFromNotes(`texto qualquer [build:${SHA}]`), SHA);
  assert.equal(shaFromNotes('sem marca'), null);
  assert.equal(shaFromNotes(undefined), null);
});

test('compareVersions', () => {
  assert.equal(compareVersions(SHA, SHA).state, 'current');
  assert.equal(compareVersions(SHA, SHA2).state, 'available');
  assert.equal(compareVersions('dev', SHA).state, 'unknown');
  assert.equal(compareVersions(SHA, null).state, 'unknown');
  assert.equal(shortSha(SHA), 'aaaaaaa');
  assert.equal(shortSha('dev'), 'dev');
});

test('checkForUpdate compara version.json do app com a release', async () => {
  const fake = (remote) => async (url) => (String(url).includes('version.json')
    ? { ok: true, json: async () => ({ sha: SHA }) }
    : { ok: true, json: async () => ({ body: `[build:${remote}]` }) });
  assert.equal((await checkForUpdate(fake(SHA))).state, 'current');
  assert.equal((await checkForUpdate(fake(SHA2))).state, 'available');
  await assert.rejects(checkForUpdate(async (url) => (String(url).includes('version.json') ? { ok: true, json: async () => ({ sha: SHA }) } : { ok: false })));
});
