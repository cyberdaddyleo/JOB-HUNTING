import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { fail, HttpError, validEmail } from './safety.js';
import { sourceCatalog } from './source-catalog.js';

const USER_AGENT = 'JobPilot/1.0 (local public job reader)';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 18000;
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const clip = (value, length = 180) => clean(value).slice(0, length);
const chunks = value => String(value || '').split(/\n+/).map(clean).filter(Boolean).flatMap(line => line.match(/.{1,280}/gu) || []).slice(0, 80);
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

// RFC 9309 matching subset: grouped agents, longest matching allow/disallow, wildcard and end anchor.
export function robotsAllows(text, pathname, agent = 'jobpilot') {
  if (/^\s*</.test(text)) return true; // Some official servers return a branded HTML 404 with HTTP 200.
  const groups = [];
  let group = null;
  let hadRule = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!group || hadRule) { group = { agents: [], rules: [] }; groups.push(group); hadRule = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key)) {
      hadRule = true;
      if (value) group.rules.push({ allow: key === 'allow', value });
    }
  }
  const specific = groups.filter(group => group.agents.some(value => value !== '*' && agent.includes(value)));
  const selected = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  let winner = null;
  for (const rule of selected.flatMap(group => group.rules)) {
    const end = rule.value.endsWith('$');
    const pattern = (end ? rule.value.slice(0, -1) : rule.value).split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (!new RegExp(`^${pattern}${end ? '$' : ''}`).test(pathname)) continue;
    const length = rule.value.replace(/[*$]/g, '').length;
    if (!winner || length > winner.length || (length === winner.length && rule.allow)) winner = { ...rule, length };
  }
  return !winner || winner.allow;
}

async function readPublicText(url, fetchImpl, { robots = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const options = { signal: controller.signal, redirect: robots ? 'manual' : 'error', headers: { 'User-Agent': USER_AGENT, Accept: robots ? 'text/plain' : 'application/json,text/html;q=0.9' } };
    let response = await fetchImpl(url, options);
    if (robots && [301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) fail('robots 重定向缺少地址，已停止同步', 502);
      const target = new URL(location, url);
      if (target.origin !== new URL(url).origin || target.username || target.password) fail('robots 重定向超出官方域名，已停止同步', 502);
      await response.body?.cancel();
      response = await fetchImpl(target.href, { ...options, redirect: 'error' });
    }
    if (robots && [404, 410].includes(response.status)) return '';
    if (!response.ok) fail(`官方来源返回 HTTP ${response.status}；已停止该请求，请通过官网查看`, 502);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) fail('官方来源响应超过2MB，已停止读取', 502);
    if (!response.body) fail('官方来源返回空响应', 502);
    const reader = response.body.getReader();
    const buffers = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); fail('官方来源响应超过2MB，已停止读取', 502); }
      buffers.push(Buffer.from(value));
    }
    const contentType = response.headers.get('content-type') || '';
    return new TextDecoder(/charset=(?:gbk|gb2312|gb18030)/i.test(contentType) ? 'gb18030' : 'utf-8').decode(Buffer.concat(buffers));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(controller.signal.aborted ? '官方来源请求超时，请稍后重试' : '官方来源连接失败或重定向；请通过官网查看', 502);
  } finally { clearTimeout(timer); }
}

function publicReader(origin, fetchImpl) {
  let robotsPromise;
  return async url => {
    const target = new URL(url);
    if (target.origin !== origin || target.username || target.password) fail('拒绝读取官方来源域名以外的地址', 400);
    robotsPromise ??= readPublicText(`${origin}/robots.txt`, fetchImpl, { robots: true });
    const policy = await robotsPromise;
    if (!robotsAllows(policy, target.pathname + target.search)) fail('该官方页面的 robots.txt 不允许自动读取，请通过官网查看', 403);
    return readPublicText(target.href, fetchImpl);
  };
}

