import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

const key = 'sk-local-private-test-value';
const config = { baseUrl: 'https://model.example/v1', model: 'chat-test', apiKey: key };
const completion = value => Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }] });

async function setup(t, options = {}) {
  const directory = options.dataDir || await mkdtemp(path.join(tmpdir(), 'jobpilot-ai-config-'));
  const context = await createApp({ env: {}, ...options, dataDir: directory });
  const server = context.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (!options.dataDir) await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { ...context, directory, request };
}

test('AI configuration survives restart with private permissions and never enters exports or bootstrap', async t => {
  const { request, directory } = await setup(t);
  assert.equal((await request('/ai-config')).body.source, 'none');
  const saved = await request('/ai-config', 'PUT', config);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { baseUrl: config.baseUrl, model: config.model, hasApiKey: true, configured: true, source: 'local' });
  const filename = path.join(directory, 'ai-config.json');
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).apiKey, key);
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), []);
  for (const route of ['/ai-config', '/bootstrap', '/export']) assert.ok(!JSON.stringify((await request(route)).body).includes(key));
  assert.ok(!(await readFile(path.join(directory, 'state.json'), 'utf8')).includes(key));
  const restarted = await setup(t, { dataDir: directory });
  assert.deepEqual((await restarted.request('/ai-config')).body, saved.body);
  assert.equal((await restarted.request('/bootstrap')).body.capabilities.ai, true);
});

test('blank keys preserve environment or local credentials while explicit removal survives restart without env fallback', async t => {
  const env = { AI_BASE_URL: config.baseUrl, AI_API_KEY: 'env-private-key', AI_MODEL: 'env-model', SMTP_HOST: 'smtp.example', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'u@example.org', ENABLE_OUTBOUND: 'true' };
  const calls = [];
  const { request, directory } = await setup(t, { env, fetchImpl: async (_url, options) => { calls.push(options); return completion({ ok: true }); } });
  assert.equal((await request('/ai-config')).body.source, 'environment');
  assert.equal((await request('/ai-config', 'PUT', { baseUrl: config.baseUrl, model: 'new-model', apiKey: '  ' })).status, 200);
  assert.equal((await request('/ai-config/test', 'POST', {})).status, 200);
  assert.equal(calls[0].headers.Authorization, 'Bearer env-private-key');
  const cleared = await request('/ai-config', 'PUT', { clearApiKey: true });
  assert.equal(cleared.body.hasApiKey, false);
  assert.equal(cleared.body.configured, false);
  const restarted = await setup(t, { dataDir: directory, env });
  assert.equal((await restarted.request('/ai-config')).body.source, 'local');
  const caps = (await restarted.request('/bootstrap')).body.capabilities;
  assert.equal(caps.ai, false);
  assert.equal(caps.smtp, true);
  assert.equal(caps.outboundEnabled, true);
  assert.equal((await request('/ai-config/test', 'POST', {})).status, 400);
  assert.equal(calls.length, 1);
  assert.equal(env.AI_API_KEY, 'env-private-key');
});

test('saved local configuration overrides stale invalid environment values at restart', async t => {
  const { request, directory } = await setup(t);
  await request('/ai-config', 'PUT', config);
  const restarted = await setup(t, { dataDir: directory, env: { AI_BASE_URL: 'obsolete invalid endpoint', AI_MODEL: 'stale\nmodel', AI_API_KEY: 'bad\nkey' } });
  assert.deepEqual((await restarted.request('/ai-config')).body, { baseUrl: config.baseUrl, model: config.model, hasApiKey: true, configured: true, source: 'local' });
  assert.equal((await restarted.request('/bootstrap')).body.capabilities.ai, true);
});

