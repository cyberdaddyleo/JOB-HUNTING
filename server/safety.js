import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (message, status = 400) => { throw new HttpError(status, message); };
export const EDUCATION = ['不限', '高中', '大专', '本科', '硕士', '博士'];
export function string(value, name, max = 500, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${name}需要${required ? '非空' : ''}文本，最多${max}字符`);
  return value.trim();
}
export function stringList(value, name, maxItems = 50) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(`${name}需要数组，最多${maxItems}项`);
  return [...new Set(value.map(item => string(item, name, 300, true)))];
}
export function number(value, name, min, max, nullable = false) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name}必须为${min}–${max}之间的数值`);
  return value;
}
export function boolean(value, name) {
  if (typeof value !== 'boolean') fail(`${name}必须为布尔值`);
  return value;
}
export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && !value.includes('*') && /^[A-Z0-9.!#$%&'+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(value);
}
export function reservedEmail(value) {
  const domain = String(value).split('@')[1]?.toLowerCase() || '';
  return /(?:^|\.)(?:example\.(?:com|org|net)|invalid|localhost|test)$/.test(domain) || domain === 'example';
}
export const containsDemoText = value => /虚构演示|[（(](?:虚构|演示|示例)[）)]|example\.(?:invalid|com|org|net)/i.test(String(value || ''));
export const demoProfile = profile => reservedEmail(profile.email) || containsDemoText(profile.name) || containsDemoText(profile.resumeText);
export const expiredJob = job => /^\d{4}-\d{2}-\d{2}$/.test(job?.deadline || '') && Date.parse(`${job.deadline}T23:59:59+08:00`) < Date.now();
export function invalidateProfileReview(state, detail) {
  state.profileRevision = (state.profileRevision || 0) + 1;
  for (const application of state.applications) {
    if (application.status !== 'queued' || application.sentAt) continue;
    application.status = 'draft';
    delete application.reviewedAt;
    delete application.reviewedProfileRevision;
    application.updatedAt = new Date().toISOString();
    application.events.push({ at: application.updatedAt, text: `${detail}，已撤销队列审核，请重新核对正文和附件` });
  }
}
export function safeUrl(value) {
  if (!value) return '';
  const text = string(value, '链接', 2000);
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('链接需要无凭据的 HTTP(S) 地址');
    return url.href;
  } catch (error) { if (error instanceof HttpError) throw error; fail('链接格式无效'); }
}
export function capabilities(env = process.env) {
  return {
    ai: Boolean(env.AI_API_KEY && env.AI_MODEL),
    smtp: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM),
    imap: Boolean(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASS),
    outboundEnabled: env.ENABLE_OUTBOUND === 'true',
    aiModel: env.AI_MODEL || '',
  };
}
export const isAllowedSender = (address, allowlist = []) => validEmail(address) && allowlist.some(item => item.toLowerCase() === address.toLowerCase());
export function assertSendAllowed(record, { env = process.env, confirmed, automatic = false, reply = false, settings = {}, sentToday = 0 }) {
  if (confirmed !== true) fail('发送前需要明确确认收件人和正文');
  if (record.isDemo) fail('演示记录不能发送真实邮件', 403);
  if (!validEmail(record.to) || reservedEmail(record.to)) fail('收件邮箱无效，或属于示例/保留域名', 400);
  if (!record.subject?.trim() || /[\r\n]/.test(record.subject) || !record.body?.trim()) fail('邮件主题与正文不能为空，主题不能包含换行');
  if (record.sendState === 'pending' || record.sendState === 'uncertain') fail('已有未确认的发送记录；请先在邮箱中核对，系统不会重复发送', 409);
  const caps = capabilities(env);
  if (!caps.outboundEnabled) fail('真实发送未开启，请在本地 .env 设置 ENABLE_OUTBOUND=true', 403);
  if (!caps.smtp || !validEmail(env.SMTP_FROM)) fail('SMTP 尚未正确配置，请检查本地 .env', 503);
  if (automatic) {
    if (!reply && (record.status !== 'queued' || !record.reviewedAt)) fail('自动投递仅处理已人工审核并加入队列的申请', 403);
    if (!isAllowedSender(record.to, settings.allowedSenders)) fail('收件人不在自动发送精确邮箱白名单内', 403);
    if (sentToday >= settings.dailyLimit) fail('已达到今日自动发送上限', 429);
  }
}
export function normalizeJob(input, defaults = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('每条岗位必须为对象');
  const title = string(input.title, '岗位名称', 180, true);
  const company = string(input.company, '公司名称', 180, true);
  const salaryMin = number(input.salaryMin, '最低薪资', 0, 1000, true);
  const salaryMax = number(input.salaryMax, '最高薪资', 0, 1000, true);
  if ((salaryMin === null) !== (salaryMax === null) || (salaryMin !== null && salaryMax < salaryMin)) fail('薪资需同时提供有效上下限，且最高薪资不能低于最低薪资');
  const experienceMin = number(input.experienceMin, '最低经验', 0, 70, true);
  const experienceMax = number(input.experienceMax, '最高经验', 0, 70, true);
  if (experienceMin !== null && experienceMax !== null && experienceMax < experienceMin) fail('经验上限不能低于下限');
  const education = input.education == null ? '' : string(input.education, '学历', 20);
  if (education && !EDUCATION.includes(education)) fail('不支持的学历值；未说明时留空');
  const contactEmail = string(input.contactEmail, '招聘邮箱', 254);
  if (contactEmail && !validEmail(contactEmail)) fail('招聘邮箱格式无效');
  return {
    id: randomUUID(), title, company, initial: company.slice(0, 1), color: /^#[\da-f]{6}$/i.test(input.color || '') ? input.color : '#eaf2dd',
    city: string(input.city, '城市', 160) || '待确认', industry: string(input.industry, '行业', 100) || '待确认',
    salaryMin, salaryMax, salaryMonths: input.salaryMonths == null ? 12 : number(input.salaryMonths, '薪资月数', 1, 24),
    experienceMin, experienceMax, education,
    skills: stringList(input.skills, '技能'), description: stringList(input.description, '岗位描述', 100), requirements: stringList(input.requirements, '岗位要求', 100),
    source: defaults.source || string(input.source, '来源', 100) || '手动导入', sourceUrl: safeUrl(input.sourceUrl), contactEmail,
    sourceId: string(defaults.sourceId || input.sourceId, '来源 ID', 100), externalId: string(input.externalId, '来源记录 ID', 300),
    recordType: input.recordType === 'announcement' ? 'announcement' : 'job', requiresReview: input.requiresReview === true,
    sourceUpdatedAt: string(input.sourceUpdatedAt, '原站更新时间', 80), publishedAt: string(input.publishedAt, '发布时间', 80), deadline: string(input.deadline, '截止日期', 100),
    applicationMethod: string(input.applicationMethod, '报名方式', 500),
    isDemo: defaults.isDemo ?? (input.isDemo === true), saved: false, createdAt: new Date().toISOString(),
  };
}
const identity = job => [job.company, job.title, job.city].map(part => String(part || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')).join('|');
export function mergeJobs(existing, incoming, defaults) {
  if (!Array.isArray(incoming) || incoming.length > 500) fail('一次最多导入500条岗位');
  const normalized = incoming.map(job => normalizeJob(job, defaults));
  const identities = new Set(existing.map(identity));
  const urls = new Set(existing.map(job => job.sourceUrl).filter(Boolean));
  const externalKeys = new Set(existing.filter(j => j.sourceId && j.externalId).map(j => `${j.sourceId}|${j.externalId}`));
  let added = 0;
  let skipped = 0;
  for (const job of normalized) {
    const externalKey = job.sourceId && job.externalId ? `${job.sourceId}|${job.externalId}` : '';
    if (externalKey ? externalKeys.has(externalKey) : identities.has(identity(job)) || (job.sourceUrl && urls.has(job.sourceUrl))) { skipped++; continue; }
    if (existing.length >= 5000) fail('本地岗位已达到5000条上限，请先备份并整理数据');
    identities.add(identity(job));
    if (externalKey) externalKeys.add(externalKey);
    if (job.sourceUrl) urls.add(job.sourceUrl);
    existing.push(job); added++;
  }
  return { added, skipped };
}
export function validateProfile(input) {
  const result = {};
  for (const key of ['name', 'email', 'role']) result[key] = string(input[key], key, 254);
  if (result.email && !validEmail(result.email)) fail('个人邮箱格式无效');
  for (const key of ['cities', 'industries', 'skills']) result[key] = stringList(input[key], key);
  result.salaryMin = number(input.salaryMin, '期望最低月薪', 0, 1000);
  result.salaryMax = number(input.salaryMax, '期望最高月薪', result.salaryMin, 1000);
  result.experience = number(input.experience, '工作经验', 0, 70);
  if (!EDUCATION.includes(input.education)) fail('请选择有效学历');
  result.education = input.education;
  result.bio = string(input.bio, '个人简介', 5000);
  result.resumeText = string(input.resumeText, '简历正文', 40000);
  result.portfolioUrl = safeUrl(input.portfolioUrl);
  return result;
}
export function validateSettings(input) {
  const result = {};
  for (const key of ['autoSync', 'autoApply', 'autoReply']) if (key in input) result[key] = boolean(input[key], key);
  for (const [key, min, max] of [['syncIntervalMinutes', 5, 1440], ['minMatchScore', 0, 100], ['dailyLimit', 1, 100]]) {
    if (key in input) { result[key] = number(input[key], key, min, max); if (!Number.isInteger(result[key])) fail(`${key}需要整数`); }
  }
  if ('allowedSenders' in input) {
    result.allowedSenders = stringList(input.allowedSenders, '自动发送白名单', 100).map(item => item.toLowerCase());
    if (result.allowedSenders.some(item => !validEmail(item) || reservedEmail(item))) fail('自动发送白名单需要真实的完整邮箱地址，不支持通配符或域名');
  }
  return result;
}
