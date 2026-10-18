import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, toggleSection, stripSections, transposeBody } from '../public/chords.js';
import { DEFAULT_PEDAL, assignBinding, keyBinding, labelFor, makeThrottle, midiBinding, normalizePedal, resolveAction } from '../public/pedal.js';

/* ---------- secoes (refrao / 2a voz) ---------- */
test('parseLines: marcadores somem e as linhas carregam a secao', () => {
  const body = 'G  D\nverso\n{refrao}\nC  G\nrefrao\n{/refrao}\nfim';
  const lines = parseLines(body);
  assert.deepEqual(lines.map((l) => [l.text, l.section]), [['G  D', null], ['verso', null], ['C  G', 'refrao'], ['refrao', 'refrao'], ['fim', null]]);
  assert.equal(lines[2].chord, true);
});

test('parseLines: abrir outra secao troca a atual, fechar volta ao normal; marcador sem par vai ate o fim', () => {
  const lines = parseLines('{refrao}\na\n{voz2}\nb\n{/voz2}\nc');
  assert.deepEqual(lines.map((l) => l.section), ['refrao', 'voz2', null]);
  assert.deepEqual(parseLines('{refrao}\nx\ny').map((l) => l.section), ['refrao', 'refrao']);
  assert.deepEqual(parseLines('{refrao}\nx\n{/voz2}\ny').map((l) => l.section), ['refrao', 'refrao']); // fechar secao diferente nao fecha
});

test('toggleSection marca e desmarca', () => {
  const body = 'a\nb\nc\nd';
  const marked = toggleSection(body, 1, 2, 'refrao');
  assert.equal(marked, 'a\n{refrao}\nb\nc\n{/refrao}\nd');
  assert.equal(toggleSection(marked, 2, 3, 'refrao'), body); // as linhas internas desfazem
  assert.equal(stripSections(marked), body);
});

test('transposicao nao mexe nos marcadores', () => {
  const out = transposeBody('{refrao}\nG   D\nletra\n{/refrao}', 2);
  assert.equal(out, '{refrao}\nA   E\nletra\n{/refrao}');
});

/* ---------- pedais ---------- */
const ev = (o) => ({ key: '', code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...o });

test('keyBinding: usa a posicao fisica, ignora Shift e modificadores soltos', () => {
  assert.equal(keyBinding(ev({ key: 'PageDown', code: 'PageDown' })), 'k:PageDown');
  assert.equal(keyBinding(ev({ key: '+', code: 'Equal', shiftKey: true })), 'k:Equal');
  assert.equal(keyBinding(ev({ key: 'b', code: 'KeyB', ctrlKey: true })), 'k:Ctrl+KeyB');
  assert.equal(keyBinding(ev({ key: 'MediaTrackNext', code: '' })), 'k:MediaTrackNext'); // pedal que manda tecla de midia
  assert.equal(keyBinding(ev({ key: 'Shift', code: 'ShiftLeft' })), null);
  assert.equal(keyBinding(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null);
  assert.equal(keyBinding(ev({ key: 'Unidentified', code: '' })), null);
});

test('midiBinding: so conta pisar; ignora soltar, relogio e canal', () => {
  assert.equal(midiBinding([0x90, 60, 100]), 'm:note:60');
  assert.equal(midiBinding([0x93, 60, 100]), 'm:note:60'); // outro canal = mesmo botao
  assert.equal(midiBinding([0x90, 60, 0]), null); // nota ligada com velocidade 0 = soltar
  assert.equal(midiBinding([0x80, 60, 64]), null);
  assert.equal(midiBinding([0xb0, 64, 127]), 'm:cc:64');
  assert.equal(midiBinding([0xb0, 64, 0]), null);
  assert.equal(midiBinding([0xc0, 5]), 'm:pc:5');
  assert.equal(midiBinding([0xf8]), null);
  assert.equal(midiBinding([0xfe]), null);
  assert.equal(midiBinding(null), null);
});

test('labelFor legivel', () => {
  assert.equal(labelFor('k:PageDown'), 'Page Down');
  assert.equal(labelFor('k:KeyB'), 'B');
  assert.equal(labelFor('k:Digit7'), '7');
  assert.equal(labelFor('k:Ctrl+ArrowRight'), 'Ctrl + Seta →');
  assert.equal(labelFor('m:note:60'), 'MIDI nota 60');
  assert.equal(labelFor('m:cc:64'), 'MIDI controle 64');
  assert.equal(labelFor('m:pc:3'), 'MIDI programa 3');
});

test('padroes, aprendizado e resolucao de acao', () => {
  const cfg = normalizePedal(undefined);
  assert.deepEqual(cfg.bindings.next, ['k:ArrowRight', 'k:PageDown']);
  assert.equal(resolveAction(cfg.bindings, 'k:PageUp'), 'prev');
  assert.equal(resolveAction(cfg.bindings, 'k:KeyZ'), null);

  // pedal que manda "Enter" para avancar e "Backspace" para voltar
  let b = assignBinding(cfg.bindings, 'next', 'k:Enter');
  b = assignBinding(b, 'prev', 'k:Backspace');
  assert.equal(resolveAction(b, 'k:Enter'), 'next');
  assert.equal(resolveAction(b, 'k:Backspace'), 'prev');
  assert.ok(b.next.includes('k:PageDown')); // os padroes continuam

  // um botao so pode ter uma acao: reatribuir move
  b = assignBinding(b, 'toneUp', 'k:Enter');
  assert.equal(resolveAction(b, 'k:Enter'), 'toneUp');
  assert.ok(!b.next.includes('k:Enter'));
});

test('normalizePedal aceita lixo e limita o anti-repeticao', () => {
  const cfg = normalizePedal({ bindings: { next: ['k:A', 5, null], prev: 'x' }, debounce: 99999, midi: 'sim' });
  assert.deepEqual(cfg.bindings.next, ['k:A']);
  assert.deepEqual(cfg.bindings.prev, DEFAULT_PEDAL.bindings.prev); // formato invalido volta ao padrao
  assert.equal(cfg.debounce, 1000);
  assert.equal(cfg.midi, false);
  assert.equal(normalizePedal({ debounce: -5 }).debounce, 0);
  assert.equal(normalizePedal({ bindings: { next: [] } }).bindings.next.length, 0); // lista vazia = usuario removeu tudo
});

test('chave geral do pedal: ligada por padrao, so desliga com false explicito', () => {
  assert.equal(normalizePedal(undefined).enabled, true);
  assert.equal(normalizePedal({}).enabled, true);
  assert.equal(normalizePedal({ enabled: false }).enabled, false);
  assert.equal(normalizePedal({ enabled: 0 }).enabled, true); // valor estranho nao desliga sem querer
});

test('makeThrottle barra toque duplo e libera depois', () => {
  let t = 1000;
  const ok = makeThrottle(250, () => t);
  assert.equal(ok('next'), true);
  t += 100; assert.equal(ok('next'), false); // duplo toque do pedal
  assert.equal(ok('prev'), true); // outra acao nao e afetada
  t += 200; assert.equal(ok('next'), true);
  assert.equal(makeThrottle(0, () => t)('x') && makeThrottle(0, () => t)('x'), true);
});

import { test as t2 } from 'node:test';
t2('keyBinding usa o numero da tecla quando o Android nao informa key/code', () => {
  assert.equal(keyBinding({ key: 'Unidentified', code: '', keyCode: 39 }), 'k:KeyCode39');
  assert.equal(labelFor('k:KeyCode39'), 'Tecla nº 39');
});
