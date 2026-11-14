import React, { useState } from 'react';
import { ArrowRight, Check, ClipboardCheck, Download, FileCheck2, FileText, Files, Info, Mail, RefreshCw, Sparkles } from 'lucide-react';
import { useWorkspace } from '../store.jsx';
import { Badge, Button, Field, PageHeading, formatDate } from '../components/ui.jsx';
import './pages.css';
import './documents.css';

const kinds = [{ id: 'resume', label: '岗位简历', icon: FileText }, { id: 'cover-letter', label: '求职信', icon: Mail }, { id: 'checklist', label: '证据清单', icon: ClipboardCheck }];
const statusLabels = { supported: '档案有记录', related: '线索待核实', unknown: '待补充证据', gap: '明确差距' };
function initialJob() { try { return sessionStorage.getItem('jobpilot:documentJob') || ''; } catch { return ''; } }

function ResumePreview({ resume }) {
  return <article className="materials-paper">
    <h2>{resume.name || '求职简历'}</h2>
    <p className="materials-paper-target">应聘 {resume.targetCompany} · {resume.targetRole}</p>
    {(resume.email || resume.portfolioUrl) && <p className="materials-paper-meta">{[resume.email, resume.portfolioUrl].filter(Boolean).join(' · ')}</p>}
    <p className="materials-paper-meta">{[resume.role, resume.experience !== null ? `${resume.experience}年工作经验` : '', resume.education].filter(Boolean).join(' · ')}</p>
    {resume.summary && <section><h3>个人简介</h3><p className="materials-verbatim">{resume.summary}</p></section>}
    {resume.relevantSkills?.length > 0 && <section><h3>岗位相关技能</h3><p>{resume.relevantSkills.join(' · ')}</p></section>}
    {resume.otherSkills?.length > 0 && <section><h3>其他技能</h3><p>{resume.otherSkills.join(' · ')}</p></section>}
    {resume.sourceText && <section><h3>经历与项目</h3><p className="materials-verbatim">{resume.sourceText}</p></section>}
  </article>;
}

function EvidencePreview({ material }) {
  return <div className="materials-evidence"><div className="materials-evidence-intro"><h2>每条要求，都有据可查。</h2><p>“档案有记录”仅表示相关信息已填写；完整任职条件、能力深度与经历证明仍需核实。</p></div>{material.evidence.map(item => <article key={item.id} className={`materials-evidence-row ${item.status}`}><div><h3>{item.requirement}</h3><Badge tone={item.status === 'supported' ? 'green' : item.status === 'gap' ? 'orange' : 'gray'}>{statusLabels[item.status] || '待核实'}</Badge></div><p>{item.evidence}</p><small>依据：{item.source}{material.focusEvidenceIds?.includes(item.id) ? ' · 建议优先核对' : ''}</small></article>)}</div>;
}

