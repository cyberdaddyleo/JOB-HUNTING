import { mkdir, readFile, open, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { seedState } from './seed.js';
import { sourceCatalog } from './source-catalog.js';

export async function createStore(directory, initialize = seedState) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'state.json');
  let state;
  const persist = async value => {
    const temporary = path.join(directory, `.state-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temporary, filename);
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
  };
  try {
    if ((await stat(filename)).size > 25 * 1024 * 1024) throw new Error('数据文件过大');
    state = JSON.parse(await readFile(filename, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('数据文件不是对象');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('本地数据文件无法读取；为保护已有记录，未重置数据。请检查 data/state.json 或恢复备份。');
    state = initialize();
    await persist(state);
  }
  // Add new capabilities without replacing an existing profile or imported records.
  state.materials ||= [];
  state.batches ||= [];
  state.sources ||= [];
  for (const source of sourceCatalog) {
    const current = state.sources.find(item => item.id === source.id);
    if (!current) state.sources.unshift(structuredClone(source));
    else Object.assign(current, { description: source.description, homepage: source.homepage, category: source.category, canSync: source.canSync, minIntervalMinutes: source.minIntervalMinutes });
  }
  for (const batch of state.batches.filter(b => ['queued', 'running'].includes(b.status))) {
    batch.status = 'interrupted'; batch.finishedAt = new Date().toISOString();
    for (const item of batch.items) if (['pending', 'sending'].includes(item.status)) { item.status = 'skipped'; item.error = '服务已重启，未自动重试；请先核对发件邮箱'; }
  }
  state.version = 2;
  await persist(state);
  let pending = Promise.resolve();
  return {
    read: () => structuredClone(state),
    update(mutation) {
      const operation = pending.then(async () => {
        const next = structuredClone(state);
        const result = await mutation(next);
        await persist(next);
        state = next;
        return structuredClone(result);
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
