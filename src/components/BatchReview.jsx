import React, {useState} from 'react';
import {Check, FileText, Send} from 'lucide-react';
import {Badge, Button, Modal, SourceLink} from './ui.jsx';

export default function BatchReview({items, mode='review', attachmentFor, jobFor, reviewable, busy, error, onClose, onConfirm}) {
  const [checked, setChecked] = useState([]);
  const eligible = items.filter(reviewable);
  const allChecked = eligible.length > 0 && eligible.every(item => checked.includes(item.id));
  const sending = mode === 'send';
  return <Modal wide title={sending ? '确认发送这一批投递' : '逐封审核本批投递'} onClose={() => !busy && onClose()}>
    <div className="batch-review-intro">
      <p>{sending ? `将通过你的邮箱发送 ${eligible.length} 封已审核邮件。请再次核对下方内容，逐封勾选后确认发送。` : `已选择 ${items.length} 个机会。请逐封核对收件人、全文与附件，再勾选确认；审核后不会立即发送。`}</p>
      <span>已核对 {eligible.filter(item => checked.includes(item.id)).length} / {eligible.length} 封</span>
    </div>
    <div className="batch-review-list">
      {items.map((item, index) => {
        const allowed = reviewable(item);
        const job = jobFor(item);
        return <article className="batch-review-item" key={item.id}>
          <div className="batch-review-heading"><span className="batch-review-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{item.jobTitle}</h3><p>{item.company}</p></div>{item.isDemo && <Badge tone="amber">示例</Badge>}</div>
          <dl className="batch-review-meta"><div><dt>收件人</dt><dd>{item.to || '未提供公开招聘邮箱'}</dd></div><div><dt>邮件主题</dt><dd>{item.subject || '尚未填写'}</dd></div><div><dt><FileText size={14}/>简历附件</dt><dd>{attachmentFor(item)}</dd></div></dl>
          <pre className="batch-review-body">{item.body || '尚未填写正文'}</pre>
          {!item.to && <div className="batch-manual-note"><span>此岗位需前往招聘官网手动提交，不能加入邮件队列。</span><SourceLink url={job?.sourceUrl}>前往官方申请页</SourceLink></div>}
          {allowed ? <label className="batch-review-check"><input type="checkbox" disabled={busy} checked={checked.includes(item.id)} onChange={event => setChecked(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/><span>我已核对这封邮件的收件人、完整正文与简历附件</span></label> : item.to && <p className="batch-item-warning">此记录当前不符合{sending ? '发送' : '审核'}条件，请返回详情补全或更新材料。</p>}
        </article>;
      })}
    </div>
    {error && <div className="batch-error" role="alert">{error}</div>}
    <div className="batch-review-footer"><p>{sending ? '实际发送结果以任务记录为准；每日限额内依次处理。' : '档案、正文或附件变化后，需要重新审核。'}</p><div className="wf-modal-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>返回检查</Button><Button busy={busy} disabled={!allChecked || Boolean(error)} onClick={() => onConfirm(eligible)}>{sending ? <Send size={16}/> : <Check size={16}/>} {sending ? `确认发送 ${eligible.length} 封` : `审核通过 ${eligible.length} 封，加入待发送`}</Button></div></div>
  </Modal>;
}
