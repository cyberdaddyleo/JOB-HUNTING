import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { matchJob } from './matching.js';
import { createService, find, log, now } from './service.js';
import { HttpError, fail, string, boolean, validEmail, capabilities, mergeJobs, validateProfile, validateSettings, invalidateProfileReview, demoProfile, containsDemoText } from './safety.js';
import { saveResume, deleteResume } from './resume.js';
import { createBatchService, applicationFingerprint } from './batches.js';
import { renderDocument } from './documents.js';
import { validatePageSource } from './page-source.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const applicationSnapshot = (state, application) => ({ ...application, reviewToken: applicationFingerprint(application), reviewSnapshotRevision: state.profileRevision || 0 });
export async function createApp(options = {}) {
  const env = options.env || process.env;
  const dataDir = options.dataDir || env.DATA_DIR || path.join(root, 'data');
  const store = options.store || await createStore(dataDir);
  const applicationView = id => { const state = store.read(); return applicationSnapshot(state, find(state.applications, id, '申请')); };
  const service = createService(store, { ...options, env, dataDir });
  const batches = createBatchService(store, service, { intervalMs: options.batchIntervalMs ?? 2000 });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    try {
      const host = new URL(`http://${req.headers.host || ''}`);
      if (!localHosts.has(host.hostname)) fail('仅允许本机访问', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site' && !(req.method === 'GET' && !req.path.startsWith('/api') && req.headers['sec-fetch-mode'] === 'navigate')) fail('已拒绝跨站请求', 403);
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        const sameOrigin = origin.protocol === 'http:' && origin.host === host.host;
        const devOrigin = origin.protocol === 'http:' && localHosts.has(origin.hostname) && origin.port === '5173';
        if (!sameOrigin && !devOrigin) fail('不允许该请求来源', 403);
      }
      next();
    } catch (error) { next(error instanceof HttpError ? error : new HttpError(403, '请求来源无效')); }
  });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/resume', express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (req.headers['content-length'] && Number(req.headers['content-length']) > 0 && !req.is('application/json')) return next(new HttpError(415, '请使用 application/json 请求'));
      if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body))) return next(new HttpError(400, '请求正文需要 JSON 对象'));
      req.body ||= {};
    }
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/bootstrap', (_req, res) => {
    const state = store.read();
    const { profile, applications, messages, sources, settings, logs } = state;
    res.json({ profile, profileRevision: state.profileRevision || 0, profileIsDemo: demoProfile(profile), materials: state.materials || [], batches: state.batches || [], jobs: state.jobs.map(job => ({ ...job, match: matchJob(profile, job) })), applications: applications.map(item => applicationSnapshot(state, item)), messages, sources, settings, logs, capabilities: capabilities(env) });
  });
  app.put('/api/profile', async (req, res) => {
    const profile = validateProfile(req.body);
    const result = await store.update(state => { state.profile = { ...profile, ...(state.profile.resumeFile ? { resumeFile: state.profile.resumeFile } : {}) }; invalidateProfileReview(state, '求职档案已更新'); log(state, '更新求职档案', '档案已保存，匹配评分会按新信息重新计算；已有队列需要重新审核', 'success'); return state.profile; });
    res.json(result);
  });
  app.put('/api/resume', async (req, res) => res.json(await saveResume(store, dataDir, req.body)));
  app.delete('/api/resume', async (_req, res) => res.json(await deleteResume(store, dataDir)));
  app.post('/api/jobs/:id/save', async (req, res) => {
    const saved = boolean(req.body.saved, 'saved');
    const result = await store.update(state => { const job = find(state.jobs, req.params.id, '岗位'); job.saved = saved; return { ...job, match: matchJob(state.profile, job) }; });
    res.json(result);
  });
  app.post('/api/jobs/import', async (req, res) => {
    const result = await store.update(state => { const result = mergeJobs(state.jobs, req.body.jobs); log(state, '导入岗位', `新增${result.added}条，跳过${result.skipped}条重复岗位`, 'success'); return result; });
    res.json(result);
  });
  app.post('/api/sources', async (req, res) => {
    const source = await validatePageSource(req.body, options.pageSourceOptions);
    res.status(201).json(await store.update(state => {
      if (state.sources.length >= 50) fail('来源数量已达到50个，请停用不需要的来源并整理配置');
      if (state.sources.some(item => item.homepage === source.homepage)) fail('此目录已在来源列表中，请直接启用同步');
      state.sources.unshift(source);
      log(state, '添加公开招聘来源', `${source.name} · ${source.category}`, 'success');
      return source;
    }));
  });
  app.put('/api/sources/:id', async (req, res) => {
    const result = await store.update(state => {
      const source = find(state.sources, req.params.id, '来源');
      if (source.canSync === false && req.body.enabled === true) fail('此来源仅提供官方入口，不能启用自动抓取');
      if ('enabled' in req.body) source.enabled = boolean(req.body.enabled, 'enabled');
      if ('board' in req.body) {
        if (source.type !== 'greenhouse') fail('仅 Greenhouse 来源使用 board token');
        const board = string(req.body.board, 'board', 80);
        if (board && !/^[a-zA-Z0-9_-]+$/.test(board)) fail('board token 仅支持字母、数字、下划线和连字符');
        if (source.board !== board) { source.lastSync = undefined; source.lastAttemptAt = undefined; source.count = 0; source.status = '配置已更新，等待同步'; }
        source.board = board;
      }
      return source;
    });
    res.json(result);
  });
  app.post('/api/sources/:id/sync', async (req, res) => res.json(await service.syncSource(req.params.id)));
  app.post('/api/materials', async (req, res) => res.json(await service.createMaterial(string(req.body.jobId, 'jobId', 100, true))));
  app.get('/api/materials/:id/download', async (req, res) => {
    const material = find(store.read().materials || [], req.params.id, '求职文件');
    const kind = req.query.kind || 'resume', format = req.query.format || 'docx';
    if (!['resume', 'cover-letter', 'checklist'].includes(kind) || !['docx', 'md', 'html'].includes(format)) fail('文件类型或格式无效');
    const file = await renderDocument(material, kind, format);
    res.set('Content-Type', file.mime);
    res.set('Content-Disposition', `attachment; filename="job-material.${format}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.send(file.buffer);
  });
  app.post('/api/batches/prepare', async (req, res) => res.json(await batches.prepare(req.body.jobIds)));
  app.post('/api/batches/review', async (req, res) => res.json(await batches.review(req.body)));
  app.post('/api/batches/send', async (req, res) => res.status(202).json(await batches.start(req.body)));
  app.get('/api/batches/:id', (req, res) => res.json(batches.get(req.params.id)));
  app.post('/api/batches/:id/cancel', async (req, res) => res.json(await batches.cancel(req.params.id)));
  app.post('/api/applications', async (req, res) => { const application = await service.createApplication(string(req.body.jobId, 'jobId', 100, true)); res.json(applicationView(application.id)); });
  app.post('/api/applications/:id/regenerate', async (req, res) => { await service.regenerateApplication(req.params.id); res.json(applicationView(req.params.id)); });
  app.patch('/api/applications/:id', async (req, res) => {
    const result = await store.update(state => {
      const application = find(state.applications, req.params.id, '申请');
      // Compare the record the user actually saw before applying their intentional edits.
      // Queue approval always requires this snapshot; the editor also supplies it for ordinary saves.
      if (req.body.status === 'queued' || 'profileRevision' in req.body || 'reviewToken' in req.body) {
        if (req.body.profileRevision !== (state.profileRevision || 0) || req.body.reviewToken !== applicationFingerprint(application)) fail('档案、正文或附件已变化，请关闭并重新打开详情核对', 409);
      }
      const contentChanged = ['subject', 'body', 'to', 'materialId'].some(key => key in req.body && req.body[key] !== application[key]);
      if (contentChanged && (application.sentAt || application.sendState)) fail('已发送或待核对的申请不能改写发送内容', 409);
      if ('subject' in req.body) { application.subject = string(req.body.subject, '主题', 500, true); if (/[\r\n]/.test(application.subject)) fail('主题不能包含换行'); }
      if ('body' in req.body) {
        const nextBody = string(req.body.body, '邮件正文', 40000, true);
        const rewritten = nextBody !== application.body;
        application.body = nextBody;
        // Provenance survives ordinary edits; only explicit regeneration replaces demo-derived facts.
        application.profileWasDemo = application.profileWasDemo || demoProfile(state.profile) || containsDemoText(application.body) || containsDemoText(application.subject);
        if (rewritten) application.profileRevision = state.profileRevision || 0;
      }
      if ('to' in req.body) { application.to = string(req.body.to, '收件邮箱', 254); if (application.to && !validEmail(application.to)) fail('收件邮箱格式无效'); }
      if ('materialId' in req.body) {
        const materialId = string(req.body.materialId, '求职文件 ID', 100);
        if (materialId) {
          const material = find(state.materials || [], materialId, '求职文件');
          if (material.jobId !== application.jobId || material.profileRevision !== (state.profileRevision || 0)) fail('请选择当前岗位和最新档案生成的求职文件', 409);
        }
        application.materialId = materialId || null;
      }
      if (contentChanged && application.status === 'queued') { application.status = 'draft'; delete application.reviewedAt; delete application.reviewedProfileRevision; }
      if ('status' in req.body) {
        if (!['draft', 'queued', 'assessment', 'interview', 'offer', 'rejected'].includes(req.body.status)) fail('该状态不能手动设置；sent 仅在SMTP成功后写入');
        if (['pending', 'uncertain'].includes(application.sendState)) fail('存在待核对的发送记录，暂不能更改状态', 409);
        if (application.sentAt && ['draft', 'queued'].includes(req.body.status)) fail('已发送申请不能重新进入发送队列', 409);
        if (req.body.status === 'queued') {
          if (!validEmail(application.to) || !application.subject || !application.body) fail('加入队列前请核对并填写收件邮箱、主题和正文');
          if (application.sendState) fail('存在发送记录，请先核对邮箱', 409);
          application.reviewedAt = now();
          application.reviewedProfileRevision = state.profileRevision || 0;
        } else { delete application.reviewedAt; delete application.reviewedProfileRevision; }
        application.status = req.body.status;
        application.events.push({ at: now(), text: req.body.status === 'queued' ? '用户已审核收件人与正文，加入自动投递队列' : `用户手动更新状态为 ${req.body.status}` });
      }
      application.updatedAt = now();
      return applicationSnapshot(state, application);
    });
    res.json(result);
  });
  app.post('/api/applications/:id/send', async (req, res) => {
    await service.sendApplication(req.params.id, req.body.confirmed, false, undefined, { profileRevision: req.body.profileRevision, reviewToken: req.body.reviewToken });
    res.json(applicationView(req.params.id));
  });
  app.post('/api/mail/sync', async (_req, res) => res.json(await service.syncMail()));
  app.post('/api/messages/:id/draft', async (req, res) => res.json(await service.makeReply(req.params.id)));
  app.patch('/api/messages/:id', async (req, res) => {
    const result = await store.update(state => {
      const message = find(state.messages, req.params.id, '邮件');
      if ('read' in req.body) message.read = boolean(req.body.read, 'read');
      if ('replyDraft' in req.body) { if (message.replySentAt || message.sendState) fail('已发送或待核对的回复不能修改', 409); message.replyDraft = string(req.body.replyDraft, '回复草稿', 40000); message.replyProfileRevision = state.profileRevision || 0; }
      return message;
    });
    res.json(result);
  });
  app.post('/api/messages/:id/send', async (req, res) => res.json(await service.sendReply(req.params.id, req.body.confirmed)));
  app.post('/api/coach', async (req, res) => {
    if (!['interview', 'assessment'].includes(req.body.stage)) fail('stage 需要 interview 或 assessment');
    res.json(await service.coach(string(req.body.jobId, 'jobId', 100, true), req.body.stage, string(req.body.context, '上下文', 10000)));
  });
  app.put('/api/settings', async (req, res) => {
    const patch = validateSettings(req.body);
    res.json(await store.update(state => { state.settings = { ...state.settings, ...patch }; log(state, '更新自动化设置', '设置已保存；自动投递只发送已人工审核队列，自动回复仅固定收件确认。', 'success'); return state.settings; }));
  });
  app.get('/api/export', (_req, res) => { const { resumeAsset, ...state } = store.read(); res.set('Content-Disposition', 'attachment; filename="jobpilot-export.json"'); res.json({ ...state, exportedAt: now() }); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API不存在' }));
  if (existsSync(path.join(root, 'dist', 'index.html'))) {
    app.use((_req, res, next) => { res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"); next(); });
    app.use(express.static(path.join(root, 'dist')));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    const message = error instanceof HttpError ? error.message : status === 413 ? '请求内容超过大小限制' : status === 400 ? '请求 JSON 格式无效' : '操作失败，请检查本地服务状态；错误详情不会暴露凭据';
    res.status(status).json({ error: message });
  });
  return { app, store, service, batches };
}