async function mapLimited(items, mapper, concurrency = 2) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await mapper(items[index], index); }
  }));
  return result;
}

function bodyLines($, root) {
  const clone = root.clone();
  clone.find('script,style,noscript').remove();
  clone.find('br').replaceWith('\n');
  clone.find('p,li,div,pre,tr,h1,h2,h3,h4').append('\n');
  return clone.text().split(/\n+/).map(clean).filter(Boolean);
}

function educationFrom(value) {
  const text = clean(value);
  const labels = ['博士', '硕士', '本科', '大专', '专科', '高中', '不限'].filter(label => text.includes(label));
  if (labels.length !== 1) return '';
  return labels[0] === '专科' ? '大专' : labels[0];
}

function dateValue(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function extractDeadline(lines, publishedAt = '') {
  for (const original of lines) {
    // A sentence can continue with examination or residency dates. They are not application deadlines.
    const line = original.split(/[，,；;。]\s*(?:(?:笔试|面试|资格审查|资格复审|体检|考试|考核|公示|录用|报到|居住证|学历取得|毕业证))/u)[0];
    if (!/(?:报名时间|报名截止|截止报名|报名.*(?:截至|截止)|(?:截至|截止).*报名|报名[：:].*日前)/u.test(line)) continue;
    if (!/(?:至|截止|截至|—|～|~|日前)/u.test(line)) continue;
    const matches = [...line.matchAll(/(?:(20\d{2})\s*[年/-]\s*)?(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?/gu)];
    const match = matches.at(-1);
    if (match) return dateValue(match[1] || publishedAt.slice(0, 4), match[2], match[3]);
  }
  return '';
}

function contactAndApplication(lines) {
  const relevant = lines.filter(line => /报名|应聘|投递|简历|邮箱|电子邮件/.test(line));
  const rejectsMail = relevant.some(line => /(?:不接受|不接收|不受理|谢绝)[^。；\n]{0,30}(?:邮件|邮箱|电子简历)|(?:邮件|邮箱)[^。；\n]{0,20}(?:不接受|不接收|不受理)/u.test(line));
  const mailLines = rejectsMail ? [] : relevant.filter(line => /邮箱|电子邮件|邮件报名|发(?:送)?至/.test(line) && !/咨询|监督|举报|仅供|不接受|不接收|不受理/.test(line));
  const emails = [...new Set(mailLines.join('\n').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi) || [])].filter(validEmail);
  const methods = relevant.filter(line => /(?:报名方式|邮件方式报名|邮件报名|邮箱报名|网上报名|现场.*报名|报名.*(?:网站|网址)|发送至|发至|登录.*(?:申请|报名))/.test(line));
  return { contactEmail: emails.length === 1 ? emails[0] : '', applicationMethod: clip(methods.join(' '), 500) || '请阅读原始招聘页面的报名要求', multipleEmails: emails.length > 1 };
}

const baseJob = source => ({ source: source.name, sourceId: source.id, isDemo: false, salaryMin: null, salaryMax: null, salaryMonths: 12, experienceMin: null, experienceMax: null, education: '', skills: [], industry: '待确认', contactEmail: '', publishedAt: '', deadline: '', requiresReview: true });

export function parseNcssList(data, source = sourceCatalog[0]) {
  if (data?.flag !== true || !Array.isArray(data?.data?.list)) fail('国家大学生就业服务平台返回了登录提示或不兼容的数据格式', 502);
  return data.data.list.slice(0, 20).map(item => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(item.jobId || '') || !clean(item.jobName) || !clean(item.recName)) return null;
    const salaryMin = typeof item.lowMonthPay === 'number' && item.lowMonthPay > 0 && item.lowMonthPay <= 1000 ? item.lowMonthPay : null;
    const salaryMax = typeof item.highMonthPay === 'number' && item.highMonthPay >= salaryMin && item.highMonthPay <= 1000 ? item.highMonthPay : null;
    const published = Number(item.publishDate);
    return {
      ...baseJob(source), title: clip(item.jobName), company: clip(item.recName), city: clip(item.areaCodeName || '待确认', 160),
      externalId: item.jobId, sourceUrl: `https://www.ncss.cn/student/jobs/${item.jobId}/detail.html`,
      recordType: String(item.recruitType) === '1' ? 'announcement' : 'job',
      salaryMin: salaryMin !== null && salaryMax !== null ? salaryMin : null, salaryMax: salaryMin !== null && salaryMax !== null ? salaryMax : null,
      education: educationFrom(item.degreeName), publishedAt: Number.isFinite(published) && published > 0 && published < 4133980800000 ? new Date(published).toISOString() : '',
      applicationMethod: '在国家大学生就业服务平台打开岗位、登录后按官网要求申请。',
      description: chunks([`来源：${source.name}公开职位信息。`, item.recProperty && `单位性质：${item.recProperty}`, item.recScale && `规模：${item.recScale}`, item.headCount ? `计划招聘：${item.headCount}人` : '招聘人数以原文为准', item.recTags && `原文福利：${item.recTags}`].filter(Boolean).join('\n')),
      requirements: chunks([item.degreeName && `学历：${item.degreeName}`, item.major && `专业：${item.major}`].filter(Boolean).join('\n')),
    };
  }).filter(Boolean);
}

