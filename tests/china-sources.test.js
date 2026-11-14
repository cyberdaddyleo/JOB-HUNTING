import test from 'node:test';
import assert from 'node:assert/strict';
import { robotsAllows, extractDeadline, parseNcssList, enrichNcssJob, parseTencentPosts, enrichTencentJob, parseShanghaiIndex, parseShanghaiAnnouncement, fetchChinaSourceJobs } from '../server/china-sources.js';
import { sourceCatalog } from '../server/source-catalog.js';
import { normalizeJob } from '../server/safety.js';

// Reduced, exact-field fixtures from public official pages, fetched 2026-11-14.
// NCSS list: https://www.ncss.cn/student/jobs/jobslist/ajax/?offset=1&limit=20&sourcesName=0&recruitType=0
const ncssItem = { jobName: '客户运营', highMonthPay: 15, updateDate: 1792547501417, lowMonthPay: 10, headCount: 0, recruitType: '0', publishDate: 1792545987842, degreeName: '硕士及以上', recName: '中邮消费金融有限公司', areaCodeName: '广东', jobId: 'Whw7FLcsHztpyWF7GLWhwB', recScale: '500-999人', major: '金融 经济 市场营销 工商管理', recProperty: '合资企业' };
const ncssData = { flag: true, data: { list: [ncssItem] } };
const ncssDetail = `<div class="site-tag">广东省广州市天河区</div><div class="jobdetail-box"><pre class="mainContent">岗位职责：
1、协助开展用户分层管理，参与搭建适配产品特性的用户分层运营体系；
任职资格要求：
1、金融、经济、市场营销、工商管理等相关专业，硕士研究生及以上学历；留学人员需取得教育部学历学位认证；
4、熟练使用Office办公软件，具备良好的Excel数据处理能力；</pre></div><span id="mainindustries">投资/基金/证券/期货</span>`;
// https://rsj.sh.gov.cn/tzpgg_17408/20261109/t0035_1444550.html
const clinicalUrl = 'https://rsj.sh.gov.cn/tzpgg_17408/20261109/t0035_1444550.html';
const clinical = `<meta name="ArticleTitle" content="上海市公共卫生临床中心工作人员招聘公告"><meta name="PubDate" content="2026-11-10 00∶11"><div id="ivs_content"><div class="TRS_Editor">
<p>上海市公共卫生临床中心是一所承载百年历史底蕴、兼具雄厚实力与蓬勃发展活力的三级甲等医院，为复旦大学附属医院。</p>
<p>二、招聘岗位及职数</p><p>1、医师岗位，职数10名；</p><p>具有医师资格及执业证书，已获得住院医师规范化培训合格证书；有三甲医院工作经历；50周岁以下。</p>
<p>2、科研岗位，职数10名；</p><p>专职从事医学相关科学研究工作的专业技术人员：具有研究系列、技术员系列或实验动物（兽医)系列职称；具有博士学位，或具有硕士学位并聘任中级职称；有三甲医院工作经历；50周岁以下。</p>
<p>三、招聘办法</p><p>本次招聘采用电子邮件方式报名，请应聘者将个人简历、最高学历学位证书、资格证书、医师执业证书、住院医师规培合格证书电子版等材料扫描件发送至电子邮箱：hr_gw@shaphc.org，并请注明：姓名+应聘岗位。</p>
<p>报名时间：公告发布之日起至2026年11月19日。</p><p align="right">上海市公共卫生临床中心</p><p align="right">2026年11月10日</p></div></div>`;
// Reduced first two rows of the official rowspan table:
// https://rsj.sh.gov.cn/tzpgg_17408/20261105/t0035_1444536.html
const tableArticle = `<meta name="ArticleTitle" content="上海市质子重离子医院（上海市质子重离子临床技术研发中心）招聘公告"><meta name="PubDate" content="2026-11-05 14∶11"><div id="ivs_content"><div class="TRS_Editor"><p>二、招聘岗位、职数及岗位要求</p><table><tbody>
<tr><td>序号</td><td>部门</td><td>岗位</td><td>职数</td><td>任职条件</td></tr>
<tr><td rowspan="2">1</td><td rowspan="2"><p>综合</p><p>办公室</p></td><td>主任</td><td>1</td><td><p>1.相关专业硕士及以上学历或学位，医院管理、行政管理专业优先；</p><p>2.有10年及以上相关管理工作经验，有国内三甲医院和（或）国际化医院党政办管理工作经验者优先；</p></td></tr>
<tr><td>副主任</td><td>1</td><td><p>1.相关专业硕士及以上学历或学位；</p><p>2.有5年及以上相关管理工作经验，有国内三甲医院和（或）国际化医院党政办管理工作经验者优先；</p></td></tr>
</tbody></table><p>本次报名采取邮件报名方式，请将个人简历和相关证书扫描件等材料发至zhaopin@sphic.org.cn，邮件标题注明“姓名+应聘岗位”，报名截止时间：即日起至2026年11月13日。</p></div></div>`;

