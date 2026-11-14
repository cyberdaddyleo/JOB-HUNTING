import { randomUUID } from 'node:crypto';
import { matchJob } from './matching.js';
import { assertSendAllowed, capabilities, fail, mergeJobs, validEmail, isAllowedSender, demoProfile, containsDemoText, expiredJob } from './safety.js';
import { buildApplicationDraft, acknowledgement, draftReply, coachResponse } from './ai.js';
import { fetchSourceJobs } from './connectors.js';
import { sendSmtp, readImap, classifyMessage } from './mail.js';
import { readResume } from './resume.js';
import { generateMaterials, renderDocument } from './documents.js';
import { applicationFingerprint } from './batches.js';

export const now = () => new Date().toISOString();
export function log(state, action, detail, status = 'info') {
  state.logs.unshift({ id: randomUUID(), at: now(), action, detail, status });
  state.logs = state.logs.slice(0, 300);
}
export function find(items, id, label = '记录') { return items.find(item => item.id === id) || fail(`${label}不存在`, 404); }
const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(date));

export function createService(store, { env = process.env, dataDir, fetchImpl = fetch, getAIEnv = () => env, sendMail = mail => sendSmtp(mail, env), readMail = () => readImap(env) } = {}) {
  const locks = new Map();
  let automationRunning = false;
  const exclusive = (key, work) => {
    if (locks.has(key)) return locks.get(key);
    const pending = Promise.resolve().then(work).finally(() => locks.delete(key));
    locks.set(key, pending);
    return pending;
  };
  const service = {
    async createMaterial(jobId, { regenerate = false } = {}) {
      return exclusive(`material:${jobId}`, async () => {
        const snapshot = store.read();
        const job = find(snapshot.jobs, jobId, '岗位');
        const current = snapshot.materials?.find(m => m.jobId === jobId && m.profileRevision === (snapshot.profileRevision || 0));
        if (current && !regenerate) return current;
        const material = await generateMaterials(snapshot.profile, job, { env: getAIEnv(), fetchImpl, profileRevision: snapshot.profileRevision || 0 });
        return store.update(state => {
          if ((state.profileRevision || 0) !== (snapshot.profileRevision || 0)) fail('档案已更新，请重新生成文件', 409);
          state.materials ||= [];
          if (state.materials.length >= 100) fail('已保存100套求职文件，请先导出工作区并整理文件');
          material.id ||= randomUUID(); material.profileWasDemo = demoProfile(snapshot.profile);
          state.materials.unshift(material);
          log(state, '生成定制求职文件', `${job.company} · ${job.title}：简历、求职信、要求核对表`, 'success');
          return material;
        });
      });
    },
    async createApplication(jobId) {
      return exclusive(`draft:${jobId}`, async () => {
        const snapshot = store.read();
        const existing = snapshot.applications.find(application => application.jobId === jobId);
        if (existing) return existing;
        const job = find(snapshot.jobs, jobId, '岗位');
        if (expiredJob(job)) fail('该岗位已过已知报名截止日，请核实最新公告后再准备投递', 409);
        if (job.recordType === 'announcement') fail('这是一篇待核对的招聘公告，请先从官方职位表提取具体岗位并导入');
        const draft = await buildApplicationDraft(snapshot.profile, job, getAIEnv(), fetchImpl);
        return store.update(state => {
          if ((snapshot.profileRevision || 0) !== (state.profileRevision || 0)) fail('档案在生成过程中已更新，请重新生成草稿', 409);
          const duplicate = state.applications.find(application => application.jobId === jobId);
          if (duplicate) return duplicate;
          const at = now();
          const application = { id: randomUUID(), jobId, jobTitle: job.title, company: job.company, status: 'draft', subject: draft.subject, body: draft.body, to: job.contactEmail, createdAt: at, updatedAt: at, isDemo: job.isDemo, profileWasDemo: demoProfile(snapshot.profile), profileRevision: state.profileRevision || 0, draftMode: draft.mode, events: [{ at, text: `已生成${draft.mode === 'ai' ? 'AI' : '本地模板'}草稿，请核对真实经历与收件人` }] };
          state.applications.unshift(application);
          log(state, '生成投递草稿', `${job.company} · ${job.title}${job.isDemo ? '（虚构演示）' : ''}`, 'success');
          return application;
        });
      });
    },
    async regenerateApplication(id) {
      return exclusive(`regenerate:${id}`, async () => {
        const snapshot = store.read();
        const item = find(snapshot.applications, id, '申请');
        if (item.sentAt || item.sendState) fail('已发送或待核对的申请不能重新生成', 409);
        const draft = await buildApplicationDraft(snapshot.profile, find(snapshot.jobs, item.jobId, '岗位'), getAIEnv(), fetchImpl);
        return store.update(state => {
          const application = find(state.applications, id, '申请');
          if (application.sentAt || application.sendState || (snapshot.profileRevision || 0) !== (state.profileRevision || 0)) fail('申请或档案在生成过程中已更新，请重试', 409);
          application.subject = draft.subject; application.body = draft.body; application.draftMode = draft.mode;
          application.profileWasDemo = demoProfile(state.profile); application.profileRevision = state.profileRevision || 0;
          application.status = 'draft'; application.updatedAt = now();
          delete application.reviewedAt; delete application.reviewedProfileRevision;
          application.events.push({ at: now(), text: '根据最新档案重新生成草稿，请重新审核正文与当前附件' });
          return application;
        });
      });
    },
    async syncSource(id) {
      return exclusive(`source:${id}`, async () => {
        const source = find(store.read().sources, id, '来源');
        if (source.type === 'demo') return { added: 0, skipped: source.count, message: '这是本地虚构演示岗位，未请求招聘网站。' };
        if (!source.enabled) fail('请先启用此来源');
        if (source.canSync === false) fail('此网站需要在官方入口自行检索或报名，当前不支持自动同步');
        if (source.type === 'remotive' && source.lastAttemptAt && Date.now() - Date.parse(source.lastAttemptAt) < 6 * 3600000) fail('Remotive 每6小时最多请求一次（最多4次/日），请稍后同步；公开数据延迟24小时。', 429);
        if (source.minIntervalMinutes && source.lastAttemptAt && Date.now() - Date.parse(source.lastAttemptAt) < source.minIntervalMinutes * 60000) fail(`此来源每${source.minIntervalMinutes}分钟最多同步一次，请稍后再试`, 429);
        await store.update(state => { find(state.sources, id).lastAttemptAt = now(); });
        try {
          const jobs = await fetchSourceJobs(source, fetchImpl);
          return store.update(state => {
            const result = mergeJobs(state.jobs, jobs, { sourceId: source.id });
            const current = find(state.sources, id);
            current.lastSync = now(); current.status = `同步成功 · 新增${result.added}条${source.type === 'remotive' ? ' · 数据延迟24小时' : ''}`;
            current.count = state.jobs.filter(job => job.sourceId === source.id).length;
            log(state, '同步岗位', `${source.name}：新增${result.added}条，跳过${result.skipped}条重复岗位`, 'success');
            return { ...result, message: current.status };
          });
        } catch (error) {
          await store.update(state => { find(state.sources, id).status = '同步失败，请检查来源配置与网络'; log(state, '同步岗位失败', `${source.name}同步失败；未更改已有岗位。`, 'error'); });
          throw error;
        }
      });
    },
    async syncMail() {
      return exclusive('mail-sync', async () => {
        if (!capabilities(env).imap) fail('IMAP 尚未配置，请在本地 .env 设置邮箱参数', 503);
        const incoming = await readMail();
        return store.update(state => {
          const seen = new Set(state.mailSeen || []);
          let added = 0;
          for (const item of incoming.slice(0, 100)) {
            if (!item.messageId || seen.has(item.messageId) || !validEmail(item.from)) continue;
            const fromApplications = state.applications.filter(a => !a.isDemo && a.sentAt && a.to.toLowerCase() === item.from.toLowerCase());
            const exactThread = item.inReplyTo ? fromApplications.find(a => a.messageId === item.inReplyTo) : undefined;
            const application = exactThread || (fromApplications.length === 1 ? fromApplications[0] : undefined);
            const kind = classifyMessage(item.subject, item.body);
            const message = { id: randomUUID(), ...(application ? { applicationId: application.id } : {}), company: application?.company || item.from.split('@')[1], from: item.from, subject: item.subject, body: item.body, receivedAt: item.receivedAt, kind, read: false, replyDraft: '', isDemo: false, sourceMessageId: item.messageId, automated: item.automated === true };
            state.messages.unshift(message); seen.add(item.messageId); added++;
            if (application && application.sentAt) {
              if (application.status === 'sent') application.status = 'replied';
              application.updatedAt = now();
              application.events.push({ at: now(), text: '收到该招聘邮箱来信；邮件分类为辅助识别，请人工确认具体环节' });
            }
          }
          state.mailSeen = [...seen].slice(-20000);
          log(state, '同步收件箱', `新增${added}封邮件。读取最近30天、最多100封且单封不超过1MB的邮件。`, 'success');
          return { added, message: `已同步${added}封新邮件；附件不执行、不保存，面试与测评分类需人工核实。` };
        });
      });
    },
    async sendApplication(id, confirmed, automatic = false, batchContext, confirmationContext) { return sendRecord('application', id, confirmed, automatic, batchContext, confirmationContext); },
    async sendReply(id, confirmed, automatic = false) { return sendRecord('reply', id, confirmed, automatic); },
    async makeReply(id) {
      const snapshot = store.read();
      const message = find(snapshot.messages, id, '邮件');
      const draft = await draftReply(message, snapshot.profile, getAIEnv(), fetchImpl);
      await store.update(state => { const message = find(state.messages, id); if (message.sendState || message.replySentAt) fail('回复已发送或正在发送', 409); message.replyDraft = draft.replyDraft; message.replyProfileRevision = snapshot.profileRevision || 0; });
      return draft;
    },
    async coach(jobId, stage, context) {
      const state = store.read();
      return coachResponse(state.profile, find(state.jobs, jobId, '岗位'), stage, context, getAIEnv(), fetchImpl);
    },
    async runAutomation() {
      if (automationRunning) return;
      automationRunning = true;
      try {
        let state = store.read();
        if (state.settings.autoSync) {
          for (const source of state.sources.filter(source => source.enabled && source.type !== 'demo' && source.canSync !== false)) {
            const interval = Math.max(state.settings.syncIntervalMinutes * 60000, (source.minIntervalMinutes || 5) * 60000, source.type === 'remotive' ? 6 * 3600000 : 0);
            if (!source.lastAttemptAt || Date.now() - Date.parse(source.lastAttemptAt) >= interval) await service.syncSource(source.id).catch(() => {});
          }
          state = store.read();
          if (capabilities(env).imap && (!state.lastMailAttemptAt || Date.now() - Date.parse(state.lastMailAttemptAt) >= state.settings.syncIntervalMinutes * 60000)) {
            await store.update(next => { next.lastMailAttemptAt = now(); });
            await service.syncMail().catch(async () => { await store.update(next => log(next, '自动同步邮件失败', '请检查IMAP配置和网络', 'error')); });
          }
        }
        state = store.read();
        if (state.settings.autoApply) {
          const candidates = state.jobs.filter(job => {
            const match = matchJob(state.profile, job);
            return !job.isDemo && !expiredJob(job) && job.recordType !== 'announcement' && match.eligibility === '符合' && match.score >= state.settings.minMatchScore && !state.applications.some(a => a.jobId === job.id);
          }).slice(0, 10);
          for (const job of candidates) await service.createApplication(job.id).catch(async () => store.update(next => log(next, '自动准备未完成', `${job.company} · ${job.title}，请人工检查岗位和档案`, 'error')));
          state = store.read();
          for (const application of state.applications.filter(a => !a.isDemo && a.status === 'queued' && a.reviewedAt && !a.sentAt && !a.sendState && isAllowedSender(a.to, state.settings.allowedSenders))) {
            if (!capabilities(env).smtp || !capabilities(env).outboundEnabled) break;
            await service.sendApplication(application.id, true, true).catch(() => {});
          }
        }
        state = store.read();
        if (state.settings.autoReply && capabilities(env).smtp && capabilities(env).outboundEnabled) {
          for (const message of state.messages.filter(m => !m.isDemo && !m.automated && !m.replySentAt && !m.sendState && Date.now() - Date.parse(m.receivedAt) < 7 * 86400000 && isAllowedSender(m.from, state.settings.allowedSenders) && ![env.SMTP_FROM, state.profile.email].filter(Boolean).some(email => email.toLowerCase() === m.from.toLowerCase()))) {
            await service.sendReply(message.id, true, true).catch(() => {});
          }
        }
      } finally { automationRunning = false; }
    },
  };

  async function sendRecord(kind, id, confirmed, automatic, batchContext, confirmationContext) {
    return exclusive(`send:${kind}:${id}`, async () => {
      let outgoing;
      const record = await store.update(async state => {
        const isReply = kind === 'reply';
        const item = find(isReply ? state.messages : state.applications, id, isReply ? '邮件' : '申请');
        if (confirmationContext && (confirmationContext.profileRevision !== (state.profileRevision || 0) || confirmationContext.reviewToken !== applicationFingerprint(item))) fail('档案、正文或附件已变化，请刷新并重新确认发送', 409);
        if (isReply ? item.replySentAt : item.sentAt) return { alreadySent: true, item };
        if (!isReply && expiredJob(find(state.jobs, item.jobId, '岗位'))) fail('该岗位已过报名截止日，已停止发送', 409);
        if (automatic && !state.settings[isReply ? 'autoReply' : 'autoApply']) fail('该自动发送功能已关闭，停止后续发送', 403);
        const subject = isReply ? `Re: ${item.subject}`.replace(/[\r\n]/g, ' ').slice(0, 500) : item.subject;
        const body = isReply ? (automatic ? acknowledgement(state.profile.name) : item.replyDraft) : item.body;
        const to = isReply ? item.from : item.to;
        const todayCount = (state.outboundLedger || []).filter(entry => (entry.automatic || entry.batchId) && day(entry.at) === day(Date.now())).length;
        if (batchContext) {
          const batch = find(state.batches, batchContext.batchId, '批量任务');
          if (batch.status !== 'running' || batch.cancelRequested) fail('批量任务已取消', 409);
          if (item.status !== 'queued' || !item.reviewedAt || item.reviewedProfileRevision !== (state.profileRevision || 0)) fail('申请未按当前档案审核，请重新审核后投递', 409);
          if (applicationFingerprint(item) !== batchContext.fingerprint) fail('审核内容在批量任务创建后已变化，本条跳过', 409);
          if (todayCount >= state.settings.dailyLimit) fail('已达到今日批量与自动发送上限', 429);
        }
        assertSendAllowed({ ...item, to, body, subject }, { env, confirmed, automatic, reply: isReply, settings: state.settings, sentToday: todayCount });
        if (!validEmail(state.profile.email) || !state.profile.name?.trim() || demoProfile(state.profile)) fail('请先将演示档案替换为真实姓名、邮箱与简历，再发送真实邮件', 403);
        if (!isReply && item.profileWasDemo) fail('这份草稿由演示档案生成，请先使用“按最新档案重写”，重新审核后再发送', 403);
        if (containsDemoText(body) || containsDemoText(subject)) fail('正文或主题仍含演示信息，请删除演示内容并重新审核后再发送', 403);
        const revision = state.profileRevision || 0;
        if (!isReply && (item.profileRevision || 0) !== revision && item.reviewedProfileRevision !== revision) fail('档案或简历已更新，请重新生成或编辑保存正文，再核对最新附件', 409);
        if (isReply && !automatic && (item.replyProfileRevision || 0) !== revision) fail('档案已更新，请重新生成或编辑保存回复草稿', 409);
        if (!isReply && !state.profile.resumeText?.trim() && !state.profile.resumeFile) fail('请先上传简历文件或补充简历正文');
        let attachment = null;
        if (!isReply && item.materialId) {
          const material = find(state.materials || [], item.materialId, '求职文件');
          if (material.jobId !== item.jobId || material.profileRevision !== revision) fail('定制求职文件与岗位或当前档案不一致，请重新生成并审核', 409);
          if (material.isDemo || material.profileWasDemo) fail('演示档案生成的求职文件不能发送', 403);
          const document = await renderDocument(material, 'resume', 'docx');
          attachment = { name: document.filename, content: document.buffer, mime: document.mime };
        } else if (!isReply) attachment = await readResume(state, dataDir);
        const messageId = `<jobpilot-${kind}-${id}@localhost>`;
        outgoing = { to, subject, body, messageId, ...(isReply ? { replyToId: item.sourceMessageId } : { resumeText: state.profile.resumeText, ...(attachment ? { attachment } : {}) }) };
        item.sendState = 'pending';
        state.outboundLedger ||= [];
        state.outboundLedger.push({ id: randomUUID(), recordId: id, kind, at: now(), automatic, ...(batchContext ? { batchId: batchContext.batchId } : {}), state: 'pending' });
        state.outboundLedger = state.outboundLedger.filter(entry => Date.now() - Date.parse(entry.at) < 90 * 86400000);
        return { alreadySent: false, item };
      });
      if (record.alreadySent) return record.item;
      try {
        const receipt = await sendMail(outgoing);
        return await store.update(state => {
          const isReply = kind === 'reply';
          const item = find(isReply ? state.messages : state.applications, id);
          item.sendState = 'sent'; item.messageId = receipt.messageId || outgoing.messageId;
          if (isReply) { item.replySentAt = now(); item.replyDraft = outgoing.body; item.read = true; }
          else { item.status = 'sent'; item.sentAt = now(); item.updatedAt = now(); item.events.push({ at: now(), text: automatic ? '已审核队列通过 SMTP 自动发送成功' : '已确认并通过 SMTP 发送成功' }); }
          const entry = state.outboundLedger.findLast(entry => entry.recordId === id && entry.kind === kind);
          if (entry) entry.state = 'sent';
          log(state, isReply ? '发送邮件回复' : '发送求职申请', `${automatic ? '自动 · ' : ''}${item.company} · SMTP已接受（不等于对方已阅读）`, 'success');
          return item;
        });
      } catch {
        await store.update(state => {
          const item = find(kind === 'reply' ? state.messages : state.applications, id);
          item.sendState = 'uncertain';
          const entry = state.outboundLedger.findLast(entry => entry.recordId === id && entry.kind === kind);
          if (entry) entry.state = 'uncertain';
          log(state, '邮件发送待核对', 'SMTP未返回可确认的成功结果。为防重复，已锁定此条发送；请先在发件邮箱核对。', 'error');
        });
        fail('发送未确认成功。为避免重复邮件，已锁定本条发送，请在发件邮箱核对。详情不包含账号或密码。', 502);
      }
    });
  }
  return service;
}