export function enrichNcssJob(job, html) {
  const $ = load(html);
  const root = $('.jobdetail-box .mainContent').first();
  if (!root.length || !clean(root.text())) fail('国家大学生就业服务平台详情缺少岗位正文；可能需要登录或页面已变化', 502);
  const lines = bodyLines($, root);
  const qualification = lines.findIndex(line => /^(?:任职|应聘|资格|岗位任职|任职资格).*(?:要求|条件|资格)/u.test(line));
  const { contactEmail, applicationMethod } = contactAndApplication(lines);
  return { ...job,
    city: clip($('.site-tag').map((_, el) => clean($(el).text())).get().filter(Boolean).join(' / ') || job.city, 160),
    industry: clip($('#mainindustries').text() || '待确认', 100),
    description: [...job.description, ...chunks((qualification > 0 ? lines.slice(0, qualification) : lines).join('\n'))].slice(0, 95),
    requirements: [...job.requirements, ...chunks((qualification >= 0 ? lines.slice(qualification) : []).join('\n'))].slice(0, 95),
    contactEmail, deadline: extractDeadline(lines, job.publishedAt),
    applicationMethod: contactEmail ? applicationMethod : job.applicationMethod,
    requiresReview: true,
  };
}

const tencentText = value => String(value || '').replace(/\\r\\n|\\n/g, '\n');
export function parseTencentPosts(data, source = sourceCatalog.find(item => item.type === 'tencent')) {
  if (data?.Code !== 200 || !Array.isArray(data?.Data?.Posts)) fail('腾讯招聘未返回公开岗位列表，请通过官网查看', 502);
  return data.Data.Posts.slice(0, 10).filter(item => item.IsValid !== false && typeof item.PostId === 'string' && /^\d{1,30}$/.test(item.PostId) && clean(item.RecruitPostName)).map(item => {
    const date = String(item.LastUpdateTime || '').match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/u);
    const sourceUpdatedAt = date ? dateValue(date[1], date[2], date[3]) : '';
    const chineseDigits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const minimum = String(item.RequireWorkYearsName || '').match(/^([一二三四五六七八九十]|\d{1,2})年以上工作经验$/u);
    return { ...baseJob(source), title: clip(item.RecruitPostName), company: clip(item.ComName || '腾讯'), city: clip(item.LocationName || '待确认', 160),
      externalId: item.PostId, recordType: 'job', sourceUpdatedAt,
      sourceUrl: `https://careers.tencent.com/jobdesc.html?postId=${item.PostId}`,
      experienceMin: minimum ? chineseDigits[minimum[1]] || Number(minimum[1]) : null,
      applicationMethod: '打开腾讯招聘官网岗位详情，登录后按官网流程申请。',
      description: chunks([sourceUpdatedAt && `官网更新时间：${sourceUpdatedAt}（并非首次发布日期）`, item.BGName && `事业群：${item.BGName}`, item.ProductName && `产品：${item.ProductName}`, item.CategoryName && `职位类别：${item.CategoryName}`, tencentText(item.Responsibility)].filter(Boolean).join('\n')),
      requirements: chunks(item.RequireWorkYearsName || ''),
    };
  });
}

