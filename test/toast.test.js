import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { createToast } from '../src/ui/toast.js';

const doc = installDom();

test('shows the message and turns the toast on', () => {
  const node = doc.createElement('div');
  const toast = createToast(node);
  toast('Copied.');
  assert.equal(node.textContent, 'Copied.');
  assert.equal(node.classList.contains('on'), true);
});

test('a longer message stays on screen longer, within the floor and ceiling', () => {
  const calls = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { calls.push(ms); return realSetTimeout(fn, 0); };
  try {
    const toast = createToast(doc.createElement('div'));
    toast('Copied.');
    toast('a'.repeat(200));
    assert.equal(calls[0], 2400, 'a short message still gets a floor, not near-zero');
    assert.equal(calls[1], 7000, 'a very long message is capped, not left on screen indefinitely');
    assert.ok(calls[1] > calls[0]);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('a second toast replaces the first and its timer, rather than stacking', () => {
  const node = doc.createElement('div');
  const toast = createToast(node);
  const cleared = [];
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.clearTimeout = (id) => { cleared.push(id); return realClearTimeout(id); };
  try {
    toast('First.');
    const firstTimer = cleared.length; // clearTimeout(null) on the very first call — a no-op
    toast('Second.');
    assert.equal(node.textContent, 'Second.');
    assert.equal(cleared.length, firstTimer + 1, 'the first message\'s timer is cancelled, not left to fire later');
    assert.notEqual(cleared[firstTimer], null, 'and it cancels a real pending timer, not another no-op');
  } finally {
    globalThis.clearTimeout = realClearTimeout;
  }
});
