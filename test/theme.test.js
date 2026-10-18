import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheme, resolveTheme } from '../public/theme.js';

test('normalizeTheme aceita so os tres valores', () => {
  for (const v of ['auto', 'light', 'dark']) assert.equal(normalizeTheme(v), v);
  for (const v of [undefined, null, '', 'escuro', 'DARK', 5]) assert.equal(normalizeTheme(v), 'auto');
});

test('resolveTheme: escolha explicita vence o aparelho; auto segue o aparelho', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('lixo', true), 'dark'); // valor invalido = auto
});