export function enrichTencentJob(job, data) {
  const detail = data?.Data;
  if (data?.Code !== 200 || String(detail?.PostId) !== job.externalId || !clean(detail?.Requirement)) fail('腾讯招聘岗位详情缺失或身份不匹配，请通过官网查看', 502);
  return { ...job,
    description: [...job.description, ...chunks(tencentText(detail.Introduction)), ...chunks(tencentText(detail.DepartmentIntroduction))].slice(0, 95),
    requirements: [...job.requirements, ...chunks(tencentText(detail.Requirement))].slice(0, 95),
    contactEmail: '', // Official Tencent application flow is online; do not infer a recipient from ancillary text.
  };
}

export function parseShanghaiIndex(html) {
  const $ = load(html);
  const seen = new Set();
  const links = [];
  $('a[href]').each((_, element) => {
    const node = $(element);
    const href = node.attr('href');
    if (!/^\/tzpgg_17408\/20\d{6}\/[\w]+\.html$/.test(href || '')) return;
    const url = `https://rsj.sh.gov.cn${href}`;
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ url, title: clip(node.attr('title') || node.text()), publishedAt: clean(node.closest('li').find('.time').text()).match(/20\d{2}-\d{2}-\d{2}/)?.[0] || '' });
  });
  if (!links.length) fail('上海人社招聘目录未找到公告；网页结构可能已变化', 502);
  return links.slice(0, 12);
}

// Expand rowspan/colspan before interpreting official job tables, preserving each distinct row.
export function tableGrid($, table) {
  const grid = [];
  $(table).find('tr').slice(0, 150).each((rowIndex, tr) => {
    grid[rowIndex] ||= [];
    let column = 0;
    $(tr).children('td,th').slice(0, 30).each((_, cell) => {
      while (grid[rowIndex][column] !== undefined) column++;
      const text = bodyLines($, $(cell)).join('\n');
      const rows = Math.max(1, Math.min(50, Number($(cell).attr('rowspan')) || 1));
      const cols = Math.max(1, Math.min(30, Number($(cell).attr('colspan')) || 1));
      for (let r = rowIndex; r < Math.min(150, rowIndex + rows); r++) {
        grid[r] ||= [];
        for (let c = column; c < Math.min(30, column + cols); c++) grid[r][c] = text;
      }
      column += cols;
    });
  });
  return grid;
}

function tablePositions($, root) {
  const positions = [];
  root.find('table').each((tableIndex, table) => {
    const grid = tableGrid($, table);
    const headerIndex = grid.findIndex(row => row.some(cell => /^(?:招聘)?(?:岗位|职位)(?:名称)?$/.test(clean(cell))));
    if (headerIndex < 0) return;
    const headers = grid[headerIndex].map(clean);
    const titleColumn = headers.findIndex(header => /^(?:招聘)?(?:岗位|职位)(?:名称)?$/.test(header));
    const departmentColumn = headers.findIndex(header => /^(?:招聘)?(?:部门|科室|处室)$/.test(header));
    const companyColumn = headers.findIndex(header => /^(?:招聘|用人)?单位(?:名称)?$/.test(header));
    const educationColumn = headers.findIndex(header => /学历/.test(header));
    for (let r = headerIndex + 1; r < grid.length; r++) {
      const row = grid[r];
      const name = clean(row[titleColumn]);
      if (!name || name.length > 100 || /^(?:合计|总计|备注|岗位|职位)/.test(name)) continue;
      const department = departmentColumn >= 0 ? clean(row[departmentColumn]).replace(/\s+/g, '') : '';
      positions.push({ title: clip(`${department ? department + ' · ' : ''}${name}`), company: companyColumn >= 0 ? clip(row[companyColumn]) : '',
        requirements: chunks(row.map((value, i) => `${headers[i] || '条件'}：${value}`).join('\n')),
        education: educationColumn >= 0 ? educationFrom(row[educationColumn]) : '', key: `table-${tableIndex}-row-${r}` });
    }
  });
  return positions;
}