test('invalid legacy environment settings leave the app usable and discard the old key until a valid configuration is saved', async t => {
  for (const invalid of [
    { AI_BASE_URL: 'https://old.example/v1/chat/completions' },
    { AI_BASE_URL: 'http://old.example/v1' },
    { AI_MODEL: 'invalid\nmodel' },
  ]) {
    const calls = [];
    const oldKey = 'old-environment-private-key';
    const { request } = await setup(t, { env: { AI_BASE_URL: 'https://old.example/v1', AI_MODEL: 'old-model', AI_API_KEY: oldKey, ...invalid }, fetchImpl: async (url, options) => { calls.push({ url, options }); return completion({ ok: true }); } });
    const initial = await request('/ai-config');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.baseUrl, '');
    assert.equal(initial.body.model, '');
    assert.equal(initial.body.hasApiKey, false);
    assert.equal(initial.body.configured, false);
    assert.equal(initial.body.source, 'environment');
    assert.match(initial.body.warning, /环境变量.*已停用/);
    assert.equal((await request('/bootstrap')).body.capabilities.ai, false);
    for (const route of ['/ai-config', '/bootstrap', '/export']) assert.ok(!JSON.stringify((await request(route)).body).includes(oldKey));
    const attempted = await request('/ai-config/test', 'POST', { baseUrl: config.baseUrl, model: config.model });
    assert.equal(attempted.status, 400);
    assert.ok(!JSON.stringify(attempted.body).includes(oldKey));
    assert.equal(calls.length, 0);
    const saved = await request('/ai-config', 'PUT', config);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.configured, true);
    assert.equal(saved.body.warning, undefined);
    assert.equal((await request('/ai-config')).body.warning, undefined);
    assert.equal((await request('/bootstrap')).body.capabilities.ai, true);
    assert.equal((await request('/ai-config/test', 'POST', {})).status, 200);
    assert.equal(calls[0].url, 'https://model.example/v1/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`);
  }
});

test('changed API endpoints cannot receive a saved key unless the user re-enters it', async t => {
  const calls = [];
  const { request } = await setup(t, { fetchImpl: async (url, options) => { calls.push({ url, options }); return completion({ ok: true }); } });
  await request('/ai-config', 'PUT', config);
  const changed = { baseUrl: 'https://another.example/v1', model: 'other-model', apiKey: '' };
  for (const [route, method] of [['/ai-config', 'PUT'], ['/ai-config/test', 'POST']]) assert.equal((await request(route, method, changed)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('/ai-config')).body.baseUrl, config.baseUrl);
  assert.equal((await request('/ai-config/test', 'POST', { ...changed, apiKey: 'new-endpoint-key' })).status, 200);
  assert.equal(calls[0].url, 'https://another.example/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer new-endpoint-key');
  assert.equal((await request('/ai-config')).body.baseUrl, config.baseUrl);
  assert.equal((await request('/ai-config', 'PUT', { ...changed, clearApiKey: true })).status, 200);
  assert.equal((await request('/ai-config')).body.hasApiKey, false);
});

test('connection testing uses candidate input without saving or sending any profile data', async t => {
  const calls = [];
  const { request, directory } = await setup(t, { fetchImpl: async (url, options) => { calls.push({ url, options }); return completion({ ok: true }); } });
  const result = await request('/ai-config/test', 'POST', config);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.model, config.model);
  assert.ok(result.body.latencyMs >= 0);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, config.model);
  assert.equal(payload.response_format.type, 'json_object');
  assert.equal(typeof payload.temperature, 'number');
  assert.ok(payload.max_tokens > 0);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(payload).includes((await request('/bootstrap')).body.profile.name));
  assert.equal((await request('/ai-config')).body.hasApiKey, false);
  assert.ok(!(await readdir(directory)).includes('ai-config.json'));
});

test('connection failures never fall back to success or disclose provider errors or credentials', async t => {
  let response = () => new Response(`provider echoed ${key}`, { status: 401 });
  const { request } = await setup(t, { fetchImpl: (...args) => response(...args) });
  for (const next of [
    () => new Response(`provider echoed ${key}`, { status: 401 }),
    () => new Response('rate limited', { status: 429 }),
    () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => completion({ wrong: true }),
    () => completion('not an object'),
    () => new Response('x'.repeat(170000)),
    () => new Response('', { status: 302, headers: { Location: 'https://evil.example/' } }),
    () => { throw new Error(`network detail ${key}`); },
  ]) {
    response = next;
    const failed = await request('/ai-config/test', 'POST', config);
    assert.equal(failed.status, 502);
    assert.equal(failed.body.ok, undefined);
    assert.ok(typeof failed.body.error === 'string' && failed.body.error.length > 5);
    assert.ok(!JSON.stringify(failed.body).includes(key));
  }
});

test('connection tests abort slow requests and return a safe timeout rather than pending forever', async t => {
  let aborted = false;
  const { request } = await setup(t, { aiTestTimeoutMs: 15, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(new Error(`timeout with ${key}`)); }, { once: true });
  }) });
  const failed = await request('/ai-config/test', 'POST', config);
  assert.equal(failed.status, 502);
  assert.equal(aborted, true);
  assert.match(failed.body.error, /超时/);
  assert.ok(!failed.body.error.includes(key));
});

