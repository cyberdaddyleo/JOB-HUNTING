import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSendAllowed, isAllowedSender, normalizeJob, mergeJobs, validateSettings } from '../server/safety.js';

const env = { ENABLE_OUTBOUND: 'true', SMTP_HOST: 'smtp.test.net', SMTP_USER: 'user', SMTP_PASS: 'secret', SMTP_FROM: 'me@test.net' };
const valid = { to: 'recruiter@company.careers', subject: 'Application', body: 'My profile', isDemo: false };

test('real sending requires configured outbound and explicit confirmation', () => {
  assert.throws(() => assertSendAllowed(valid, { env, confirmed: false }), /确认/);
  assert.throws(() => assertSendAllowed(valid, { env: { ...env, ENABLE_OUTBOUND: 'false' }, confirmed: true }), /ENABLE_OUTBOUND/);
  assert.doesNotThrow(() => assertSendAllowed(valid, { env, confirmed: true }));
});

test('demo and example domains never leave the application', () => {
  for (const record of [{ ...valid, isDemo: true }, { ...valid, to: 'hr@example.com' }, { ...valid, to: 'hr@sample.invalid' }, { ...valid, to: 'a@b.net, c@d.net' }]) {
    assert.throws(() => assertSendAllowed(record, { env, confirmed: true }));
  }
});

test('ambiguous prior send attempts are blocked to prevent duplicates', () => {
  assert.throws(() => assertSendAllowed({ ...valid, sendState: 'pending' }, { env, confirmed: true }), /发送记录/);
  assert.throws(() => assertSendAllowed({ ...valid, sendState: 'uncertain' }, { env, confirmed: true }), /发送记录/);
});

test('automation requires exact allowlisted address and reviewed queue', () => {
  const settings = { allowedSenders: ['recruiter@company.careers'], dailyLimit: 3 };
  assert.equal(isAllowedSender('Recruiter <recruiter@company.careers>', settings.allowedSenders), false);
  assert.equal(isAllowedSender('recruiter@company.careers.evil.net', settings.allowedSenders), false);
  assert.throws(() => assertSendAllowed(valid, { env, confirmed: true, automatic: true, settings, sentToday: 0 }), /审核/);
  assert.doesNotThrow(() => assertSendAllowed({ ...valid, status: 'queued', reviewedAt: new Date().toISOString() }, { env, confirmed: true, automatic: true, settings, sentToday: 0 }));
  assert.throws(() => assertSendAllowed({ ...valid, status: 'queued', reviewedAt: new Date().toISOString() }, { env, confirmed: true, automatic: true, settings, sentToday: 3 }), /上限/);
});

test('imports reject invalid and reversed salaries; absent requirements stay unknown', () => {
  assert.throws(() => normalizeJob({ title: 'PM', company: 'Co', salaryMin: 30, salaryMax: 20 }), /薪资/);
  const job = normalizeJob({ title: 'PM', company: 'Co' });
  assert.equal(job.salaryMin, null);
  assert.equal(job.experienceMin, null);
  assert.equal(job.education, '');
  assert.equal(job.isDemo, false);
});

test('imports deduplicate within batch, by identity, and by source URL', () => {
  const jobs = [normalizeJob({ title: 'PM', company: 'Co', city: '杭州', sourceUrl: 'https://jobs.company.test/1' })];
  const result = mergeJobs(jobs, [
    { title: 'PM', company: 'Co', city: '杭州' },
    { title: 'Other', company: 'Else', sourceUrl: 'https://jobs.company.test/1' },
    { title: 'Designer', company: 'Co' },
    { title: 'Designer', company: 'Co' },
  ]);
  assert.deepEqual(result, { added: 1, skipped: 3 });
  assert.equal(jobs.length, 2);
});

test('settings reject type coercion and clamp no limits silently', () => {
  assert.throws(() => validateSettings({ autoApply: 'false' }), /布尔/);
  assert.throws(() => validateSettings({ dailyLimit: 0 }), /dailyLimit/);
  assert.throws(() => validateSettings({ allowedSenders: ['*@company.careers'] }), /邮箱/);
});
