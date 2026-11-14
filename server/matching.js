const educationRank = { 高中: 1, 大专: 2, 本科: 3, 硕士: 4, 博士: 5 };
const clean = value => String(value || '').trim().toLowerCase();

/** Preference score is deliberately independent from hard eligibility. Unknown earns no points. */
export function matchJob(profile, job) {
  const reasons = [];
  let hardGap = false;
  let hardUnknown = false;
  let score = 0;
  const reason = (label, detail, status) => reasons.push({ label, detail, status });
  if (job.education === '不限') reason('学历要求', '岗位明确不限学历', 'pass');
  else if (!educationRank[job.education] || !educationRank[profile.education]) {
    hardUnknown = true;
    reason('学历要求', '岗位或个人学历信息不足，需要人工确认', 'unknown');
  } else if (educationRank[profile.education] < educationRank[job.education]) {
    hardGap = true;
    reason('学历要求', `岗位要求${job.education}，当前为${profile.education}；不满足硬性条件`, 'gap');
  } else reason('学历要求', `${profile.education}满足${job.education}及以上要求`, 'pass');

  if (!Number.isFinite(job.experienceMin) || !Number.isFinite(profile.experience)) {
    hardUnknown = true;
    reason('工作年限', '岗位或个人年限未明确，需要人工确认', 'unknown');
  } else if (profile.experience < job.experienceMin) {
    hardGap = true;
    reason('工作年限', `至少需要${job.experienceMin}年，当前${profile.experience}年`, 'gap');
  } else reason('工作年限', `${profile.experience}年经验满足至少${job.experienceMin}年要求${job.experienceMax && profile.experience > job.experienceMax ? '；超过标注区间上限，请确认职级' : ''}`, 'pass');

  const wantedSkills = Array.isArray(job.skills) ? job.skills : [];
  const owned = new Set((profile.skills || []).map(clean));
  const missingSkills = wantedSkills.filter(skill => !owned.has(clean(skill)));
  if (wantedSkills.length) {
    score += 40 * (wantedSkills.length - missingSkills.length) / wantedSkills.length;
    reason('技能契合', `${wantedSkills.length - missingSkills.length}/${wantedSkills.length}项明确技能匹配${missingSkills.length ? `；待补充：${missingSkills.join('、')}` : ''}`, missingSkills.length ? 'gap' : 'pass');
  } else reason('技能契合', '岗位未提供结构化技能，暂不计分', 'unknown');

  const cities = profile.cities || [];
  const cityPass = cities.some(city => clean(job.city).includes(clean(city))) || /远程|remote/i.test(job.city || '');
  if (!cities.length || !job.city || job.city === '待确认') reason('工作地点', '地点或求职偏好未明确', 'unknown');
  else { score += cityPass ? 20 : 0; reason('工作地点', cityPass ? `${job.city}符合地点偏好（远程岗位仍需核对地区限制）` : `${job.city}不在偏好城市`, cityPass ? 'pass' : 'gap'); }

  const industryPass = (profile.industries || []).some(industry => clean(industry) === clean(job.industry));
  if (!(profile.industries || []).length || !job.industry || job.industry === '待确认') reason('行业偏好', '行业或行业偏好未明确', 'unknown');
  else { score += industryPass ? 15 : 0; reason('行业偏好', industryPass ? `${job.industry}符合行业偏好` : `${job.industry}不在当前行业偏好`, industryPass ? 'pass' : 'gap'); }

  const rolePass = clean(job.title).includes(clean(profile.role)) && Boolean(clean(profile.role));
  if (!profile.role || !job.title) reason('目标岗位', '目标岗位或岗位名称未明确', 'unknown');
  else { score += rolePass ? 10 : 0; reason('目标岗位', rolePass ? `包含目标岗位「${profile.role}」` : `岗位名称与「${profile.role}」不同，可人工判断`, rolePass ? 'pass' : 'gap'); }

  if (![job.salaryMin, job.salaryMax, profile.salaryMin, profile.salaryMax].every(Number.isFinite)) reason('薪资范围', '薪资未明确或币种不可比，暂不计分；不推测薪酬', 'unknown');
  else {
    const overlaps = job.salaryMax >= profile.salaryMin && job.salaryMin <= profile.salaryMax;
    score += overlaps ? 15 : 0;
    reason('薪资范围', overlaps ? '月薪区间与期望有交集（税前人民币千元）' : '月薪区间与期望暂无交集', overlaps ? 'pass' : 'gap');
  }
  const eligibility = hardGap ? '不符合' : hardUnknown ? '待确认' : missingSkills.length ? '有差距' : '符合';
  return { score: Math.max(0, Math.min(100, Math.round(score))), eligibility, reasons, missingSkills };
}
