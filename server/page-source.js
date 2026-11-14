import { createHash, randomUUID } from 'node:crypto';
import { lookup as systemLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { load } from 'cheerio';
import { fail, HttpError, string } from './safety.js';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 18000;
const AGENT = 'JobPilot/1.0 (local public recruitment notice reader)';
const CATEGORIES = new Set(['人社官方招聘', '高校招聘', '企业招聘']);
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

// Fixed, reviewed URLs only. Custom source validation always creates a separate random ID.
// Like the other built-in adapters, this fixed host can use the user's normal network/proxy.
export const recommendedPageSources = Object.freeze([Object.freeze({
  id: 'cn-fudan-public', type: 'public-page', name: '复旦大学人事处 · 派遣制用工',
  homepage: 'https://hr.fudan.edu.cn/15370/list.htm', category: '高校招聘', region: '上海',
  description: '读取复旦大学人事处公开的派遣制用工招聘目录，每次最多30条。仅收录原始公告；用工方式、具体岗位和申请要求以官网为准。',
  enabled: true, canSync: true, minIntervalMinutes: 60, status: '尚未同步', count: 0,
})]);

function pageUrl(value) {
  const text = string(value, '公开招聘目录网址', 2000, true);
  let url;
  try { url = new URL(text); } catch { fail('请填写完整的 HTTPS 公开招聘目录网址'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) fail('招聘来源仅支持不含账号密码的 HTTPS 网址，且只能使用标准443端口');
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || host.endsWith('.') || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/.test(host)) fail('招聘来源必须使用公开域名，不能使用本机、内网、IP地址或保留域名');
  url.hash = '';
  return url;
}

export function isPublicAddress(address) {
  const kind = isIP(address);
  if (kind === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0,2].includes(c)) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (kind === 6) {
    // Only global unicast; exclude mapped IPv4, local/link-local, NAT64 and transition ranges.
    const parts = address.toLowerCase().split(':');
    const first = parseInt(parts[0] || '0', 16), second = parseInt(parts[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && !(first === 0x3fff && second < 0x1000);
  }
  return false;
}

async function publicAddresses(hostname, lookup = systemLookup) {
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
  catch { fail('无法解析招聘来源域名，请检查网址与网络后重试', 502); }
  if (!Array.isArray(addresses) || !addresses.length || addresses.length > 100 || addresses.some(item => !isPublicAddress(item?.address) || ![4,6].includes(item?.family) || isIP(item.address) !== item.family)) fail('招聘来源域名解析到非公网地址，已拒绝读取；请检查本机代理的 Fake-IP/DNS 设置', 400);
  return addresses.sort((a,b) => a.family - b.family);
}

async function withinTimeout(work, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new HttpError(504, '公开招聘页面读取超时，请稍后重试')); }, Math.min(TIMEOUT_MS, Math.max(1, timeoutMs))); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function validatePageSource(input, { lookup = systemLookup, timeoutMs = TIMEOUT_MS } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('请填写公开招聘来源');
  const name = string(input.name, '来源名称', 100, true);
  const homepage = pageUrl(input.homepage);
  const category = string(input.category, '来源分类', 30, true);
  const region = string(input.region, '地区', 160);
  if (!CATEGORIES.has(category)) fail('来源分类需要选择人社官方招聘、高校招聘或企业招聘');
  await withinTimeout(() => publicAddresses(homepage.hostname, lookup), timeoutMs);
  return { id: `custom-page-${randomUUID()}`, type: 'public-page', name, homepage: homepage.href, category, region,
    description: '读取此公开目录中同域名的招聘公告链接，每次最多30条；仅保存原始公告，具体岗位、条件与报名方式需在官网核对。',
    enabled: true, canSync: true, minIntervalMinutes: 60, status: '尚未同步', count: 0 };
}

// Native fetch resolves DNS again internally. Pin Node HTTPS to the previously verified
// addresses instead, so DNS rebinding cannot turn a permitted hostname into an internal request.
function pinnedFetch(url, options, addresses) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', agent: false, signal: options.signal, headers: options.headers,
      lookup(hostname, lookupOptions, callback) {
        if (hostname !== url.hostname) return callback(new Error('Unexpected hostname'));
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, response => {
      const headers = new Headers();
      for (const [key,value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers, body: Readable.toWeb(response), url: url.href, redirected: false });
    });
    req.on('error', reject);
    req.end();
  });
}

