const ago = days => new Date(Date.now() - days * 86400000).toISOString();

export function seedState() {
  const profile = {
    name: '林可（演示）', email: 'lin.ke@example.invalid', role: '产品经理', cities: ['杭州', '上海'],
    industries: ['人工智能', '互联网'], salaryMin: 20, salaryMax: 35, experience: 4, education: '本科',
    skills: ['产品规划', 'SQL', 'AI', '用户研究', '数据分析', '需求分析'],
    bio: '4年 B 端产品经验，关注 AI 在真实业务场景中的应用。希望加入重视用户价值与长期成长的团队。',
    resumeText: '【虚构演示简历，请替换为真实经历后再投递】\n林可｜产品经理｜本科｜4年工作经验\n方向：B端产品、AI应用、数据驱动的产品决策\n技能：产品规划、需求分析、用户研究、SQL、数据分析、AI\n项目经历：参与内部知识库产品从需求调研到版本上线，负责业务访谈、需求优先级与验收。\n求职意向：杭州 / 上海，产品经理，税前月薪20–35K。\n未提供的数据指标、学历院校与工作单位均不作推测。',
    portfolioUrl: '',
  };
  const rows = [
    ['j-ai-pm', 'AI 产品经理', '栖云智能', '杭州', '人工智能', 25, 35, 14, 3, 5, '本科', ['产品规划', 'AI', 'SQL', '用户研究'], '#ede8fb', '从用户场景出发，打造真正可用的企业 AI 助手。', ['负责企业知识库与智能助理的产品路线图', '建立评估集，持续优化回答质量与用户体验', '与研发、设计及客户成功团队共同推进交付'], ['3年以上 B 端产品经验，能独立推动完整迭代', '了解大模型能力边界，熟悉 RAG 应用', '有扎实的用户访谈与数据分析能力']],
    ['j-data-pm', '数据产品经理', '知序科技', '上海', '互联网', 22, 32, 14, 3, 5, '本科', ['产品规划', 'SQL', '数据分析', '需求分析'], '#e0eff9', '让业务团队用数据做出更好的决定。', ['负责指标平台与自助分析产品', '梳理业务数据口径并推进跨团队共识', '设计易用的数据分析体验'], ['熟悉 SQL 与常见分析方法', '有企业服务或数据平台产品经验', '善于将复杂问题拆解为可执行方案']],
    ['j-manufacturing', '工业数字化产品经理', '远川制造', '苏州', '智能制造', 18, 28, 13, 3, 6, '本科', ['需求分析', '产品规划', 'MES', '供应链'], '#f6e6d9', '走进真实工厂，连接生产现场与数字工具。', ['负责制造执行系统的流程设计', '深入工厂调研并搭建产品蓝图', '推动试点产线验证和版本迭代'], ['理解生产计划、质量追溯或仓储流程', '能接受合理频次的现场出差', '有制造业数字化经验优先']],
    ['j-finance', '金融科技产品经理', '和序数科', '上海', '金融科技', 28, 40, 16, 5, 8, '本科', ['产品规划', '风控', '数据分析', 'SQL'], '#e4e8f6', '将复杂的风险决策转化为清晰的产品体验。', ['负责企业风控工作台与决策工具', '协调业务、研发与合规团队需求', '完善数据质量与产品监控机制'], ['至少5年产品经验', '熟悉金融业务与风险管理流程', '具有严谨的文档与沟通能力']],
    ['j-health', '医疗健康产品经理', '沐禾健康', '杭州', '医疗健康', 20, 30, 13, 3, 5, '本科', ['用户研究', '产品规划', '需求分析', '医疗信息化'], '#e5efdd', '为医护和患者减少繁琐，让服务更有温度。', ['设计院外健康管理服务流程', '开展医护与患者访谈', '与临床顾问合作明确产品边界'], ['有健康服务或医疗信息化经验', '重视数据隐私和服务安全', '能够在多方诉求中形成清晰优先级']],
    ['j-design', '高级产品设计师', '留白设计', '上海', '设计创意', 22, 35, 13, 3, 6, '本科', ['Figma', '交互设计', '用户研究', '设计系统'], '#fae8e1', '用克制、细腻的设计，改善专业工具的日常。', ['负责 SaaS 核心业务流程的体验设计', '参与设计系统建设和设计评审', '协同产品团队开展可用性测试'], ['具备完整的产品设计作品集', '熟悉 Figma、交互原型与设计交付', '能解释设计决策及其用户价值']],
    ['j-growth', '增长产品经理', '轻舟互联', '杭州', '互联网', 20, 30, 14, 3, 5, '本科', ['产品规划', 'SQL', '数据分析', 'A/B测试'], '#f4ebcf', '把用户的第一次尝试，变成长期的使用习惯。', ['负责新用户激活和留存体验', '搭建增长实验流程与核心指标', '与市场、设计、研发紧密合作'], ['有增长或用户产品经验', '熟悉实验设计与因果分析基础', '能独立完成数据提取与洞察']],
    ['j-ai-research', '大模型应用研究员', '青屿实验室', '北京', '人工智能', 35, 55, 15, 2, 5, '硕士', ['Python', 'PyTorch', 'AI', '模型评测'], '#e9e5f4', '将前沿研究带入可评估、可复现的应用实践。', ['研究大模型推理与智能体评估方法', '搭建实验管线并记录对照结果', '与工程团队合作优化端到端质量'], ['计算机相关专业硕士及以上', '熟练使用 Python 与深度学习框架', '具备研究复现及论文阅读能力']],
    ['j-platform', '平台产品经理', '原点云', '杭州', '互联网', 24, 36, 14, 3, 6, '本科', ['产品规划', '需求分析', 'SQL', 'API设计'], '#dfeee8', '建设稳定、易用的基础能力，让团队高效协作。', ['规划账号、权限与开放平台能力', '梳理开发者使用旅程和平台文档', '支持多业务线对公共能力的接入'], ['理解 API、权限模型与平台产品方法', '具有良好的技术沟通能力', '关注长期架构与短期业务的平衡']],
    ['j-operations', 'AI 产品运营', '森语科技', '远程', '人工智能', 16, 24, 12, 2, 4, '大专', ['AI', '用户研究', '内容运营', '数据分析'], '#e3efd5', '和创作者一起，探索 AI 工作流的新可能。', ['运营产品反馈社区并整理用户洞察', '设计新用户上手内容与使用案例', '跟踪产品活跃与留存数据'], ['有工具产品或内容运营经验', '能清晰表达复杂操作与产品价值', '远程工作地区与协作时区需面谈确认']],
    ['j-ev', '智能座舱产品经理', '行知出行', '上海', '智能制造', 25, 38, 15, 3, 6, '本科', ['需求分析', '产品规划', '用户研究', '车联网'], '#e3eafa', '让每一次出行都更直觉、更安心。', ['负责智能座舱服务与交互体验', '通过用户研究识别关键驾驶场景', '协调软硬件团队推进功能落地'], ['理解汽车研发与交付流程', '具有跨团队项目推动能力', '关注驾驶安全及产品可用性']],
    ['j-open', '企业服务产品经理', '见山软件', '杭州', '互联网', null, null, 12, null, null, '', ['产品规划', '需求分析', '用户研究'], '#f0e8dc', '面向成长企业，构建轻量灵活的协作工具。', ['负责企业协作产品的需求与设计', '跟踪客户反馈，优化重点使用流程', '参与产品发布与客户培训'], ['具体年限、学历与薪资尚未披露', '欢迎结合真实经历沟通岗位适配度', '请联系招聘方核实完整要求']],
  ];
  const jobs = rows.map((r, i) => ({
    id: r[0], title: r[1], company: `${r[2]}`, initial: r[2].slice(0, 1), city: r[3], industry: r[4], salaryMin: r[5], salaryMax: r[6], salaryMonths: r[7], experienceMin: r[8], experienceMax: r[9], education: r[10], skills: r[11], color: r[12], description: [r[13], ...r[14]], requirements: r[15], source: '虚构演示', sourceUrl: '', contactEmail: `hr-${i + 1}@example.invalid`, isDemo: true, saved: [0, 1, 4].includes(i), createdAt: ago(i / 2),
  }));
  const applications = [
    ['a-data', 'j-data-pm', 'interview', 5], ['a-growth', 'j-growth', 'assessment', 4], ['a-health', 'j-health', 'sent', 3], ['a-platform', 'j-platform', 'draft', 1],
  ].map(([id, jobId, status, days]) => {
    const job = jobs.find(item => item.id === jobId);
    return { id, jobId, jobTitle: job.title, company: job.company, status, subject: `应聘${job.title}｜林可（演示）`, body: `【虚构演示申请，不能发送】\n您好，我对贵司${job.title}岗位感兴趣。我有4年产品经验，熟悉产品规划、SQL与用户研究。希望有机会进一步交流。\n林可`, to: job.contactEmail, createdAt: ago(days), updatedAt: ago(days - 1), ...(status !== 'draft' ? { sentAt: ago(days), sendState: 'sent' } : {}), isDemo: true, events: [{ at: ago(days), text: '虚构演示：创建申请' }, { at: ago(days - 1), text: `虚构演示：当前状态 ${status}` }] };
  });
  const messages = [
    { id: 'm-interview', applicationId: 'a-data', company: '知序科技', from: 'hr-2@example.invalid', subject: '数据产品经理｜面试沟通邀请', body: '【虚构演示邮件】\n林可，你好：\n感谢你对数据产品经理岗位的关注。团队希望进一步了解你的产品经历。请提供你下周方便沟通的时间段，我们确认后再发送正式邀请。\n建议准备一个数据产品项目案例，重点说明需求判断、指标口径与跨团队推进。\n知序科技 招聘团队', receivedAt: ago(0.2), kind: 'interview', read: false, replyDraft: '', isDemo: true },
    { id: 'm-assessment', applicationId: 'a-growth', company: '轻舟互联', from: 'hr-7@example.invalid', subject: '增长产品经理｜小作业说明', body: '【虚构演示邮件】\n你好，感谢此前的沟通。我们希望通过一份简短分析了解你的思考过程：选择一个熟悉的工具产品，分析新用户首日流失的可能原因，并提出验证方案。\n具体提交时间和形式请在回复中与我们确认。无需提供原公司的保密数据。', receivedAt: ago(0.7), kind: 'assessment', read: false, replyDraft: '', isDemo: true },
    { id: 'm-followup', applicationId: 'a-health', company: '沐禾健康', from: 'hr-5@example.invalid', subject: '已收到你的求职申请', body: '【虚构演示邮件】\n我们已收到你的申请，正在与用人团队沟通。如果进入后续环节，会再与你联系。感谢关注沐禾健康。', receivedAt: ago(1.3), kind: 'followup', read: true, replyDraft: '', isDemo: true },
  ];
  return {
    version: 1, profile, jobs, applications, messages,
    sources: [
      { id: 'demo', name: '虚构演示岗位', type: 'demo', enabled: true, status: '演示数据 · 非真实招聘', count: jobs.length },
      { id: 'remotive', name: 'Remotive', type: 'remotive', enabled: false, status: '未同步 · 远程岗位，地区限制需核实', count: 0 },
      { id: 'greenhouse', name: 'Greenhouse', type: 'greenhouse', enabled: false, board: '', status: '请填写企业 board token', count: 0 },
    ],
    settings: { autoReply: false, allowedSenders: [], syncIntervalMinutes: 60, autoSync: false, autoApply: false, minMatchScore: 80, dailyLimit: 5 },
    logs: [{ id: 'welcome', at: new Date().toISOString(), action: '初始化演示', detail: '已载入12个虚构岗位、4份演示申请和3封演示邮件。请替换个人档案；默认不发送邮件。', status: 'info' }],
    mailSeen: [], outboundLedger: [],
  };
}
