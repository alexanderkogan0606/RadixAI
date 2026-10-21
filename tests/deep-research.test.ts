import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native TypeScript tests require the explicit extension.
import {runDeepResearch} from '../lib/deep-research.ts';

test('Deep research continues saved checkpoints sequentially, including empty successful batches', async () => {
  const calls: unknown[] = [], progress: number[] = []; let active = 0;
  const result = await runDeepResearch({query: 'corporate acquisitions', batches: 3, shouldStop: () => false,
    request: async (query, parent) => { assert.equal(active++, 0); calls.push([query, parent]); await Promise.resolve(); active--; return {id: `saved-${calls.length}`, providers: [{status: 'empty'}], search: {canContinue: true, batch: calls.length - 1, totalDocuments: 0}}; },
    onBatch: (_, count) => progress.push(count)});
  assert.deepEqual(calls, [['corporate acquisitions', undefined], ['Find more', 'saved-1'], ['Find more', 'saved-2']]);
  assert.deepEqual(progress, [1, 2, 3]); assert.equal(result.reason, 'budget');
});

test('Stop keeps the current saved batch; resume uses its server checkpoint', async () => {
  let stop = false; const calls: unknown[] = [];
  const result = await runDeepResearch({query: '', continueFrom: 'persisted-parent', batches: 20, shouldStop: () => stop,
    request: async (query, parent) => { calls.push([query, parent]); stop = true; return {id: 'persisted-child', search: {canContinue: true, batch: 5, totalDocuments: 90}}; }, onBatch: () => {}});
  assert.equal(result.reason, 'stopped'); assert.equal(result.completed, 1); assert.deepEqual(calls, [['Find more', 'persisted-parent']]);
});

test('Deep research pauses on total provider failure, terminates on exhausted filings, and bounds runs', async () => {
  for (const [response, reason] of [
    [{id: 'saved', providers: [{status: 'rate-limited'}, {status: 'timeout'}], search: {canContinue: true, batch: 1, totalDocuments: 4}}, 'unavailable'],
    [{id: 'saved', search: {canContinue: false, batch: 0, totalDocuments: 1}}, 'complete'],
    [undefined, 'error'],
  ] as const) {
    let count = 0;
    const result = await runDeepResearch({query: 'q', batches: 20, shouldStop: () => false, request: async () => {count++; return response;}, onBatch: () => {}});
    assert.equal(count, 1); assert.equal(result.reason, reason);
  }
  let count = 0;
  await runDeepResearch({query: 'q', batches: 999, shouldStop: () => false, request: async () => ({id: String(++count), search: {canContinue: true, batch: count, totalDocuments: count}}), onBatch: () => {}});
  assert.equal(count, 20);
});