async function readPage(url, fetchImpl, { lookup, trusted, robots = false, timeoutMs }) {
  return withinTimeout(async signal => {
    let response;
    try {
      const addresses = trusted ? null : await publicAddresses(url.hostname, lookup);
      if (signal.aborted) fail('公开招聘页面读取超时', 504);
      const options = { signal, redirect: 'error', headers: { 'User-Agent': AGENT, Accept: robots ? 'text/plain' : 'text/html,application/xhtml+xml;q=0.9', 'Accept-Encoding': 'identity' } };
      response = !trusted && fetchImpl === globalThis.fetch ? await pinnedFetch(url, options, addresses) : await fetchImpl(url.href, options);
      if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).href !== url.href)) fail('公开招聘页面发生重定向，已停止读取；请改填最终的HTTPS目录网址', 502);
      if (robots && [404,410].includes(response.status)) { await response.body?.cancel(); return ''; }
      if (!response.ok) fail(`公开招聘页面返回 HTTP ${response.status}，已停止读取；请通过官网查看`, 502);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) fail('公开招聘页面超过2MB，已停止读取', 502);
      const contentType = response.headers.get('content-type') || '';
      if (!robots && contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) fail('招聘目录需要公开HTML页面，不能直接读取文件或接口', 502);
      if (!response.body) fail('公开招聘页面返回空响应', 502);
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      const abort = () => { reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (signal.aborted) fail('公开招聘页面读取超时', 504);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) { await reader.cancel(); fail('公开招聘页面超过2MB，已停止读取', 502); }
          chunks.push(Buffer.from(value));
        }
      } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
      const buffer = Buffer.concat(chunks);
      const charset = /charset\s*=\s*["']?(?:gbk|gb2312|gb18030)/i.test(contentType + ' ' + buffer.subarray(0, 2048).toString('ascii')) ? 'gb18030' : 'utf-8';
      return new TextDecoder(charset).decode(buffer);
    } catch (error) {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      if (error instanceof HttpError) throw error;
      fail(signal.aborted ? '公开招聘页面读取超时，请稍后重试' : '公开招聘页面连接失败或重定向，已停止读取；请通过官网查看', signal.aborted ? 504 : 502);
    }
  }, timeoutMs);
}

