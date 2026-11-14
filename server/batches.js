import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fail, validEmail, HttpError } from './safety.js';

const now = () => new Date().toISOString();
const find = (items, id) => items.find(x => x.id === id) || fail('申请或任务不存在', 404);
export function applicationFingerprint(item) {
  return createHash('sha256').update(JSON.stringify([item.id, item.to, item.subject, item.body, item.materialId || '', item.profileRevision || 0, item.reviewedAt, item.reviewedProfileRevision])).digest('hex');
}
function ids(value) {
  if (!Array.isArray(value) || !value.length || value.length > 30 || value.some(id => typeof id !== 'string' || id.length > 100)) fail('每批请选择1–30条记录');
  return [...new Set(value)];
}
const errorText = error => error instanceof HttpError ? error.message : '处理失败，请检查本地服务后重试';

export function createBatchService(store, service, { intervalMs = 2000 } = {}) {
  const active = new Map();
  const batchService = {
    async prepare(jobIds) {
      const results = [];
      for (const jobId of ids(jobIds)) {
        try {
          const application = await service.createApplication(jobId);
          if (!application.sentAt && !application.sendState && application.status !== 'queued') {
            const material = await service.createMaterial(jobId);
            await store.update(state => {
              const item = find(state.applications, application.id);
              if (item.sentAt || item.sendState || item.status === 'queued') return;
              item.materialId = material.id;
              item.updatedAt = now();
            });
          }
          results.push({ jobId, applicationId: application.id, status: 'prepared' });
        } catch (error) { results.push({ jobId, status: 'failed', error: errorText(error) }); }
      }
      return { results, prepared: results.filter(x => x.status === 'prepared').length, failed: results.filter(x => x.status === 'failed').length };
    },
    async review({ applicationIds, confirmed, reviews, profileRevision }) {
      const selected = ids(applicationIds);
      if (confirmed !== true) fail('请逐项核对收件人、正文和附件后明确确认');
      if (!Array.isArray(reviews) || selected.some(id => !reviews.find(r => r.id === id && typeof r.updatedAt === 'string'))) fail('请重新打开批量审核，获取最新内容');
      return store.update(state => {
        if (profileRevision !== (state.profileRevision || 0)) fail('档案或附件已变化，请刷新并重新审核', 409);
        const items = selected.map(id => find(state.applications, id));
        for (const item of items) {
          if (reviews.find(r => r.id === item.id).updatedAt !== item.updatedAt) fail('草稿已变化，请重新打开审核并核对', 409);
          if (reviews.find(r => r.id === item.id).reviewToken !== applicationFingerprint(item)) fail('草稿或审核状态已变化，请重新核对', 409);
          if (!['draft', 'queued'].includes(item.status) || item.sentAt || item.sendState) fail('仅可审核未发送的草稿或队列', 409);
          if (!validEmail(item.to) || !item.subject?.trim() || !item.body?.trim()) fail(`${item.company}：缺少收件邮箱或邮件内容，请先补充`);
          if (item.materialId) {
            const material = find(state.materials || [], item.materialId);
            if (material.jobId !== item.jobId || material.profileRevision !== (state.profileRevision || 0)) fail('定制简历已过期，请先重新生成并选择', 409);
          }
        }
        for (const item of items) {
          item.status = 'queued'; item.reviewedAt = now(); item.updatedAt = now(); item.reviewedProfileRevision = state.profileRevision || 0;
          item.events.push({ at: now(), text: '用户逐项核对收件人、正文和附件，批量审核通过' });
        }
        return items;
      });
    },
    async start({ applicationIds, confirmed, profileRevision, reviews }) {
      const selected = ids(applicationIds);
      if (confirmed !== true) fail('请确认发送本批已审核申请');
      const batch = await store.update(state => {
        if (profileRevision !== (state.profileRevision || 0)) fail('档案或附件已变化，请刷新并重新确认发送', 409);
        state.batches ||= [];
        if (state.batches.some(b => ['queued', 'running'].includes(b.status))) fail('已有批量任务运行中，请等待完成或取消', 409);
        const items = selected.map(id => {
          const app = find(state.applications, id);
          if (!Array.isArray(reviews) || reviews.find(r => r.id === id)?.reviewToken !== applicationFingerprint(app)) fail('发送确认内容已变化，请重新核对', 409);
          if (app.status !== 'queued' || !app.reviewedAt || app.reviewedProfileRevision !== (state.profileRevision || 0) || app.sentAt || app.sendState) fail('所选记录包含未经当前档案审核或已发送的申请', 409);
          return { applicationId: id, company: app.company, jobTitle: app.jobTitle, fingerprint: applicationFingerprint(app), status: 'pending' };
        });
        const task = { id: randomUUID(), status: 'queued', items, createdAt: now(), cancelRequested: false };
        state.batches.unshift(task);
        state.batches = state.batches.slice(0, 100);
        return task;
      });
      const work = run(batch.id).catch(async () => {
        await store.update(state => { const task = find(state.batches, batch.id); task.status = 'interrupted'; task.finishedAt = now(); });
      }).finally(() => active.delete(batch.id));
      active.set(batch.id, work);
      return batch;
    },
    get(id) { return find(store.read().batches || [], id); },
    async cancel(id) {
      return store.update(state => {
        const task = find(state.batches, id);
        if (['queued', 'running'].includes(task.status)) { task.cancelRequested = true; task.cancelledAt = now(); }
        return task;
      });
    },
    async wait(id) { await active.get(id); return batchService.get(id); },
  };
  async function run(id) {
    await store.update(state => { find(state.batches, id).status = 'running'; });
    for (const entry of batchService.get(id).items) {
      if (batchService.get(id).cancelRequested) break;
      const proceed = await store.update(state => {
        const task = find(state.batches, id);
        if (task.cancelRequested) return false;
        task.items.find(x => x.applicationId === entry.applicationId).status = 'sending';
        return true;
      });
      if (!proceed) break;
      let status = 'sent', error;
      try { await service.sendApplication(entry.applicationId, true, false, { batchId: id, fingerprint: entry.fingerprint }); }
      catch (e) { status = e instanceof HttpError && e.status < 500 ? 'skipped' : 'failed'; error = errorText(e); }
      await store.update(state => {
        const item = find(state.batches, id).items.find(x => x.applicationId === entry.applicationId);
        Object.assign(item, { status, ...(error ? { error } : {}), finishedAt: now() });
      });
      if (intervalMs > 0 && batchService.get(id).items.some(x => x.status === 'pending') && !batchService.get(id).cancelRequested) await delay(intervalMs);
    }
    await store.update(state => {
      const task = find(state.batches, id);
      for (const item of task.items) if (item.status === 'pending') { item.status = 'cancelled'; item.error = '用户取消，未发送'; }
      task.status = task.cancelRequested ? 'cancelled' : 'completed'; task.finishedAt = now();
    });
  }
  return batchService;
}
