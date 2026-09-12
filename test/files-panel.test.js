import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortEntries } from '../src/ui/files-panel.js';

test('folders first, then files, each in dictionary order', () => {
  const out = sortEntries([
    { name: 'b.md', path: '/x/b.md', dir: false },
    { name: 'zeta', path: '/x/zeta', dir: true },
    { name: 'a.md', path: '/x/a.md', dir: false },
    { name: 'alpha', path: '/x/alpha', dir: true },
  ]).map((e) => e.name);
  assert.deepEqual(out, ['alpha', 'zeta', 'a.md', 'b.md']);
});

test('sorting does not mutate the input', () => {
  const input = [{ name: 'b', path: '/b', dir: false }, { name: 'a', path: '/a', dir: true }];
  sortEntries(input);
  assert.equal(input[0].name, 'b');
});
