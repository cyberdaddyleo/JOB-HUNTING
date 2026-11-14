import test from 'node:test';
import assert from 'node:assert/strict';
import { matchJob } from '../server/matching.js';

const profile = { role: '产品经理', cities: ['杭州'], industries: ['人工智能'], salaryMin: 20, salaryMax: 30, experience: 4, education: '本科', skills: ['SQL', '产品规划', 'AI'] };
const job = { title: 'AI 产品经理', city: '杭州', industry: '人工智能', salaryMin: 22, salaryMax: 32, experienceMin: 3, experienceMax: 5, education: '本科', skills: ['SQL', '产品规划', 'AI'] };

test('excellent preferences cannot hide a hard education mismatch', () => {
  const result = matchJob(profile, { ...job, education: '硕士' });
  assert.equal(result.eligibility, '不符合');
  assert.ok(result.score >= 80);
  assert.ok(result.reasons.some(r => r.label === '学历要求' && r.status === 'gap'));
});

test('experience below published minimum is ineligible regardless of similarity', () => {
  assert.equal(matchJob(profile, { ...job, experienceMin: 5 }).eligibility, '不符合');
});

test('unknown hard requirements remain unconfirmed, never silently pass', () => {
  const result = matchJob(profile, { ...job, experienceMin: null, education: '' });
  assert.equal(result.eligibility, '待确认');
  assert.ok(result.reasons.filter(r => r.status === 'unknown').length >= 2);
});

test('explicit unlimited requirements pass, skill gaps remain explainable', () => {
  const result = matchJob(profile, { ...job, education: '不限', experienceMin: 0, skills: ['SQL', 'Python'] });
  assert.equal(result.eligibility, '有差距');
  assert.deepEqual(result.missingSkills, ['Python']);
});

test('unknown salary is neither fabricated nor treated as a match', () => {
  const result = matchJob(profile, { ...job, salaryMin: null, salaryMax: null });
  assert.ok(result.reasons.some(r => r.label === '薪资范围' && r.status === 'unknown'));
  assert.ok(result.score < matchJob(profile, job).score);
});

test('skill matching is case insensitive and score is bounded', () => {
  const result = matchJob({ ...profile, skills: ['sql', '产品规划', 'ai'] }, job);
  assert.deepEqual(result.missingSkills, []);
  assert.equal(result.eligibility, '符合');
  assert.equal(result.score, 100);
});
