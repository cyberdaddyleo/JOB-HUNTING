import { recommendedPageSources } from './page-source.js';
// Only enabled entries have a tested public, read-only connector. Counts are local sync results, not site-wide totals.
export const sourceCatalog = [
  ...recommendedPageSources,
  { id: 'cn-ncss', type: 'ncss', name: '国家大学生就业服务平台', homepage: 'https://www.ncss.cn/student/jobs/index.html', category: '教育部就业', description: '教育部学生服务与素质发展中心平台。读取公开职位列表与详情，每次最多20条；申请需回官网登录。', enabled: true, canSync: true, minIntervalMinutes: 60, status: '尚未同步', count: 0 },
  { id: 'cn-shanghai-rsj', type: 'shanghai-rsj', name: '上海市人社局 · 事业单位招聘', homepage: 'https://rsj.sh.gov.cn/tzpgg_17408/index.html', category: '人社官方招聘', description: '读取最新12篇官方招聘公告；展开HTML岗位表与明确岗位段落，附件未解析的记录标记为招聘公告待核对。', enabled: true, canSync: true, minIntervalMinutes: 60, status: '尚未同步', count: 0 },
  { id: 'cn-public-recruitment', type: 'directory', name: '中国公共招聘网', homepage: 'http://job.mohrss.gov.cn/', category: '人社公共招聘', description: '人力资源社会保障部公共招聘入口；本环境连接未成功，仅提供官网入口，未接通同步。', enabled: false, canSync: false, minIntervalMinutes: 60, status: '官网入口', count: 0 },
  { id: 'cn-shanghai-public', type: 'directory', name: '上海公共就业招聘新平台', homepage: 'https://jobs.rsj.sh.gov.cn/', category: '人社公共招聘', description: '上海人社官方平台；官网服务指南要求登录后查询与应聘，当前仅提供入口。', enabled: false, canSync: false, minIntervalMinutes: 60, status: '需官网登录', count: 0 },
  { id: 'cn-chrm', type: 'directory', name: '中国人力资源市场网', homepage: 'https://chrm.mohrss.gov.cn/', category: '人社公共招聘', description: '人力资源社会保障部所属官方人才服务入口；当前未实现职位同步。', enabled: false, canSync: false, minIntervalMinutes: 60, status: '官网入口', count: 0 },
  { id: 'cn-beijing-rsj', type: 'directory', name: '北京市人社局 · 事业单位招聘', homepage: 'https://rsj.beijing.gov.cn/xxgk/gkzp/', category: '人社官方招聘', description: '官方公告目录可访问，但本环境详情页返回403；仅提供官网入口，不绕过访问限制。', enabled: false, canSync: false, minIntervalMinutes: 60, status: '详情访问受限', count: 0 },
  { id: 'cn-tencent', type: 'tencent', name: '腾讯招聘 · 企业官方', homepage: 'https://careers.tencent.com/search.html', category: '企业官方招聘', description: '腾讯官方公开招聘接口，每次读取最新列表10条及岗位职责、任职要求；保留官网更新时间，申请回到官网完成。', enabled: true, canSync: true, minIntervalMinutes: 60, status: '尚未同步', count: 0 },
];

export const chinaSourceTypes = new Set(sourceCatalog.filter(source => source.canSync).map(source => source.type));
