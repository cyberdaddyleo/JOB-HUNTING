import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSourceJobs, readJsonLimited } from '../server/connectors.js';
import { buildApplicationDraft, draftReply, coachResponse } from '../server/ai.js';
import { seedState } from '../server/seed.js';

test('public source salary and hard eligibility remain unknown when API does not structure them', async () => {
  const source = { type: 'remotive' };
  const jobs = await fetchSourceJobs(source, async url => {
    assert.equal(url, 'https://remotive.com/api/remote-jobs');
    return new Response(JSON.stringify({ jobs: [{ id: 1, title: 'Product Manager', company_name: 'Acme', candidate_required_location: 'Worldwide', category: 'Product', salary: '$100k/year', tags: ['SQL'], description: '<p>Build tools</p><script>steal()</script>', url: 'https://remotive.com/remote-jobs/product/1' }] }), { status: 200 });
  });
  assert.equal(jobs[0].salaryMin, null);
  assert.equal(jobs[0].experienceMin, null);
  assert.equal(jobs[0].education, '');
  assert.ok(jobs[0].description.join(' ').includes('$100k/year'));
  assert.ok(!jobs[0].description.join(' ').includes('steal()'));
  assert.equal(jobs[0].source, 'Remotive');
});

test('Greenhouse board is constrained and public normalization preserves attribution', async () => {
  await assert.rejects(fetchSourceJobs({ type: 'greenhouse', board: '../escape?token=secret' }), /board/);
  const jobs = await fetchSourceJobs({ type: 'greenhouse', board: 'acme' }, async url => {
    assert.equal(url, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true');
    return new Response(JSON.stringify({ jobs: [{ id: 11, title: 'Designer', location: { name: 'Shanghai' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/11', content: '<p>Design interfaces</p>', departments: [{ name: 'Design' }] }] }));
  });
  assert.equal(jobs[0].source, 'Greenhouse');
  assert.equal(jobs[0].company, 'acme');
  assert.equal(jobs[0].contactEmail, '');
});

test('remote JSON reader enforces response byte limit and safe status errors', async () => {
  await assert.rejects(readJsonLimited('https://service.test', { fetchImpl: async () => new Response('123456789'), maxBytes: 5 }), /过大/);
  await assert.rejects(readJsonLimited('https://service.test?token=secret', { fetchImpl: async () => new Response('private server detail', { status: 500 }) }), error => !error.message.includes('secret') && !error.message.includes('private'));
});

test('without AI credentials draft and coaching remain useful and explicitly templated', async () => {
  const state = seedState();
  const draft = await buildApplicationDraft(state.profile, state.jobs[0], {});
  assert.equal(draft.mode, 'template');
  assert.ok(draft.body.includes('4年'));
  assert.ok(!draft.body.includes('提升30%'));
  const reply = await draftReply(state.messages[0], state.profile, {});
  assert.equal(reply.mode, 'template');
  assert.ok(!reply.replyDraft.includes('周一下午'));
  const coach = await coachResponse(state.profile, state.jobs[0], 'interview', '', {});
  assert.equal(coach.mode, 'template');
  assert.ok(coach.sections.length >= 3);
});

test('invalid AI output falls back without exposing provider errors or credentials', async () => {
  const state = seedState();
  const result = await draftReply(state.messages[0], state.profile, { AI_API_KEY: 'do-not-leak', AI_MODEL: 'model', AI_BASE_URL: 'https://ai.provider.test/v1' }, async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] })));
  assert.equal(result.mode, 'template');
  assert.ok(!JSON.stringify(result).includes('do-not-leak'));
});