test('NCSS official JSON maps published time, RMB thousands per month, and exact job identity', () => {
  const [job] = parseNcssList(ncssData);
  assert.equal(job.title, '客户运营');
  assert.equal(job.salaryMin, 10);
  assert.equal(job.salaryMax, 15);
  assert.equal(job.education, '硕士');
  assert.equal(job.publishedAt, '2026-10-21T01:26:27.842Z');
  assert.equal(job.recordType, 'job');
  assert.equal(job.externalId, ncssItem.jobId);
  assert.equal(job.isDemo, false);
  assert.doesNotThrow(() => normalizeJob(job));
  const enriched = enrichNcssJob(job, ncssDetail);
  assert.equal(enriched.city, '广东省广州市天河区');
  assert.equal(enriched.industry, '投资/基金/证券/期货');
  assert.ok(enriched.requirements.some(line => line.includes('Excel')));
  assert.ok(enriched.description.some(line => line.includes('用户分层管理')));
  assert.equal(enriched.contactEmail, '');
});

test('NCSS refuses login/error responses, invalid ids, missing detail, and does not invent salaries', () => {
  assert.throws(() => parseNcssList({ flag: false, global: [{ des: '请登录后查看' }] }), /登录/);
  assert.deepEqual(parseNcssList({ flag: true, data: { list: [{ ...ncssItem, jobId: '../../private' }] } }), []);
  assert.throws(() => enrichNcssJob(parseNcssList(ncssData)[0], '<html>请登录</html>'), /详情缺少/);
  const [job] = parseNcssList({ flag: true, data: { list: [{ ...ncssItem, lowMonthPay: 0, highMonthPay: 0, recruitType: '1' }] } });
  assert.equal(job.salaryMin, null);
  assert.equal(job.salaryMax, null);
  assert.equal(job.recordType, 'announcement');
});

test('Shanghai index permits only official dated notice paths and de-duplicates', () => {
  const index = `<li><a href="/tzpgg_17408/20261109/t0035_1444550.html" title="上海市公共卫生临床中心工作人员招聘公告">公告</a><span class="time">2026-11-10</span></li><a href="https://evil.test/notice">招聘</a><a href="/tzpgg_17408/index.html">更多</a><a href="/tzpgg_17408/20261109/t0035_1444550.html">重复</a>`;
  const items = parseShanghaiIndex(index);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, clinicalUrl);
  assert.equal(items[0].publishedAt, '2026-11-10');
  assert.throws(() => parseShanghaiIndex('<html>new layout</html>'), /未找到公告/);
});

test('Shanghai numbered roles become separate vacancies sharing provenance, with deadline and email', () => {
  const jobs = parseShanghaiAnnouncement(clinical, { url: clinicalUrl });
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map(job => job.title), ['医师岗位', '科研岗位']);
  assert.equal(new Set(jobs.map(job => job.externalId)).size, 2);
  for (const job of jobs) {
    assert.equal(job.sourceUrl, clinicalUrl);
    assert.equal(job.recordType, 'job');
    assert.equal(job.contactEmail, 'hr_gw@shaphc.org');
    assert.equal(job.deadline, '2026-11-19');
    assert.equal(job.publishedAt, '2026-11-10');
    assert.equal(job.company, '上海市公共卫生临床中心');
    assert.equal(job.requiresReview, true);
    assert.doesNotThrow(() => normalizeJob(job));
  }
  assert.ok(jobs[1].requirements.some(line => line.includes('博士学位')));
  assert.ok(!jobs[0].description.some(line => line.includes('专职从事医学')));
});

