import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docRef } from '../src/doc-links.js';
import { render, installDom } from './dom.js';

installDom();

test('a markdown path in any spelling is a document reference', () => {
  assert.equal(docRef('~/Work/company/partnership/PROBLEM.md'), '~/Work/company/partnership/PROBLEM.md');
  assert.equal(docRef('VIDEOS.md'), 'VIDEOS.md');
  assert.equal(docRef('../knowledge/icp.md#the-reader'), '../knowledge/icp.md');
  assert.equal(docRef('src/notes.md:12'), 'src/notes.md');
});

test('code that is not a document path is left alone', () => {
  for (const s of ['cleanupPeriodDays', 'tools/serve.js', 'https://example.com/a.md', 'npm run dev', '']) {
    assert.equal(docRef(s), null, s);
  }
});

test('the rendered view marks references and nothing else', () => {
  const { host } = render('Read `PROBLEM.md` and [the icp](../icp.md), not `serve.js`.\n');
  const refs = [...host.querySelectorAll('[data-ref]')].map((n) => n.dataset.ref);
  assert.deepEqual(refs, ['PROBLEM.md', '../icp.md']);
});