function paragraphPositions(lines) {
  const positions = [];
  let inJobSection = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^[一二三四五六七八九十]+[、.]/u.test(lines[i])) inJobSection = /招聘岗位/.test(lines[i]);
    const line = lines[i].replace(/^(?:[（(][一二三四五六七八九十\d]+[）)]|[一二三四五六七八九十\d]+[、.．])\s*/u, '');
    const match = line.match(/^([^，,：:；;。]{2,45}岗位)[，,：:]\s*(?:职数|招聘人数|人数)\s*\d+\s*[名人]/u)
      || line.match(/^招聘岗位及职数[：:]\s*([^，,：:；;。]{2,45}?)\s*\d+\s*[名人]/u);
    if (!match) {
      if (inJobSection && !/详见|如下|招聘岗位及|一、|二、/.test(line)) {
        for (const part of line.split(/[；;。]/u)) {
          const simple = part.replace(/^本次招聘岗位\d+个[：:]\s*/u, '').match(/^([^：:，,。;；\d]{2,60}?)[：:]?\s*(\d+)\s*名/u);
          if (simple) positions.push({ title: clip(simple[1]), key: `paragraph-${hash(simple[1])}`, requirements: chunks([part, '岗位详细条件须查看原公告及附件。'].join('\n')), education: '' });
        }
      }
      continue;
    }
    const title = match[1];
    const ownConditions = lines.filter(candidate => candidate.includes(`${title}：`) || candidate.includes(`${title}:`));
    const conditionsIndex = lines.findIndex(candidate => candidate.includes(`${title}任职条件`));
    if (conditionsIndex >= 0) {
      for (let c = conditionsIndex + 1; c < Math.min(lines.length, conditionsIndex + 20); c++) {
        if (/^(?:[一二三四五六七八九十]+[、.]|[（(][一二三四五六七八九十]+[）)])/u.test(lines[c])) break;
        ownConditions.push(lines[c]);
      }
    }
    const next = lines[i + 1];
    if (next && !/(?:岗位.*职数|^[一二三四五六七八九十]+[、.]|招聘办法|报名)/u.test(next)) ownConditions.push(next);
    positions.push({ title: clip(title), key: `paragraph-${hash(title)}`, requirements: chunks([lines[i], ...ownConditions].join('\n')), education: '' });
  }
  return [...new Map(positions.map(position => [position.title, position])).values()];
}

