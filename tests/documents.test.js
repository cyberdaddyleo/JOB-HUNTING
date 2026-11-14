import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { generateMaterials, renderDocument } from '../server/documents.js';

const profile = { name: '测试候选人', email: 'candidate@sample.cn', role: '数据产品经理', experience: 3, education: '本科', skills: ['SQL', '用户研究', '摄影'], bio: '负责数据产品的需求分析与用户访谈。', resumeText: '2023—2026 资料中提供的公司\n负责指标口径梳理与报表需求分析。\n\n项目经历\n使用 SQL 检查数据；尚未接触 Python。', portfolioUrl: 'https://sample.cn/work' };
const job = { id: 'job-document-test', title: '数据产品经理', company: '测试招聘团队', city: '上海', education: '本科', experienceMin: 2, experienceMax: 5, skills: ['SQL', '用户研究', 'Python'], requirements: ['熟练使用 SQL 并有5年以上银行业工作经历', '具备 PMP 证书'], description: ['负责数据平台产品的用户研究'], isDemo: false };
const local = (p = profile, j = job, options = {}) => generateMaterials(p, j, { env: {}, profileRevision: 4, ...options });

// Read the ZIP central directory, then inflate the real DOCX XML entries.
function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'DOCX has a ZIP end-of-central-directory record');
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10), entries = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20), nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32), localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(start, start + size);
    entries[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('job documents use exact profile facts and distinguish compound requirements from evidence', async () => {
  const material = await local();
  assert.equal(material.jobId, job.id);
  assert.equal(material.profileRevision, 4);
  assert.equal(material.mode, 'local');
  assert.equal(material.isDemo, false);
  assert.equal(material.resume.summary, profile.bio);
  assert.equal(material.resume.sourceText, profile.resumeText);
  assert.deepEqual(material.resume.relevantSkills, ['SQL', '用户研究']);
  assert.deepEqual(material.resume.otherSkills, ['摄影']);
  assert.equal(material.evidence.find(item => item.requirement.includes('5年以上银行业')).status, 'related');
  assert.equal(material.evidence.find(item => item.requirement === '具备 PMP 证书').status, 'unknown');
  assert.equal(material.evidence.find(item => item.requirement === '技能 Python').status, 'related', 'a mention, including a negation, is never asserted as a skill');
  assert.ok(!material.coverLetter.includes('PMP'));
  assert.ok(!material.coverLetter.includes('5年'));
  assert.ok(!material.coverLetter.includes('Python'));
  assert.match(material.coverLetter, /数据产品经理/);
  assert.match(material.markdown, /岗位要求核对清单/);
});

test('unknown education and missing experience remain unknown; explicit gaps remain gaps', async () => {
  const unknown = await local({ ...profile, name: '', email: '', education: '不限', experience: undefined, resumeText: '' }, { ...job, education: '', experienceMin: null });
  assert.equal(unknown.resume.education, '');
  assert.equal(unknown.resume.experience, null);
  assert.equal(unknown.evidence[0].status, 'unknown');
  assert.equal(unknown.evidence[1].status, 'unknown');
  assert.equal(unknown.warnings.length, 4);
  const gap = await local({ ...profile, experience: 1, education: '大专' });
  assert.equal(gap.evidence[0].status, 'gap');
  assert.equal(gap.evidence[1].status, 'gap');
});

test('English skill tokens do not match substrings such as AI inside retail', async () => {
  const material = await local({ ...profile, skills: ['AI', 'C++', 'R'] }, { ...job, title: 'Retail analyst', skills: ['C++'], description: [], requirements: [] });
  assert.deepEqual(material.resume.relevantSkills, ['C++']);
  assert.deepEqual(material.resume.otherSkills, ['AI', 'R']);
});

test('DOCX downloads contain actual editable Word OOXML for all three materials', async () => {
  const material = await local();
  for (const kind of ['resume', 'cover-letter', 'checklist']) {
    const rendered = await renderDocument(material, kind, 'docx');
    assert.equal(rendered.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.ok(rendered.filename.endsWith('.docx'));
    assert.equal(rendered.buffer.readUInt32LE(0), 0x04034b50);
    const entries = zipEntries(rendered.buffer);
    assert.match(entries['[Content_Types].xml'], /wordprocessingml.document.main\+xml/);
    assert.match(entries['word/document.xml'], /数据产品经理/);
    assert.match(entries['word/document.xml'], /w:pStyle w:val="Title"/);
    assert.match(entries['word/document.xml'], /w:eastAsia="Microsoft YaHei"/);
    assert.ok(!entries['word/document.xml'].includes('<w:pBdr>'), 'titles do not acquire decorative borders');
    if (kind === 'resume') {
      assert.match(entries['word/document.xml'], /资料中提供的公司/);
      assert.match(entries['word/document.xml'], /尚未接触 Python/);
      assert.ok(!entries['word/document.xml'].includes('PMP'), 'job requirements never become resume facts');
    }
  }
});

test('untrusted HTML, Markdown and filenames are escaped in downloadable formats', async () => {
  const material = await local({ ...profile, name: '../<script>alert(1)</script>', bio: '<img src=x onerror="alert(1)">\n[click](javascript:alert(1))', resumeText: 'A & B <not markup>' }, { ...job, company: 'Team/../../A\\B' });
  const html = await renderDocument(material, 'resume', 'html');
  const md = await renderDocument(material, 'resume', 'md');
  const docx = await renderDocument(material, 'resume', 'docx');
  assert.ok(!html.buffer.toString().includes('<script>'));
  assert.ok(!html.buffer.toString().includes('<img src=x'));
  assert.match(html.buffer.toString(), /&lt;img src=x/);
  assert.match(html.buffer.toString(), /@media print/);
  assert.ok(!md.buffer.toString().includes('[click](javascript:'));
  assert.ok(!/[<>:"/\\|?*\n\r]/.test(docx.filename));
  assert.match(zipEntries(docx.buffer)['word/document.xml'], /&lt;img/);
  await assert.rejects(renderDocument(material, 'resume', 'pdf'), /PDF/);
  await assert.rejects(renderDocument(material, '__proto__', 'docx'), /类型/);
});

test('AI can only reorder known indices and cannot inject fabricated resume facts', async () => {
  const env = { AI_API_KEY: 'server-only-secret', AI_MODEL: 'test-model', AI_BASE_URL: 'https://ai.example.invalid/v1' };
  let posted;
  const fetchImpl = async (_url, request) => { posted = JSON.parse(request.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ prioritySkillIndices: [1, 0], focusRequirementIndices: [5] }) } }] })); };
  const material = await local(profile, job, { env, fetchImpl });
  assert.equal(material.mode, 'ai-assisted');
  assert.deepEqual(material.resume.relevantSkills, ['用户研究', 'SQL']);
  assert.equal(material.resume.sourceText, profile.resumeText);
  assert.ok(!JSON.stringify(material).includes(env.AI_API_KEY));
  assert.ok(!JSON.stringify(posted).includes(profile.email), 'AI ordering does not need personal contact details');
  for (const invalid of [{ prioritySkillIndices: [99], focusRequirementIndices: [] }, { prioritySkillIndices: [0], focusRequirementIndices: [], coverLetter: '我曾任职世界500强并创造十亿营收' }, { prioritySkillIndices: ['0'], focusRequirementIndices: [] }]) {
    const fallback = await local(profile, job, { env, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] })) });
    assert.equal(fallback.mode, 'local');
    assert.ok(!JSON.stringify(fallback).includes('十亿'));
    assert.equal(fallback.resume.sourceText, profile.resumeText);
  }
});

test('AI failures fall back to local materials and demo files remain visibly labeled', async () => {
  const material = await local({ ...profile, email: 'demo@example.invalid' }, job, { env: { AI_API_KEY: 'secret', AI_MODEL: 'fake' }, fetchImpl: async () => { throw new Error('network failure'); } });
  assert.equal(material.mode, 'local');
  assert.equal(material.isDemo, true);
  assert.match(material.generationNote, /未获得有效结果/);
  for (const kind of ['resume', 'cover-letter', 'checklist']) assert.match((await renderDocument(material, kind, 'html')).buffer.toString(), /虚构演示材料/);
});

test('generation bounds prohibit oversized source documents', async () => {
  await assert.rejects(local({ ...profile, resumeText: '字'.repeat(40001) }), /超过/);
});