export default function Documents() {
  const { data, mutate, notify, navigate } = useWorkspace();
  const [jobId, setJobId] = useState(initialJob), [activeId, setActiveId] = useState(''), [kind, setKind] = useState('resume'), [busy, setBusy] = useState(false);
  if (!data) return null;
  const selectedId = data.jobs.some(job => job.id === jobId) ? jobId : data.jobs[0]?.id || '';
  const job = data.jobs.find(item => item.id === selectedId);
  const saved = (data.materials || []).filter(item => item.jobId === selectedId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const material = saved.find(item => item.id === activeId) || saved[0];
  const stale = material && data.profileRevision !== undefined && material.profileRevision !== data.profileRevision;
  const download = format => `/api/materials/${encodeURIComponent(material.id)}/download?kind=${kind}&format=${format}`;
  const selectJob = value => { setJobId(value); setActiveId(''); try { sessionStorage.setItem('jobpilot:documentJob', value); } catch {} };
  const generate = async event => {
    event.preventDefault(); setBusy(true);
    try { const next = await mutate('/materials', { jobId: selectedId, regenerate: Boolean(material) }); setActiveId(next.id); notify('岗位简历、求职信与证据清单已生成，可下载为 Word 文件。'); }
    catch {} finally { setBusy(false); }
  };
  return <>
    <PageHeading title="让每份申请，都更贴合机会。" subtitle="从真实档案出发，整理一份岗位简历、一封求职信，以及可逐项核对的证据清单。" />
    <div className="materials-layout">
      <aside className="materials-aside">
        <form className="panel materials-form" onSubmit={generate}>
          <div className="wf-section-heading"><div className="wf-feature-icon"><Files size={22} /></div><div><h2>准备这份申请</h2><p>选定岗位，生成可下载的文件。</p></div></div>
          <Field label="目标岗位"><select value={selectedId} onChange={event => selectJob(event.target.value)} required>{!data.jobs.length && <option value="">暂无岗位，请先导入</option>}{data.jobs.map(item => <option key={item.id} value={item.id}>{item.title} · {item.company}{item.isDemo ? '（示例）' : ''}</option>)}</select></Field>
          {job && <div className="materials-job-detail"><span>{job.company}</span><strong>{job.title}</strong><p>{job.city} · {job.skills?.slice(0, 4).join(' / ') || '技能要求待确认'}</p></div>}
          <div className="materials-included"><span><FileText size={16} /><span><strong>岗位简历</strong><small>突出相关技能，保留原始经历</small></span><Check size={14} /></span><span><Mail size={16} /><span><strong>专属求职信</strong><small>围绕岗位，清晰介绍自己</small></span><Check size={14} /></span><span><ClipboardCheck size={16} /><span><strong>岗位证据清单</strong><small>区分已知信息与待确认要求</small></span><Check size={14} /></span></div>
          <Button type="submit" busy={busy} disabled={!selectedId} className="materials-generate">{material ? <RefreshCw size={16} /> : <Sparkles size={16} />}{busy ? '正在整理求职材料…' : material ? '根据最新档案重新生成' : '生成这份求职材料'}</Button>
          <p className="materials-mode-note">{data.capabilities?.ai ? 'AI 辅助排列重点；姓名、经历、学历与成果始终来自你的档案。' : '当前使用本地规则。连接 AI 后可辅助排序，文件仍只使用档案事实。'}</p>
        </form>
        <div className="materials-source-note"><FileCheck2 size={22} /><h3>真实经历，是材料的底气。</h3><p>没有提供的公司、学校、证书与成果数字不会自动补写。修改档案后，可重新生成对应岗位的材料。</p><button type="button" className="text-link" onClick={() => navigate('profile')}>检查我的档案 <ArrowRight size={14} /></button></div>
      </aside>
      <section className="panel materials-workspace" aria-label="求职材料预览">
        {material ? <>
          <div className="materials-topbar"><div><Badge tone={material.isDemo ? 'orange' : 'green'}>{material.isDemo ? '虚构演示材料' : '已保存到本地'}</Badge><small>{formatDate(material.createdAt)}</small></div>{saved.length > 1 && <label className="materials-version">版本<select aria-label="材料版本" value={material.id} onChange={event => setActiveId(event.target.value)}>{saved.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? '最新 · ' : ''}{formatDate(item.createdAt)}</option>)}</select></label>}</div>
          {stale && <div className="materials-alert" role="status"><Info size={17} /><p>档案已更新，这份材料保留了生成时的内容。请重新生成后再投递。</p></div>}
          {material.warnings?.length > 0 && <div className="materials-alert"><Info size={17} /><div>{material.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
          <div className="materials-tabs" aria-label="预览材料类型">{kinds.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={kind === id ? 'active' : ''} aria-pressed={kind === id} onClick={() => setKind(id)}><Icon size={16} />{label}</button>)}</div>
          <div className="materials-download-bar"><span>{kinds.find(item => item.id === kind)?.label} · 可编辑文件</span><div><a className="button primary" href={download('docx')} download><Download size={15} />Word 文档</a><a className="button secondary" href={download('md')} download>Markdown</a><a className="button ghost" href={download('html')} download>打印版 HTML</a></div></div>
          <div className="materials-preview">{material.isDemo && <p className="materials-demo-label">虚构演示材料 · 请替换为真实资料后使用</p>}{kind === 'resume' ? <ResumePreview resume={material.resume} /> : kind === 'cover-letter' ? <article className="materials-paper materials-cover"><h2>{material.jobTitle}求职信</h2><p className="materials-verbatim">{material.coverLetter}</p></article> : <EvidencePreview material={material} />}</div>
          <footer className="materials-footer"><span><Info size={14} />{material.modeLabel}</span><p>打开下载的 HTML，使用浏览器“打印 → 另存为 PDF”即可获得 PDF 文件。{material.generationNote}</p></footer>
        </> : <div className="materials-empty"><div className="materials-file-stack"><div /><div /><span><FileText size={55} strokeWidth={1.2} /><i /><i /><i /></span><b><Check size={19} /></b></div><h2>你的下一份申请，从这里开始。</h2><p>选一个机会，把已有经历整理成<br />可以预览、修改和下载的求职文件。</p><div className="materials-format-list"><span>DOCX</span><span>Markdown</span><span>打印版 HTML</span></div>{!selectedId && <Button variant="secondary" onClick={() => navigate('settings')}>先导入岗位 <ArrowRight size={15} /></Button>}</div>}
      </section>
    </div>
  </>;
}