function exactDate(text) {
  const dates = new Set();
  for (const match of clean(text).matchAll(/(?<!\d)(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?!\d)/gu)) {
    const [,year,month,day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)) dates.add(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`);
  }
  return dates.size === 1 ? [...dates][0] : '';
}

function nearbyDate($, node) {
  const self = clean(node.text());
  if (/截止|截至|报名时间|有效期|deadline|closing date/i.test(self)) return '';
  const timeValues = node.find('time[datetime]').map((_, el) => $(el).attr('datetime')).get();
  if (timeValues.length) return exactDate(timeValues.join(' '));
  // A row must contain just this notice's link, never dates from several neighbouring notices.
  let row = node;
  for (let depth = 0; depth < 3; depth++) {
    const parent = row.parent();
    if (!parent.length || /^(?:body|html|ul|ol)$/i.test(parent[0].name || '') || parent.find('a[href]').length > 1 || clean(parent.text()).length > 500) break;
    row = parent;
  }
  const dates = row.find('time[datetime]').map((_, el) => $(el).attr('datetime')).get();
  const text = clean(row.text());
  // A date explicitly labelled as a deadline is not a publication date.
  if (/截止|截至|报名时间|有效期|deadline|closing date/i.test(text)) return '';
  return exactDate(dates.length ? dates.join(' ') : text || self);
}

export function parsePageSourceJobs(html, source) {
  const homepage = pageUrl(source.homepage);
  const $ = load(html);
  $('script,style,noscript,template,nav,header,footer,aside,[role="navigation"],[hidden],.nav,.navbar,.navigation,.menu,.breadcrumb').remove();
  const records = [], seen = new Set();
  $('a[href]').each((_, element) => {
    if (records.length >= 30) return false;
    const node = $(element), href = clean(node.attr('href'));
    if (!href || /^(?:#|javascript:|data:|mailto:|tel:)/i.test(href) || /(?:login|logout|register|signup|template|\/download(?:\/|\?))|(?:登录|注册|模板)/i.test(href)) return;
    let url;
    try { url = new URL(href, homepage); } catch { return; }
    if (url.protocol !== 'https:' || url.hostname !== homepage.hostname || url.username || url.password || url.port !== homepage.port || url.href.length > 2000) return;
    url.hash = '';
    if (url.href === homepage.href || seen.has(url.href) || /\/(?:index|list)\d*\.(?:htm|html|psp)$/i.test(url.pathname) || /\.(?:js|css|svg|png|jpg|jpeg|gif|webp|zip|xls|xlsx|doc|docx)$/i.test(url.pathname)) return;
    const clone = node.clone();
    clone.find('time,[class*="date"],[class*="time"],script,style').remove();
    const titleNode = clone.find('[class*="title"]').first();
    const title = clean(node.attr('title') || (titleNode.length ? titleNode.text() : clone.text()));
    if ([...title].length < 6 || title.length > 180 || !/(?:recruit|career|\bjobs?\b|招聘|人才|岗位|博士后)/iu.test(title + ' ' + url.pathname) || /(?:登录|登陆|注册|关于我们|关于本|部门介绍|网站介绍|联系我们|服务指南|操作指南|使用指南|人才政策|人才培养|人才培训|岗位设置|模板|样表|下载中心|聘用结果|拟聘|人选.*公示|候选人.*公示|招聘.*公示|招聘.*办法|招聘.*流程|招聘.*制度|招聘.*指南|招聘.*政策|招聘.*通知书|考试成绩|面试名单|笔试成绩|login|sign in|about us|template)/iu.test(title)) return;
    if (/^(?:首页|网站首页|人才招聘|招聘信息|招聘公告|招聘岗位|岗位招聘|博士后招聘|社会招聘|校园招聘|教学科研人才招聘|管理人员招聘|专职科研人员招聘|访问学者招聘|其他人员招聘|更多|查看更多|全部岗位|全部职位|招聘系统|人才招聘系统|招聘管理系统|careers?|recruitment|job vacancies|current vacancies|view all jobs|job opportunities)[>»\s]*$/iu.test(title)) return;
    seen.add(url.href);
    records.push({ title, company: source.name, city: clean(source.region).slice(0,160) || '待确认', industry: '待确认', education: '', skills: [], salaryMin: null, salaryMax: null, salaryMonths: 12, experienceMin: null, experienceMax: null,
      source: source.name, sourceId: source.id, externalId: hash(url.href), sourceUrl: url.href, publishedAt: nearbyDate($, node), deadline: '',
      recordType: 'announcement', requiresReview: true, isDemo: false, contactEmail: '',
      applicationMethod: '请打开原始公告核对具体岗位、有效期和报名要求，再按官网方式手动申请。',
      description: [`原始招聘公告：${title}`, '仅提取公开目录的公告标题与原文链接；尚未读取详情，可能包含多个岗位，也可能已截止。'],
      requirements: ['具体学历、专业、经验、资格条件及用工方式尚未核对，不用于推断你是否符合岗位要求。'],
    });
  });
  return records;
}

export async function fetchPageSourceJobs(source, fetchImpl = fetch, { lookup = systemLookup, timeoutMs = TIMEOUT_MS } = {}) {
  if (source?.type !== 'public-page' || !CATEGORIES.has(source.category)) fail('公开招聘页面来源配置无效');
  const homepage = pageUrl(source.homepage);
  string(source.id, '来源ID', 100, true);
  string(source.name, '来源名称', 100, true);
  const trusted = recommendedPageSources.some(item => item.id === source.id && item.type === source.type && item.homepage === source.homepage);
  const options = { lookup, trusted, timeoutMs };
  const policy = await readPage(new URL('/robots.txt', homepage), fetchImpl, { ...options, robots: true });
  // Dynamic import avoids a catalog -> page-source -> china-sources -> catalog import cycle.
  const { robotsAllows } = await import('./china-sources.js');
  if (!robotsAllows(policy, homepage.pathname + homepage.search)) fail('该公开招聘目录的robots.txt不允许自动读取，请通过官网查看', 403);
  const html = await readPage(homepage, fetchImpl, options);
  const jobs = parsePageSourceJobs(html, source);
  if (!jobs.length) fail('未找到可核对的同域招聘公告。页面可能需要登录、动态加载或已变更，请使用官网入口或手动导入', 502);
  return jobs;
}