test('Shanghai table expands rowspans without dropping departments or mixing row requirements', () => {
  const jobs = parseShanghaiAnnouncement(tableArticle, { url: 'https://rsj.sh.gov.cn/tzpgg_17408/20261105/t0035_1444536.html' });
  assert.deepEqual(jobs.map(job => job.title), ['综合办公室 · 主任', '综合办公室 · 副主任']);
  assert.ok(jobs[0].requirements.some(line => line.includes('10年')));
  assert.ok(jobs[1].requirements.some(line => line.includes('5年')));
  assert.ok(!jobs[1].requirements.some(line => line.includes('10年')));
  assert.equal(jobs[0].deadline, '2026-11-13');
  assert.equal(jobs[0].contactEmail, 'zhaopin@sphic.org.cn');
});

test('attachment-only notice stays an announcement and multiple emails are not arbitrarily chosen', () => {
  const html = `<meta name="ArticleTitle" content="上海图书馆公开招聘公告"><div id="ivs_content"><div class="TRS_Editor"><p>具体岗位要求、招聘人数详见附件1。</p><p>报名邮箱：first@library.cn；second@library.cn</p><a href="jobs.xlsx">岗位表.xlsx</a></div></div>`;
  const [job] = parseShanghaiAnnouncement(html, { url: clinicalUrl, publishedAt: '2026-11-10' });
  assert.equal(job.recordType, 'announcement');
  assert.equal(job.requiresReview, true);
  assert.equal(job.contactEmail, '');
  assert.ok(job.requirements.some(line => line.includes('多个岗位')));
});

test('deadline parser uses application date, accepts ranges, rejects impossible dates', () => {
  assert.equal(extractDeadline(['居住证计算截止时间为2026年12月31日', '报名时间:即日—2026年11月18日。'], '2026-11-09'), '2026-11-18');
  assert.equal(extractDeadline(['1、报名：意向者请于2026年11月18日前填写报名表。']), '2026-11-18');
  assert.equal(extractDeadline(['报名时间：11月11日至11月20日。'], '2026-11-10'), '2026-11-20');
  assert.equal(extractDeadline(['报名时间：即日起至2026年2月30日。']), '');
  assert.equal(extractDeadline(['报名时间：2026年11月1日至2026年11月15日，笔试时间2026年11月20日。'], '2026-11-01'), '2026-11-15');
  assert.equal(extractDeadline(['报名时间：即日起至2026年11月15日；面试时间2026年11月25日。']), '2026-11-15');
});

test('consultation-only addresses and explicit online-only application do not become recipient emails', () => {
  const article = clinical.replace('本次招聘采用电子邮件方式报名，请应聘者将个人简历、最高学历学位证书、资格证书、医师执业证书、住院医师规培合格证书电子版等材料扫描件发送至电子邮箱：hr_gw@shaphc.org，并请注明：姓名+应聘岗位。', '报名方式：仅接受官网系统报名，不接收邮件简历。</p><p>报名咨询邮箱：consult@unit.careers（仅用于咨询，不接受简历）');
  const jobs = parseShanghaiAnnouncement(article, { url: clinicalUrl });
  assert.equal(jobs[0].contactEmail, '');
  assert.match(jobs[0].applicationMethod, /仅接受官网系统报名/);
  const consultationOnly = clinical.replace('hr_gw@shaphc.org', 'consult@unit.careers（仅用于咨询）');
  assert.equal(parseShanghaiAnnouncement(consultationOnly, { url: clinicalUrl })[0].contactEmail, '');
});

test('robots respects specific agents, groups, wildcard anchors, longest allow and empty disallow', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /student/', '/student/jobs/'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /student/\nAllow: /student/jobs/', '/student/jobs/'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.json$\n', '/jobs.json'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.json$\n', '/jobs.json?x=1'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nUser-agent: JobPilot\nDisallow:', '/student/jobs/'), true);
  assert.equal(robotsAllows('<html><title>404 Not Found</title></html>', '/student/jobs/'), true);
});

test('reader checks robots before job requests and refuses restricted providers', async () => {
  const calls = [];
  await assert.rejects(fetchChinaSourceJobs(sourceCatalog.find(s => s.id === 'cn-ncss'), async url => { calls.push(url); return new Response('User-agent: *\nDisallow: /student/'); }), /robots/);
  assert.deepEqual(calls, ['https://www.ncss.cn/robots.txt']);
  await assert.rejects(fetchChinaSourceJobs(sourceCatalog.find(s => s.id === 'cn-public-recruitment'), async () => { throw new Error('must not fetch'); }), /仅提供官网入口/);
});

