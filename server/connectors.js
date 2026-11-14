import { HttpError, fail } from './safety.js';
import { fetchChinaSourceJobs } from './china-sources.js';
import { fetchPageSourceJobs } from './page-source.js';

export async function readJsonLimited(url, { fetchImpl = fetch, maxBytes = 12 * 1024 * 1024, timeout = 20000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) fail(`远程服务暂不可用（HTTP ${response.status}），请稍后重试`, 502);
    if (Number(response.headers.get('content-length')) > maxBytes) fail('远程响应过大，已停止读取', 502);
    if (!response.body) fail('远程服务返回空响应', 502);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); fail('远程响应过大，已停止读取', 502); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail('远程服务未返回有效 JSON', 502); }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(controller.signal.aborted ? '远程请求超时，请稍后重试' : '远程连接失败，请检查网络与服务配置', 502);
  } finally { clearTimeout(timer); }
}

export function plainText(html, maxLength = 8000) {
  return String(html || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160);/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength);
}
const lines = html => plainText(html).split(/\n/).map(line => line.trim()).filter(Boolean).flatMap(line => line.match(/.{1,280}/gu) || []).slice(0, 60);
export async function fetchSourceJobs(source, fetchImpl = fetch) {
  if (source.type === 'public-page') return fetchPageSourceJobs(source, fetchImpl);
  if (['ncss', 'shanghai-rsj', 'tencent'].includes(source.type)) return fetchChinaSourceJobs(source, fetchImpl);
  if (source.type === 'remotive') {
    const data = await readJsonLimited('https://remotive.com/api/remote-jobs', { fetchImpl });
    if (!Array.isArray(data.jobs)) fail('Remotive 返回格式不符合预期', 502);
    return data.jobs.slice(0, 500).map(job => ({
      title: String(job.title || '').slice(0, 180), company: String(job.company_name || '').slice(0, 180),
      city: `远程 · ${String(job.candidate_required_location || '地区待确认')}`.slice(0, 160), industry: String(job.category || '待确认').slice(0, 100),
      salaryMin: null, salaryMax: null, salaryMonths: 12, experienceMin: null, experienceMax: null, education: '',
      skills: (Array.isArray(job.tags) ? job.tags : []).filter(item => typeof item === 'string').slice(0, 30).map(item => item.slice(0, 100)),
      description: ['来源 Remotive；API 数据延迟24小时，地区与签证条件请查看原始招聘页面。', ...(job.salary ? [`原文薪资：${String(job.salary).slice(0, 250)}（未换算为人民币月薪）`] : []), ...lines(job.description)],
      requirements: ['公开源未提供可核实的结构化学历与最低年限，需在原始页面人工确认。'],
      source: 'Remotive', sourceUrl: job.url || '', contactEmail: '', isDemo: false,
    }));
  }
  if (source.type === 'greenhouse') {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(source.board || '')) fail('请填写有效 Greenhouse board token（字母、数字、下划线或连字符）');
    const data = await readJsonLimited(`https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs?content=true`, { fetchImpl });
    if (!Array.isArray(data.jobs)) fail('Greenhouse 返回格式不符合预期', 502);
    return data.jobs.slice(0, 500).map(job => ({
      title: String(job.title || '').slice(0, 180), company: source.board,
      city: String(job.location?.name || '待确认').slice(0, 160), industry: '待确认',
      salaryMin: null, salaryMax: null, salaryMonths: 12, experienceMin: null, experienceMax: null, education: '', skills: [],
      description: [`来源 Greenhouse · ${source.board}；公司名称暂按 board token 展示，请以原始岗位页为准。`, ...lines(job.content)],
      requirements: ['学历、年限、薪资与技能未从招聘正文推断，请打开原始页面核对。'],
      source: 'Greenhouse', sourceUrl: job.absolute_url || '', contactEmail: '', isDemo: false,
    }));
  }
  fail('该来源不支持远程同步');
}
