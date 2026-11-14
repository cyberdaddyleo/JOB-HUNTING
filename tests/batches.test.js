import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createService } from '../server/service.js';
import { createBatchService, applicationFingerprint } from '../server/batches.js';
import { mergeJobs, invalidateProfileReview } from '../server/safety.js';

const env = { ENABLE_OUTBOUND: 'true', SMTP_HOST: 'smtp.fixture.invalid', SMTP_USER: 'test', SMTP_PASS: 'test', SMTP_FROM: 'me@company.careers' };
async function setup(t, sendMail, count = 3) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jobpilot-batch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createStore(directory);
  await store.update(state => {
    state.profile = { ...state.profile, name: '王宁', email: 'me@company.careers', bio: '负责产品设计', resumeText: '2023年参与数据平台项目，负责需求访谈与原型设计。' };
    state.jobs = []; state.applications = []; state.materials = []; state.batches = [];
    state.settings.dailyLimit = 2;
    mergeJobs(state.jobs, Array.from({ length: count }, (_, i) => ({ title: `产品经理${i}`, company: `招聘单位${i}`, contactEmail: `hr${i}@company.careers`, skills: ['SQL'], sourceUrl: `https://company.careers/jobs/${i}` })));
  });
  const sent = [];
  const service = createService(store, { env, dataDir: directory, sendMail: async mail => { sent.push(mail); return sendMail ? sendMail(mail) : { messageId: mail.messageId }; } });
  const batches = createBatchService(store, service, { intervalMs: 0 });
  const prepare = () => batches.prepare(store.read().jobs.map(j => j.id));
  const review = async () => {
    const apps = store.read().applications;
    await batches.review({ applicationIds: apps.map(a => a.id), confirmed: true, profileRevision: store.read().profileRevision || 0, reviews: apps.map(a => ({ id: a.id, updatedAt: a.updatedAt, reviewToken: applicationFingerprint(a) })) });
    return store.read().applications.map(a=>({...a,reviewToken:applicationFingerprint(a)}));
  };
  return { directory, store, service, batches, sent, prepare, review };
}
test('batch prepares distinct job materials and sends real DOCX bytes within shared daily limit', async t => {
  const { store, batches, sent, prepare, review } = await setup(t);
  const result = await prepare();
  assert.equal(result.prepared, 3);
  assert.equal(store.read().materials.length, 3);
  assert.ok(store.read().applications.every(a => a.materialId));
  const reviewed = await review();
  const task = await batches.start({ applicationIds: reviewed.map(a => a.id), confirmed: true, profileRevision: 0, reviews: reviewed });
  const finished = await batches.wait(task.id);
  assert.deepEqual(finished.items.map(x => x.status), ['sent', 'sent', 'skipped']);
  assert.match(finished.items[2].error, /上限/);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].attachment.content.subarray(0, 2).toString(), 'PK');
  assert.match(sent[0].attachment.name, /\.docx$/);
  assert.equal(store.read().outboundLedger.filter(x => x.batchId === task.id).length, 2);
});
test('batch cancellation lets current SMTP finish and prevents subsequent deliveries', async t => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const { batches, sent, prepare, review } = await setup(t, async mail => { started(); await new Promise(resolve => { release = resolve; }); return { messageId: mail.messageId }; });
  await prepare(); const reviewed = await review();
  const task = await batches.start({ applicationIds: reviewed.map(a => a.id), confirmed: true, profileRevision: 0, reviews: reviewed });
  await waiting; await batches.cancel(task.id); release();
  const finished = await batches.wait(task.id);
  assert.equal(finished.status, 'cancelled');
  assert.deepEqual(finished.items.map(x => x.status), ['sent', 'cancelled', 'cancelled']);
  assert.equal(sent.length, 1);
});
test('changed content after batch creation is not sent even if it is queued', async t => {
  let storeRef;
  const ctx = await setup(t, async mail => {
    await storeRef.update(state => { const next = state.applications.find(a => a.to !== mail.to && !a.sendState); if (next) next.body = '内容已变化'; });
    return { messageId: mail.messageId };
  }, 2);
  storeRef = ctx.store;
  await ctx.prepare(); const reviewed = await ctx.review();
  const task = await ctx.batches.start({ applicationIds: reviewed.map(a => a.id), confirmed: true, profileRevision: 0, reviews: reviewed });
  const done = await ctx.batches.wait(task.id);
  assert.deepEqual(done.items.map(x => x.status), ['sent', 'skipped']);
  assert.match(done.items[1].error, /内容.*变化/);
  assert.equal(ctx.sent.length, 1);
});
test('review requires unchanged snapshot and current material revision', async t => {
  const { store, batches, prepare } = await setup(t, null, 1);
  await prepare(); const item = store.read().applications[0];
  await assert.rejects(batches.review({ applicationIds: [item.id], confirmed: true, profileRevision: 0, reviews: [{ id: item.id, updatedAt: 'old', reviewToken:applicationFingerprint(item) }] }), /草稿已变化/);
  await store.update(state => invalidateProfileReview(state, '档案更新'));
  await assert.rejects(batches.review({ applicationIds: [item.id], confirmed: true, profileRevision: 1, reviews: [{ id: item.id, updatedAt: item.updatedAt, reviewToken:applicationFingerprint(item) }] }), /定制简历已过期/);
});
test('material from old profile is blocked in direct-send path too', async t => {
  const { store, service, sent, prepare } = await setup(t, null, 1);
  await prepare(); const item = store.read().applications[0];
  await store.update(state => { invalidateProfileReview(state, '档案更新'); state.applications[0].profileRevision = state.profileRevision; });
  await assert.rejects(service.sendApplication(item.id, true), /求职文件与岗位或当前档案不一致/);
  assert.equal(sent.length, 0);
});
test('draft review cannot silently approve a profile or attachment changed in another tab', async t => {
  const { store, batches, prepare } = await setup(t, null, 1);
  await prepare();
  await store.update(state => { state.applications[0].materialId = null; });
  const app = store.read().applications[0];
  await store.update(state => invalidateProfileReview(state, '其他标签页修改附件'));
  await assert.rejects(batches.review({ applicationIds: [app.id], confirmed: true, profileRevision: 0, reviews: [{ id: app.id, updatedAt: app.updatedAt, reviewToken: applicationFingerprint(app) }] }), /档案或附件已变化/);
});
test('send confirmation binds exact displayed content as well as profile revision', async t => {
  const { store, batches, prepare, review, sent } = await setup(t, null, 1);
  await prepare(); const reviewed = await review();
  await store.update(state => { state.applications[0].body = '另一标签页重新审核的新内容'; });
  await assert.rejects(batches.start({ applicationIds: reviewed.map(a=>a.id), confirmed:true, profileRevision:0, reviews:reviewed }), /确认内容已变化/);
  assert.equal(sent.length, 0);
});
test('chosen tailored document does not depend on an unused missing original resume', async t => {
  const { store, service, sent, prepare } = await setup(t, null, 1);
  await prepare();
  await store.update(state => { state.profile.resumeFile = {name:'missing.pdf'}; state.resumeAsset = {filename:'missing.pdf',mime:'application/pdf'}; });
  await service.sendApplication(store.read().applications[0].id, true);
  assert.equal(sent.length, 1); assert.match(sent[0].attachment.name, /\.docx$/);
});
test('expired vacancies and undivided announcements cannot become applications', async t => {
  const { store, service } = await setup(t, null, 2);
  await store.update(state => { state.jobs[0].deadline = '2000-01-01'; state.jobs[1].recordType = 'announcement'; });
  await assert.rejects(service.createApplication(store.read().jobs[0].id), /截止日/);
  await assert.rejects(service.createApplication(store.read().jobs[1].id), /招聘公告/);
});
test('source identities retain separate positions sharing one official announcement', () => {
  const existing = [];
  const jobs = ['医师', '科研'].map((title, i) => ({ title, company: '医院', sourceUrl: 'https://rsj.sh.gov.cn/notice.html', sourceId: 'cn-shanghai-rsj', externalId: String(i), publishedAt: '2026-11-10', deadline: '2099-01-01', applicationMethod: '邮件报名' }));
  assert.deepEqual(mergeJobs(existing, jobs), { added: 2, skipped: 0 });
  assert.deepEqual(mergeJobs(existing, jobs), { added: 0, skipped: 2 });
  assert.equal(existing[0].deadline, '2099-01-01');
});
test('restart migrates sources without overwriting profile and interrupts unfinished task', async t => {
  const { store, directory } = await setup(t, null, 1);
  await store.update(state => { state.batches.push({ id: 'restart', status: 'running', items: [{ applicationId: 'some', status: 'sending' }] }); });
  const reopened = await createStore(directory);
  assert.equal(reopened.read().profile.name, '王宁');
  assert.equal(reopened.read().batches[0].status, 'interrupted');
  assert.ok(reopened.read().sources.some(s => s.id === 'cn-ncss'));
});