test('complete NCSS connector fetches actual-contract fixtures with fixed hosts and bounded reads', async () => {
  const calls = [];
  const jobs = await fetchChinaSourceJobs({ ...sourceCatalog.find(s => s.id === 'cn-ncss'), homepage: 'https://evil.test/' }, async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, url.endsWith('/robots.txt') ? 'manual' : 'error');
    assert.ok(options.signal);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url.includes('/ajax/')) return Response.json(ncssData);
    return new Response(ncssDetail);
  });
  assert.equal(jobs.length, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => new URL(url).hostname === 'www.ncss.cn'));
  await assert.rejects(fetchChinaSourceJobs(sourceCatalog.find(s => s.id === 'cn-ncss'), async url => url.endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } })), /超过2MB/);
  await assert.rejects(fetchChinaSourceJobs(sourceCatalog.find(s => s.id === 'cn-ncss'), async () => new Response('blocked', { status: 403 })), /HTTP 403/);
});

// Reduced official API fixture fetched 2026-11-14:
// https://careers.tencent.com/tencentcareer/api/post/Query?pageIndex=1&pageSize=10&language=zh-cn&area=cn
const tencentItem = { PostId: '2076693565974687744', RecruitPostName: '和平精英-2D美宣设计师-玩法', CountryName: '中国', LocationName: '上海', BGName: 'IEG', ComName: '', ProductName: '和平精英手游', CategoryName: '设计', Responsibility: '1.参与前瞻性设计讨论，根据项目需求配合团队完成主视觉和宣传美宣的设计工作；', LastUpdateTime: '2026年11月14日', IsValid: true, RequireWorkYearsName: '三年以上工作经验' };
const tencentList = { Code: 200, Data: { Count: 2168, Posts: [tencentItem] } };
const tencentDetail = { Code: 200, Data: { ...tencentItem, Requirement: '1.美术设计相关专业，有较强的2d能力和3d渲染能力，对画面构图，氛围又敏锐的把握；\\n2.有广阔的视野与渠道，对最前沿的设计和创意有明锐的洞察，会用好工具和技术例如AI对所负责模块赋能；' } };

test('Tencent preserves exact large job ids and distinguishes last update from publication', () => {
  const [job] = parseTencentPosts(tencentList);
  assert.equal(job.externalId, '2076693565974687744');
  assert.equal(job.company, '腾讯');
  assert.equal(job.sourceUpdatedAt, '2026-11-14');
  assert.equal(job.publishedAt, '');
  assert.equal(job.salaryMin, null);
  assert.equal(job.experienceMin, 3);
  assert.equal(job.experienceMax, null);
  const detail = enrichTencentJob(job, tencentDetail);
  assert.ok(detail.requirements.some(value => value.includes('3d渲染能力')));
  assert.ok(detail.requirements.some(value => value.startsWith('2.有广阔')));
  assert.equal(detail.contactEmail, '');
  assert.doesNotThrow(() => normalizeJob(detail));
  assert.throws(() => enrichTencentJob(job, { Code: 200, Data: { ...tencentDetail.Data, PostId: '123' } }), /身份不匹配/);
});

test('Tencent connector uses public fixed-host endpoints and checks robots before reading', async () => {
  const calls = [];
  const jobs = await fetchChinaSourceJobs(sourceCatalog.find(source => source.type === 'tencent'), async url => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('<html><title>404 | 腾讯招聘</title></html>');
    return Response.json(url.includes('/ByPostId?') ? tencentDetail : tencentList);
  });
  assert.equal(jobs.length, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => new URL(url).hostname === 'careers.tencent.com'));
  assert.ok(calls[2].includes('postId=2076693565974687744'));
  assert.throws(() => parseTencentPosts({ Code: 403 }), /未返回公开岗位列表/);
});

test('robots follows one same-origin redirect only and refuses cross-origin redirects', async () => {
  const source = sourceCatalog.find(item => item.type === 'tencent');
  const calls = [];
  const jobs = await fetchChinaSourceJobs(source, async url => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 302, headers: { location: '/404.html' } });
    if (url.endsWith('/404.html')) return new Response('<html><title>404 | 腾讯招聘</title></html>');
    return Response.json(url.includes('/ByPostId?') ? tencentDetail : tencentList);
  });
  assert.equal(jobs.length, 1);
  assert.equal(calls[1], 'https://careers.tencent.com/404.html');
  await assert.rejects(fetchChinaSourceJobs(source, async () => new Response('', { status: 302, headers: { location: 'https://another.test/robots.txt' } })), /超出官方域名/);
});
