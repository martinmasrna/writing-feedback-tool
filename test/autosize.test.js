/**
 * jsdom does no layout (see dom.js), so scrollHeight is always 0 here — every
 * test fakes it, the same way `getBoundingClientRect` gets faked elsewhere,
 * to check the mechanics rather than a real browser's arithmetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { autoGrow } from '../src/ui/autosize.js';

const doc = installDom();

function fakeTextarea(scrollHeight) {
  const ta = doc.createElement('textarea');
  Object.defineProperty(ta, 'scrollHeight', { value: scrollHeight, configurable: true });
  return ta;
}

test('sizes to content as soon as it is wired up', () => {
  const ta = fakeTextarea(84);
  autoGrow(ta);
  assert.equal(ta.style.height, '84px');
});

test('typing grows it again, not just the initial call', () => {
  const ta = fakeTextarea(40);
  autoGrow(ta);
  assert.equal(ta.style.height, '40px');
  Object.defineProperty(ta, 'scrollHeight', { value: 130, configurable: true });
  ta.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(ta.style.height, '130px');
});

test('height is reset to auto before measuring, so it can shrink back down too', () => {
  // scrollHeight only reports the *current* box's content — if the inline
  // height from the last grow were left in place, a shrink would measure
  // against the old (too-tall) box and never come back down.
  const ta = fakeTextarea(130);
  autoGrow(ta);
  const seen = [];
  Object.defineProperty(ta.style, 'height', {
    get() { return this._h; },
    set(v) { seen.push(v); this._h = v; },
    configurable: true,
  });
  Object.defineProperty(ta, 'scrollHeight', { value: 40, configurable: true });
  ta.dispatchEvent(new doc.defaultView.Event('input'));
  assert.deepEqual(seen, ['auto', '40px']);
});
