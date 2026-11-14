import React, {useEffect, useMemo, useState} from 'react';
import {ArrowUpRight, Check, Columns3, FileText, List, Loader2, RefreshCw, Send, ShieldCheck, Square, X} from 'lucide-react';
import {api, useWorkspace} from '../store.jsx';
import {Button, Field, PageHeading, EmptyState, Badge, Modal, SourceLink, formatDate, CompanyMark} from '../components/ui.jsx';
import BatchReview from '../components/BatchReview.jsx';
import './pages.css';
import './batches.css';

const stages = {draft:'待完善', queued:'已审核待发送', sent:'已投递', replied:'收到回复', assessment:'笔试中', interview:'面试中', offer:'收到 Offer', rejected:'已结束'};
const taskStages = {queued:'等待开始', running:'正在发送', completed:'处理完成', cancelled:'已取消', interrupted:'任务已中断'};
const itemStages = {pending:'等待处理', sending:'发送中', sent:'已发送', skipped:'已跳过', failed:'处理失败', cancelled:'已取消'};
const activeTask = batch => ['queued', 'running'].includes(batch.status);
const tone = status => status === 'offer' || status === 'sent' ? 'green' : status === 'queued' ? 'amber' : 'gray';
const canSelect = item => ['draft', 'queued'].includes(item.status) && !item.sentAt && !item.sendState;
const hasEmail = item => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.to || '');
const reviewable = item => canSelect(item) && hasEmail(item) && Boolean(item.subject?.trim() && item.body?.trim());
function initialSelection() {
  try { const ids = JSON.parse(sessionStorage.getItem('jobpilot:batchApplications') || '[]'); return Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string'))].slice(0, 30) : []; } catch { return []; }
}

export default function Applications() {
  const {data, mutate, refresh, notify, navigate} = useWorkspace();
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('list');
  const [editing, setEditing] = useState(() => {
    const item = data?.applications.find(a => a.id === sessionStorage.getItem('jobpilot:openApplication'));
    return item ? {...item, reviewSnapshotRevision:data.profileRevision || 0} : null;
  });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState(initialSelection);
  const [batchReview, setBatchReview] = useState(null);
  const [batchError, setBatchError] = useState('');
  const [taskUpdates, setTaskUpdates] = useState({});
  const [pollError, setPollError] = useState('');
  const applications = data?.applications || [];
  const caps = data?.capabilities || {};
  const batches = useMemo(() => {
    const merged = new Map((data?.batches || []).map(batch => [batch.id, batch]));
    Object.values(taskUpdates).forEach(batch => merged.set(batch.id, batch));
    return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [data?.batches, taskUpdates]);
  const activeIds = batches.filter(activeTask).map(batch => batch.id).join('|');

  useEffect(() => {
    sessionStorage.removeItem('jobpilot:openApplication');
    sessionStorage.removeItem('jobpilot:batchApplications');
  }, []);
  useEffect(() => {
    setSelected(previous => previous.filter(id => applications.some(item => item.id === id && canSelect(item))));
  }, [data?.applications]);
  useEffect(() => {
    if (!activeIds) return;
    let stopped = false, timer;
    async function poll() {
      const results = await Promise.allSettled(activeIds.split('|').map(id => api(`/batches/${id}`)));
      if (stopped) return;
      const updates = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      setTaskUpdates(previous => ({...previous, ...Object.fromEntries(updates.map(batch => [batch.id, batch]))}));
      setPollError(results.some(result => result.status === 'rejected') ? '暂时无法获取任务进度，正在重试。请勿重复发送。' : '');
      await refresh().catch(() => {});
      if (!stopped) timer = setTimeout(poll, 1000);
    }
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [activeIds, refresh]);

  if (!data) return null;
  const items = applications.filter(a => filter === 'all' || a.status === filter);
  const selectedItems = applications.filter(item => selected.includes(item.id) && canSelect(item));
  const visibleEligible = items.filter(canSelect).slice(0, 30);
  const allVisibleSelected = visibleEligible.length > 0 && visibleEligible.every(item => selected.includes(item.id));
  const revision = data.profileRevision || 0;
  const profileIsDemo = data.profileIsDemo ?? /虚构演示|[（(](?:虚构|演示|示例)[）)]|example\.(?:invalid|com|org|net)/i.test([data.profile.name, data.profile.email, data.profile.resumeText].join(' '));
  const materialFor = item => (data.materials || []).find(material => material.id === item.materialId);
  const jobFor = item => data.jobs.find(job => job.id === item.jobId);
  const attachmentFor = item => item.materialId ? `岗位定制简历（Word） · ${materialFor(item)?.title || item.jobTitle}${materialFor(item)?.profileRevision !== revision ? ' · 需按最新档案更新' : ''}` : data.profile.resumeFile?.name ? `原始简历 · ${data.profile.resumeFile.name}` : '当前档案的简历文本（TXT）';
  const canReview = item => reviewable(item) && (!item.materialId || materialFor(item)?.profileRevision === revision);
  const sendable = item => reviewable(item) && item.status === 'queued' && item.reviewedAt && item.reviewedProfileRevision === revision && !item.isDemo && !item.profileWasDemo && (!item.materialId || (materialFor(item)?.profileRevision === revision && !materialFor(item)?.isDemo && !materialFor(item)?.profileWasDemo));
  const selectedSendable = selectedItems.filter(sendable);
  const canBatchSend = caps.smtp && caps.outboundEnabled && !profileIsDemo && selectedSendable.length > 0 && !activeIds;
  const locked = Boolean(editing?.sentAt || editing?.sendState);
  const canSend = caps.smtp && caps.outboundEnabled && editing && !editing.isDemo && !editing.profileWasDemo && !profileIsDemo && !locked && (!editing.materialId || (materialFor(editing)?.profileRevision === revision && !materialFor(editing)?.isDemo && !materialFor(editing)?.profileWasDemo));
  const availableMaterials = editing ? (data.materials || []).filter(material => material.jobId === editing.jobId && material.profileRevision === revision) : [];
  const sendBlockReason = profileIsDemo ? '当前仍是示例求职档案，请先填写真实档案并重新生成材料。' : !caps.smtp ? '邮箱发送服务尚未连接，可先完成材料准备与审核。' : !caps.outboundEnabled ? '真实邮件发送尚未开启，可先完成材料准备与审核。' : activeIds ? '已有批量发送任务正在处理，请查看下方进度。' : '只有使用当前档案审核通过的真实申请可以批量发送。';
  function openDocuments(item) { sessionStorage.setItem('jobpilot:documentJob', item.jobId); navigate('documents'); }
  function toggleSelection(id) {
    if (!selected.includes(id) && selectedItems.length >= 30) { notify('每批最多选择 30 个机会，请先处理当前选择。', 'error'); return; }
    setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  }
  function toggleAll() {
    if (allVisibleSelected) setSelected(previous => previous.filter(id => !visibleEligible.some(item => item.id === id)));
    else setSelected(previous => [...new Set([...previous, ...visibleEligible.map(item => item.id)])].slice(0, 30));
  }
  function openBatchReview(mode) {
    setBatchError('');
    setBatchReview({mode, profileRevision:revision, items:(mode === 'send' ? selectedSendable : selectedItems).map(item => ({...item}))});
  }
  async function completeBatchReview(records) {
    const changed = batchReview.profileRevision !== revision || records.some(item => {
      const current = applications.find(record => record.id === item.id);
      return !current || current.updatedAt !== item.updatedAt || (batchReview.mode === 'send' && !sendable(current));
    });
    if (changed) { setBatchError('所选记录已发生变化，请返回并重新打开审核，核对最新内容。'); return; }
    setBusy('batch');
    try {
      if (batchReview.mode === 'send') {
        const task = await mutate('/batches/send', {applicationIds:records.map(item => item.id), confirmed:true, profileRevision:batchReview.profileRevision, reviews:records.map(item => ({id:item.id, reviewToken:item.reviewToken}))});
        setTaskUpdates(previous => ({...previous, [task.id]:task}));
        notify('已创建发送任务，请在任务进度中查看逐封结果。');
      } else {
        await mutate('/batches/review', {applicationIds:records.map(item => item.id), reviews:records.map(item => ({id:item.id, updatedAt:item.updatedAt, reviewToken:item.reviewToken})), profileRevision:batchReview.profileRevision, confirmed:true});
        notify(`已审核 ${records.length} 封邮件，等待你确认发送。`);
      }
      setBatchReview(null);
    } catch (error) { setBatchError(`${error.message} 请返回检查后重新审核。`); }
    finally { setBusy(''); }
  }
  async function cancelTask(id) {
    setBusy(`cancel:${id}`);
    try {
      const result = await mutate(`/batches/${id}/cancel`, {});
      setTaskUpdates(previous => ({...previous, [id]:result}));
      notify('已请求取消；正在发送的邮件可能完成，尚未开始的邮件将停止处理。');
    } catch {} finally { setBusy(''); }
  }
  async function save(status) {
    setBusy('save');
    try {
      const original = applications.find(item => item.id === editing.id), nextStatus = status || editing.status;
      const result = await mutate(`/applications/${editing.id}`, {profileRevision:editing.reviewSnapshotRevision, reviewToken:editing.reviewToken, subject:editing.subject, body:editing.body, to:editing.to, ...((editing.materialId || null) !== (original?.materialId || null) ? {materialId:editing.materialId || null} : {}), ...(nextStatus !== original?.status || status === 'queued' ? {status:nextStatus} : {})}, 'PATCH');
      setEditing({...result});
      notify(status === 'queued' ? '已标记人工审核通过，等待发送。' : '投递记录已保存');
    } catch {} finally { setBusy(''); }
  }
  async function send() {
    setBusy('send');
    try {
      const original = applications.find(item => item.id === editing.id);
      const saved = await mutate(`/applications/${editing.id}`, {profileRevision:editing.reviewSnapshotRevision, reviewToken:editing.reviewToken, subject:editing.subject, body:editing.body, to:editing.to, ...((editing.materialId || null) !== (original?.materialId || null) ? {materialId:editing.materialId || null} : {})}, 'PATCH');
      setEditing({...saved});
      const result = await mutate(`/applications/${editing.id}/send`, {confirmed:true, profileRevision:saved.reviewSnapshotRevision, reviewToken:saved.reviewToken});
      setEditing({...result}); setConfirm(false); notify('投递邮件已发送');
    } catch {} finally { setBusy(''); }
  }
  async function regenerate() {
    setBusy('regenerate');
    try { const result = await mutate(`/applications/${editing.id}/regenerate`, {}); setEditing({...result}); notify('已按最新档案重写草稿，请重新核对收件人与内容。'); }
    catch {} finally { setBusy(''); }
  }
  const card = item => <div className={`apps-selectable-record ${view === 'board' ? 'compact' : ''} ${selected.includes(item.id) ? 'is-selected' : ''}`} key={item.id}>
    <label className="apps-record-select"><input type="checkbox" checked={selected.includes(item.id)} disabled={!canSelect(item) || Boolean(busy)} aria-label={`选择 ${item.company} ${item.jobTitle}`} onChange={() => toggleSelection(item.id)}/></label>
    <button type="button" className={`apps-record ${view === 'board' ? 'compact' : ''}`} onClick={() => setEditing({...item, reviewSnapshotRevision:revision})}><CompanyMark job={jobFor(item) || {company:item.company}}/><span className="apps-record-name"><strong>{item.jobTitle}</strong><span>{item.company}{item.isDemo ? ' · 示例' : ''}</span><small>{item.sendState === 'pending' ? '发送处理中，请勿重复发送' : item.sendState === 'uncertain' ? '发送结果待核对，请检查邮箱' : !item.to ? '官网手动提交' : item.materialId ? '已附岗位定制简历' : '使用原始简历 / 档案文本'}</small></span><span className="apps-record-status"><Badge tone={tone(item.status)}>{stages[item.status] || item.status}</Badge></span><span className="apps-record-time">{formatDate(item.updatedAt || item.createdAt)}</span><ArrowUpRight size={17}/></button>
  </div>;

  return <>
    <PageHeading title="每一次投递，都有迹可循。" subtitle="为每个岗位准备专属材料，逐封审核后，再批量发送与跟进。"><Button variant="secondary" onClick={() => navigate('discover')}>发现更多岗位 <ArrowUpRight size={16}/></Button></PageHeading>
    <div className="wf-stats apps-stats">{[['进行中的机会', applications.filter(a => !['draft','rejected'].includes(a.status)).length], ['等待完善', applications.filter(a => a.status === 'draft').length], ['面试与笔试', applications.filter(a => ['assessment','interview'].includes(a.status)).length], ['收到 Offer', applications.filter(a => a.status === 'offer').length]].map(([label,value]) => <div className="panel wf-stat" key={label}><span>{label}</span><strong>{value}<small> 个</small></strong></div>)}</div>
    <section className="panel apps-workspace">
      <div className="wf-toolbar"><div className="wf-filter"><label htmlFor="application-status">投递进度</label><select id="application-status" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态 · {applications.length}</option>{Object.entries(stages).map(([id,label]) => <option key={id} value={id}>{label} · {applications.filter(a => a.status === id).length}</option>)}</select></div><div className="wf-segment" aria-label="投递视图"><button className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16}/>列表</button><button className={view === 'board' ? 'active' : ''} aria-pressed={view === 'board'} onClick={() => setView('board')}><Columns3 size={16}/>看板</button></div></div>
      <div className="batch-selection-bar"><div className="batch-selection-info"><label><input type="checkbox" aria-label="全选当前筛选下可处理的投递" checked={allVisibleSelected} disabled={!visibleEligible.length || Boolean(busy)} onChange={toggleAll}/><span>全选可处理项</span></label><span>{selectedItems.length ? `已选 ${selectedItems.length} / 30` : '每批最多 30 个机会'}</span>{selectedItems.length > 0 && <button className="batch-clear" onClick={() => setSelected([])} aria-label="清空投递选择"><X size={13}/>清空</button>}</div><div className="batch-selection-actions"><Button variant="secondary" disabled={!selectedItems.length || Boolean(busy)} onClick={() => openBatchReview('review')}><ShieldCheck size={16}/>审核所选{selectedItems.length ? `（${selectedItems.length}）` : ''}</Button><Button disabled={!canBatchSend || Boolean(busy)} onClick={() => openBatchReview('send')}><Send size={16}/>发送已审核{selectedSendable.length ? `（${selectedSendable.length}）` : ''}</Button></div></div>
      {selectedItems.length > 0 && <div className="batch-selection-hint">{selectedItems.some(item => !item.to) ? '未公开邮箱的岗位需在官网手动提交；其余邮件可逐封审核。' : '审核时将展示所选邮件的完整内容与附件。'}{!canBatchSend && <span>{sendBlockReason}</span>}</div>}
      {!items.length ? <EmptyState icon={FileText} title="给下一站写一封好信" description={filter === 'all' ? '在发现岗位中选择一个或多个机会，为它们准备专属投递材料。' : '这个阶段暂时没有投递记录。'}><Button onClick={() => filter === 'all' ? navigate('discover') : setFilter('all')}>{filter === 'all' ? '去发现岗位' : '查看全部记录'}</Button></EmptyState> : view === 'list' ? <div className="apps-list"><div className="apps-list-head batch-list-head"><span>岗位 / 公司</span><span>当前状态</span><span>最近更新</span></div>{items.map(card)}</div> : <div className="apps-board">{Object.entries(stages).filter(([id]) => filter === 'all' || filter === id).map(([id,label]) => <div className="apps-column" key={id}><h3><span>{label}</span><span>{items.filter(item => item.status === id).length}</span></h3>{items.filter(item => item.status === id).map(card)}{!items.some(item => item.status === id) && <p className="apps-column-empty">暂无记录</p>}</div>)}</div>}
    </section>
    {batches.length > 0 && <section className="panel batch-task-panel"><div className="batch-task-panel-heading"><h2>批量任务记录</h2><span>每日发送限额 {data.settings?.dailyLimit || 5} 封</span></div>{pollError && <p className="batch-error" role="status">{pollError}</p>}{batches.slice(0, 5).map(batch => {
      const taskItems = batch.items || [], sent = taskItems.filter(item => item.status === 'sent').length;
      const complete = taskItems.filter(item => !['pending','sending'].includes(item.status)).length;
      const failed = taskItems.filter(item => ['failed','skipped'].includes(item.status)).length;
      return <div className="batch-task" key={batch.id}><div className="batch-task-heading"><div><h3>{activeTask(batch) && <Loader2 size={15} className="spin"/>}{taskStages[batch.status] || batch.status}<span>{formatDate(batch.createdAt)}</span></h3><p>已发送 {sent} / {taskItems.length} 封{failed > 0 ? ` · ${failed} 封未发送，请查看原因` : ''}{batch.status === 'cancelled' ? ' · 已保留完成结果' : ''}</p></div>{activeTask(batch) && <Button variant="secondary" busy={busy === `cancel:${batch.id}`} disabled={Boolean(busy)} onClick={() => cancelTask(batch.id)}><Square size={13}/>取消剩余任务</Button>}</div><progress max={Math.max(taskItems.length, 1)} value={complete} aria-label={`任务处理进度 ${complete} / ${taskItems.length}`}/><details className="batch-task-details" open={activeTask(batch) || failed > 0 || ['cancelled','interrupted'].includes(batch.status)}><summary>逐封处理结果 · {complete} / {taskItems.length} 已处理</summary><ul>{taskItems.map((item,index) => {
        const application = applications.find(record => record.id === item.applicationId);
        return <li key={`${item.applicationId}-${index}`}><div><strong>{application?.company || item.company || '投递记录'} · {application?.jobTitle || item.jobTitle || item.applicationId}</strong>{(item.error || item.reason) && <p>{item.error || item.reason}</p>}</div><Badge tone={item.status === 'sent' ? 'green' : ['failed','skipped'].includes(item.status) ? 'amber' : 'gray'}>{itemStages[item.status] || item.status}</Badge></li>;
      })}</ul></details></div>;
    })}</section>}
    <div className="wf-note"><ShieldCheck size={17}/><span>批量发送仅处理当前档案下已审核的真实申请，并遵守每日限额。需官网投递的岗位请手动提交；发送结果不确定的邮件不会重复发送。</span></div>
    {editing && !confirm && <Modal wide title="投递详情与求职信" onClose={() => { if (!busy) { setEditing(null); setConfirm(false); } }}><div className="apps-editor-header"><div><h3>{editing.jobTitle}</h3><p>{editing.company}</p></div><Badge tone={editing.isDemo ? 'amber' : 'green'}>{editing.isDemo ? '虚构示例 · 不会真实发送' : stages[editing.status]}</Badge></div>
      <div className="apps-material-bar"><div><FileText size={18}/><span>{attachmentFor(editing)}</span></div><Button variant="secondary" onClick={() => openDocuments(editing)}>查看专属材料<ArrowUpRight size={14}/></Button></div>
      {!editing.to && <div className="batch-manual-note"><span>此岗位没有公开招聘邮箱，请前往官网手动提交材料。</span><SourceLink url={jobFor(editing)?.sourceUrl}>前往官方申请页</SourceLink></div>}
      <div className="wf-form-row"><Field label="收件人"><input readOnly={locked} type="email" value={editing.to || ''} onChange={event => setEditing({...editing, to:event.target.value})} placeholder="招聘方公开的联系邮箱"/></Field><Field label="跟进状态"><select disabled={['pending','uncertain'].includes(editing.sendState)} value={editing.status} onChange={event => setEditing({...editing, status:event.target.value})}>{Object.entries(stages).map(([id,label]) => <option disabled={['sent','replied'].includes(id) || (Boolean(editing.sentAt) && ['draft','queued'].includes(id))} key={id} value={id}>{label}</option>)}</select></Field></div>
      <Field label="简历附件" hint="选择与此岗位对应、基于当前档案生成的简历；改变附件后需要重新审核。"><select disabled={locked} value={editing.materialId || ''} onChange={event => setEditing({...editing, materialId:event.target.value || null})}><option value="">{data.profile.resumeFile?.name ? `原始简历 · ${data.profile.resumeFile.name}` : '当前档案的简历文本（TXT）'}</option>{editing.materialId && !availableMaterials.some(material => material.id === editing.materialId) && <option value={editing.materialId} disabled>原定制简历已过期，请重新生成或更换</option>}{availableMaterials.map(material => <option key={material.id} value={material.id}>岗位定制简历 · {material.title} · {formatDate(material.createdAt)}</option>)}</select></Field>
      <Field label="邮件主题"><input readOnly={locked} value={editing.subject || ''} onChange={event => setEditing({...editing, subject:event.target.value})}/></Field><Field label="求职信正文" hint="请核对所有经历、收件人与附件，确保内容真实且适合此岗位。"><textarea readOnly={locked} rows={11} value={editing.body || ''} onChange={event => setEditing({...editing, body:event.target.value})}/></Field>
      {!canSend && <div className="wf-callout">{editing.isDemo ? '这是一份示例投递，可编辑与体验流程，但不会发送真实邮件。' : editing.sentAt ? '这封投递已发送，不能重复发送。' : editing.sendState ? '此邮件已有发送记录，请先在邮箱中核对发送结果。' : editing.profileWasDemo ? '这封草稿来自示例档案，请填写真实档案后重新生成。' : sendBlockReason}</div>}
      <div className="wf-modal-actions">{!locked && <Button variant="secondary" busy={busy === 'regenerate'} disabled={Boolean(busy)} onClick={regenerate}><RefreshCw size={16}/>按最新档案重写</Button>}<Button variant="secondary" busy={busy === 'save'} disabled={Boolean(busy) || ['pending','uncertain'].includes(editing.sendState)} onClick={() => save()}>保存修改</Button>{!locked && <Button variant="secondary" disabled={Boolean(busy) || !hasEmail(editing) || !editing.subject?.trim() || !editing.body?.trim()} onClick={() => save('queued')}><Check size={16}/>已审核，加入待发送</Button>}<Button disabled={!canSend || Boolean(busy) || !hasEmail(editing) || !editing.subject || !editing.body} onClick={() => setConfirm(true)}><Send size={16}/>发送投递</Button></div>
      {!!editing.events?.length && <div className="apps-history"><h4>跟进记录</h4>{editing.events.map((event,index) => <div key={`${event.at}-${index}`}><span className="wf-timeline-dot"/><span>{event.text}</span><time>{formatDate(event.at)}</time></div>)}</div>}
    </Modal>}
    {confirm && editing && <Modal title="确认发送这封投递？" onClose={() => !busy && setConfirm(false)}><div className="wf-send-review"><p>收件人：<strong>{editing.to}</strong></p><p>主题：<strong>{editing.subject}</strong></p><p>简历附件：<strong>{attachmentFor(editing)}</strong></p><pre>{editing.body}</pre><p className="muted">点击下方按钮后，将通过你的邮箱实际发送。</p></div><div className="wf-modal-actions"><Button variant="secondary" disabled={Boolean(busy)} onClick={() => setConfirm(false)}>继续检查</Button><Button busy={busy === 'send'} disabled={!canSend} onClick={send}><Send size={16}/>确认发送</Button></div></Modal>}
    {batchReview && <BatchReview key={`${batchReview.mode}-${batchReview.items.map(item => item.id).join('-')}`} items={batchReview.items} mode={batchReview.mode} attachmentFor={attachmentFor} jobFor={jobFor} reviewable={batchReview.mode === 'send' ? sendable : canReview} busy={busy === 'batch'} error={batchError} onClose={() => setBatchReview(null)} onConfirm={completeBatchReview}/>}
  </>;
}