test('local keys survive blank saves and clear works with an incomplete draft configuration', async t => {
  let authorization;
  const { request } = await setup(t, { fetchImpl: async (_url, options) => { authorization = options.headers.Authorization; return completion({ ok: true }); } });
  await request('/ai-config', 'PUT', config);
  assert.equal((await request('/ai-config', 'PUT', { ...config, apiKey: '   ', model: 'renamed-model' })).status, 200);
  assert.equal((await request('/ai-config/test', 'POST', {})).status, 200);
  assert.equal(authorization, `Bearer ${key}`);
  const cleared = await request('/ai-config', 'PUT', { baseUrl: '', model: '', clearApiKey: true });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.configured, false);
  assert.equal(cleared.body.hasApiKey, false);
});

test('invalid endpoints, secret controls and cross-site configuration requests are rejected before network access', async t => {
  let calls = 0;
  const { request } = await setup(t, { fetchImpl: async () => { calls++; return completion({ ok: true }); } });
  for (const baseUrl of ['http://remote.example/v1', 'https://u:p@example.org/v1', 'https://example.org/v1?secret=1', 'https://example.org/v1#fragment', 'https://example.org/v1/chat/completions', 'https://example.org/v1\n']) {
    assert.equal((await request('/ai-config', 'PUT', { ...config, baseUrl })).status, 400);
  }
  for (const patch of [{ apiKey: 'bad\nkey' }, { apiKey: 'x'.repeat(4097) }, { model: 'bad\u0000model' }]) assert.equal((await request('/ai-config', 'PUT', { ...config, ...patch })).status, 400);
  assert.equal((await request('/ai-config', 'PUT', config, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/ai-config/test', 'POST', config, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await request('/ai-config/test', 'POST', { ...config, baseUrl: 'http://127.0.0.1:1234/v1' })).status, 200);
});

test('saved settings apply immediately to mail, replies, coaching and explicitly regenerated cached materials without changing other app instances', async t => {
  const calls = [];
  const { request } = await setup(t, { fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    const prompt = body.messages[0].content;
    if (prompt.includes('prioritySkillIndices')) return completion({ prioritySkillIndices: [], focusRequirementIndices: [] });
    if (prompt.includes('replyDraft')) return completion({ replyDraft: 'AI 回复草稿' });
    if (prompt.includes('sections')) return completion({ title: '准备建议', summary: '结合真实经历练习', sections: [{ title: '项目', items: ['梳理真实职责'] }, { title: '岗位', items: ['确认要求'] }] });
    return completion({ body: 'AI 求职邮件' });
  } });
  const other = await setup(t);
  const initial = await request('/materials', 'POST', { jobId: 'j-ai-pm' });
  assert.equal(initial.body.mode, 'local');
  const draft = (await request('/applications', 'POST', { jobId: 'j-ai-pm' })).body;
  assert.equal(draft.draftMode, 'template');
  await request('/ai-config', 'PUT', config);
  assert.equal((await request('/bootstrap')).body.capabilities.ai, true);
  assert.equal((await other.request('/bootstrap')).body.capabilities.ai, false);
  assert.equal((await request(`/applications/${draft.id}/regenerate`, 'POST', {})).body.draftMode, 'ai');
  const material = (await request('/materials', 'POST', { jobId: 'j-ai-pm', regenerate: true })).body;
  assert.equal(material.mode, 'ai-assisted');
  assert.notEqual(material.id, initial.body.id);
  const cached = (await request('/materials', 'POST', { jobId: 'j-ai-pm' })).body;
  assert.equal(cached.id, material.id);
  const message = (await request('/bootstrap')).body.messages[0];
  assert.equal((await request(`/messages/${message.id}/draft`, 'POST', {})).body.mode, 'ai');
  assert.equal((await request('/coach', 'POST', { jobId: 'j-ai-pm', stage: 'interview' })).body.mode, 'ai');
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.options.headers.Authorization === `Bearer ${key}` && call.body.model === config.model));
  await request('/ai-config', 'PUT', { ...config, apiKey: 'rotated-key', model: 'next-model' });
  await request(`/applications/${draft.id}/regenerate`, 'POST', {});
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer rotated-key');
  assert.equal(calls.at(-1).body.model, 'next-model');
  await request('/ai-config', 'PUT', { clearApiKey: true });
  assert.equal((await request(`/applications/${draft.id}/regenerate`, 'POST', {})).body.draftMode, 'template');
  assert.equal(calls.length, 5);
});
