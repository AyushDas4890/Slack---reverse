import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlash } from './slash.ts';

test('non-slash text is ignored', () => {
  assert.equal(parseSlash('hello'), null);
});

test('remind parses duration', () => {
  assert.deepEqual(parseSlash('/remind me stretch in 10m'), { kind: 'remind', text: 'stretch', inMs: 600_000, label: '10m' });
});

test('remind without duration gives usage', () => {
  assert.equal(parseSlash('/remind me nothing')?.kind, 'usage');
});

test('shrug appends emoticon', () => {
  assert.deepEqual(parseSlash('/shrug meh'), { kind: 'say', text: 'meh ¯\\_(ツ)_/¯' });
});

test('recap and explain parse', () => {
  assert.deepEqual(parseSlash('/recap'), { kind: 'recap' });
  assert.deepEqual(parseSlash('/explain SLO'), { kind: 'explain', term: 'SLO' });
  assert.equal(parseSlash('/explain')?.kind, 'usage');
});
