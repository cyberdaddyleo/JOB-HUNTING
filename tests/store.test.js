import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';

test('concurrent mutations persist atomically and aborted changes never leak', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jobpilot-store-'));
  try {
    const store = await createStore(dir, () => ({ count: 0 }));
    await Promise.all(Array.from({ length: 20 }, () => store.update(state => { state.count++; })));
    assert.equal(store.read().count, 20);
    await assert.rejects(store.update(state => { state.count = 100; throw new Error('abort'); }));
    assert.equal(store.read().count, 20);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')).count, 20);
    const reloaded = await createStore(dir, () => ({ count: -1 }));
    assert.equal(reloaded.read().count, 20);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('corrupt existing data is never overwritten with demonstration records', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jobpilot-corrupt-'));
  try {
    await writeFile(path.join(dir, 'state.json'), '{broken');
    await assert.rejects(createStore(dir), /数据文件/);
    assert.equal(await readFile(path.join(dir, 'state.json'), 'utf8'), '{broken');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
