import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jobpilot-library-'));
  const context = await createApp({ dataDir: directory, env: {}, ...options });
  const server = context.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive:true, force:true }); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (route, body, method = 'POST') => fetch(base + route, { method, headers: { 'Content-Type':'application/json' }, ...(body ? {body:JSON.stringify(body)}:{}) });
  return { ...context, request, base };
}
test('public source API generates its own identity, retains region and cannot change immutable URL through PUT', async t => {
  const {request} = await setup(t, { pageSourceOptions: { lookup:async()=>[{address:'8.8.8.8',family:4}] } });
  const body = { id:'cn-fudan-public', name:'某市人社招聘', category:'人社官方招聘', region:'杭州', homepage:'https://hr.company.careers/jobs' };
  const response = await request('/sources', body);
  assert.equal(response.status, 201); const source = await response.json();
  assert.match(source.id, /^custom-page-/); assert.equal(source.region, '杭州');
  const result = await request(`/sources/${source.id}`, {id:'cn-fudan-public',homepage:'https://127.0.0.1/',enabled:false}, 'PUT');
  const updated = await result.json(); assert.equal(updated.id, source.id); assert.equal(updated.homepage,body.homepage); assert.equal(updated.enabled,false);
  assert.equal((await request('/sources',body)).status,400);
});
test('source API refuses nonpublic DNS before persisting configuration', async t => {
  const { request, store } = await setup(t, {pageSourceOptions:{lookup:async()=>[{address:'127.0.0.1',family:4}]}});
  const before=store.read().sources.length;
  assert.equal((await request('/sources',{name:'本机',homepage:'https://hr.company.careers/jobs',category:'企业招聘'})).status,400);
  assert.equal(store.read().sources.length,before);
});
test('library retains mismatching expired vacancies and announcements without an eligibility ingestion gate', async t => {
  const {request,store} = await setup(t);
  const response=await request('/jobs/import',{jobs:[{title:'博士研究员',company:'某实验室',education:'博士',experienceMin:20,deadline:'2000-01-01'},{title:'某学校2026招聘公告',company:'某学校',recordType:'announcement'}]});
  assert.equal(response.status,200);
  const state=await request('/bootstrap',null,'GET').then(r=>r.json());
  const mismatch=state.jobs.find(j=>j.title==='博士研究员');
  assert.equal(mismatch.match.eligibility,'不符合'); assert.equal(mismatch.deadline,'2000-01-01');
  assert.ok(state.jobs.some(j=>j.recordType==='announcement')); assert.equal(store.read().jobs.length,14);
});
test('material API delivers real Word, escaped HTML, Markdown and rejects unsupported output formats', async t => {
  const {request}=await setup(t);
  const material=await request('/materials',{jobId:'j-ai-pm'}).then(r=>r.json());
  assert.ok(material.id); assert.equal(material.isDemo,true);
  const doc=await request(`/materials/${material.id}/download?kind=resume&format=docx`,null,'GET');
  assert.equal(doc.status,200); assert.match(doc.headers.get('content-type'),/wordprocessingml/);
  assert.match(doc.headers.get('content-disposition'),/filename\*=UTF-8/);
  assert.equal(Buffer.from(await doc.arrayBuffer()).subarray(0,2).toString(),'PK');
  const html=await request(`/materials/${material.id}/download?kind=cover-letter&format=html`,null,'GET').then(r=>r.text());
  assert.match(html,/<!doctype html>/i); assert.match(html,/林可/);
  const md=await request(`/materials/${material.id}/download?kind=checklist&format=md`,null,'GET').then(r=>r.text());
  assert.match(md,/核对/);
  assert.equal((await request(`/materials/${material.id}/download?format=pdf`,null,'GET')).status,400);
});