export function parseShanghaiAnnouncement(html, item, source = sourceCatalog[1]) {
  const $ = load(html);
  const root = $('#ivs_content .TRS_Editor').first().length ? $('#ivs_content .TRS_Editor').first() : $('#ivs_content').first();
  if (!root.length || !clean(root.text())) fail('上海人社公告缺少正文；网页结构可能已变化', 502);
  const title = clip($('meta[name="ArticleTitle"]').attr('content') || $('#ivs_title').text() || item.title);
  const publishedAt = ($('meta[name="PubDate"]').attr('content') || item.publishedAt).match(/20\d{2}-\d{2}-\d{2}/)?.[0] || '';
  const lines = bodyLines($, root);
  const rightAligned = root.find('[align="right"]').map((_, el) => clean($(el).text())).get().filter(value => value && !/\d{4}年|^20\d{2}-/.test(value));
  const company = clip(rightAligned.at(-1) || title.replace(/^(?:20\d{2}年度?|年度)/, '').replace(/(?:20\d{2}年|面向|工作人员|公开招聘|招聘公告|招聘简章).*$/, '') || '单位详见原公告');
  const { contactEmail, applicationMethod, multipleEmails } = contactAndApplication(lines);
  const shared = { ...baseJob(source), company, city: '上海', sourceUrl: item.url, publishedAt, deadline: extractDeadline(lines, publishedAt), contactEmail, applicationMethod,
    description: chunks(lines.join('\n')).slice(0, 70),
    requirements: ['官方公告的报名条件、资格审查及材料要求以原文为准。', ...(multipleEmails ? ['原文包含多个邮箱，请按具体岗位核对收件地址。'] : [])],
  };
  const tables = tablePositions($, root);
  const positions = tables.length ? tables : paragraphPositions(lines);
  if (!positions.length) return [{ ...shared, title, externalId: `${hash(item.url)}-notice`, recordType: 'announcement',
    requirements: [...shared.requirements, '此条为招聘公告，可能包含多个岗位。附件/图片岗位表尚未解析，请打开原文核对后手动建立具体岗位。'] }];
  return positions.slice(0, 100).map(position => ({ ...shared, title: position.title, company: position.company || company,
    externalId: `${hash(item.url)}-${position.key}`, recordType: 'job', education: position.education,
    requirements: [...position.requirements, ...shared.requirements].slice(0, 95),
    description: [`原公告：${title}`, '该岗位由官网正文的岗位表或明确岗位段落提取，完整资格条件及材料清单请核对原公告。', ...(positions.length === 1 ? shared.description : [...chunks(lines[0]).slice(0, 5), ...chunks(`报名方式：${applicationMethod}`)])].slice(0, 95),
  }));
}

export async function fetchChinaSourceJobs(source, fetchImpl = fetch) {
  const configured = sourceCatalog.find(item => item.type === source.type && item.canSync);
  if (!configured) fail('该站点目前仅提供官网入口，未实现自动同步', 400);
  // Fixed identities and destinations cannot be replaced by an arbitrary imported URL.
  const official = { ...configured, id: source.id || configured.id };
  if (source.type === 'tencent') {
    const read = publicReader('https://careers.tencent.com', fetchImpl);
    const readJson = async url => {
      const text = await read(url);
      try { return JSON.parse(text); } catch { fail('腾讯招聘未返回JSON，请通过官网查看', 502); }
    };
    const data = await readJson('https://careers.tencent.com/tencentcareer/api/post/Query?pageIndex=1&pageSize=10&language=zh-cn&area=cn');
    const jobs = parseTencentPosts(data, official);
    return mapLimited(jobs, async job => enrichTencentJob(job, await readJson(`https://careers.tencent.com/tencentcareer/api/post/ByPostId?postId=${job.externalId}&language=zh-cn`)));
  }
  if (source.type === 'ncss') {
    const read = publicReader('https://www.ncss.cn', fetchImpl);
    const raw = await read('https://www.ncss.cn/student/jobs/jobslist/ajax/?offset=1&limit=20&sourcesName=0&recruitType=0');
    let data;
    try { data = JSON.parse(raw); } catch { fail('国家大学生就业服务平台没有返回JSON，请通过官网查看', 502); }
    const jobs = parseNcssList(data, official);
    return mapLimited(jobs, async job => enrichNcssJob(job, await read(job.sourceUrl)));
  }
  const read = publicReader('https://rsj.sh.gov.cn', fetchImpl);
  const items = parseShanghaiIndex(await read(configured.homepage));
  const groups = await mapLimited(items, async item => parseShanghaiAnnouncement(await read(item.url), item, official));
  return groups.flat().slice(0, 500);
}
