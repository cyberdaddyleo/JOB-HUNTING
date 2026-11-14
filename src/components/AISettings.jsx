import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, FileText, KeyRound, Mail, MessageSquareText, PlugZap, RefreshCw, Save, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { api, useWorkspace } from '../store.jsx';
import { Badge, Button } from './ui.jsx';
import './ai-settings.css';

const emptyForm = { baseUrl: '', model: '', apiKey: '' };
const sourceLabels = { local: '已保存在本机', environment: '来自本机环境变量', none: '尚未配置' };

export default function AISettings() {
  const { notify, refresh } = useWorkspace();
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState('load');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setBusy('load');
    setError('');
    api('/ai-config', { signal: controller.signal }).then(next => {
      setConfig(next);
      setForm({ baseUrl: next.baseUrl || '', model: next.model || '', apiKey: '' });
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause.message);
    }).finally(() => {
      if (!controller.signal.aborted) setBusy('');
    });
    return () => controller.abort();
  }, [loadAttempt]);

  const dirty = Boolean(config && (form.baseUrl.trim() !== config.baseUrl || form.model.trim() !== config.model || form.apiKey.trim()));
  const addressChanged = Boolean(config?.hasApiKey && form.baseUrl.trim().replace(/\/+$/, '') !== config.baseUrl?.replace(/\/+$/, ''));
  const disabled = Boolean(busy) || !config;
  const update = (name, value) => {
    setForm(current => ({ ...current, [name]: value }));
    setError('');
    setMessage('');
    setTestResult(null);
    setConfirmClear(false);
  };
  const body = () => ({ baseUrl: form.baseUrl.trim(), model: form.model.trim(), ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) });

  const save = async event => {
    event.preventDefault();
    setBusy('save'); setError(''); setMessage(''); setConfirmClear(false);
    try {
      const next = await api('/ai-config', { method: 'PUT', body: body() });
      setConfig(next);
      setForm({ baseUrl: next.baseUrl, model: next.model, apiKey: '' });
      setShowKey(false);
      const savedMessage = next.configured ? 'AI 配置已保存，下一次生成立即使用，无需重启。' : '配置已保存。补齐 API Key 和模型名称后，即可启用 AI。';
      setMessage(savedMessage);
      notify(savedMessage);
      await refresh().catch(() => setError('配置已保存，连接状态暂未刷新，请刷新页面。'));
    } catch (cause) {
      setError(cause.message); notify(cause.message, 'error');
    } finally { setBusy(''); }
  };

  const test = async () => {
    setBusy('test'); setError(''); setMessage(''); setTestResult(null); setConfirmClear(false);
    try {
      const result = await api('/ai-config/test', { method: 'POST', body: body() });
      setTestResult(result);
      notify('AI 连接测试通过');
    } catch (cause) {
      setError(cause.message); notify(cause.message, 'error');
    } finally { setBusy(''); }
  };

  const clear = async () => {
    setBusy('clear'); setError(''); setMessage(''); setTestResult(null);
    try {
      const next = await api('/ai-config', { method: 'PUT', body: { baseUrl: config.baseUrl, model: config.model, clearApiKey: true } });
      setConfig(next);
      setForm({ baseUrl: next.baseUrl, model: next.model, apiKey: '' });
      setShowKey(false); setConfirmClear(false);
      setMessage('API Key 已清除。当前使用本地规则与模板，重新填写密钥后可启用 AI。');
      notify('API Key 已清除');
      await refresh().catch(() => setError('密钥已清除，连接状态暂未刷新，请刷新页面。'));
    } catch (cause) {
      setError(cause.message); notify(cause.message, 'error');
    } finally { setBusy(''); }
  };

  return <section className="panel ai-settings" aria-labelledby="ai-settings-title" aria-busy={Boolean(busy)}>
    <div className="ai-settings-heading">
      <div className="ai-settings-title"><span className="ai-settings-icon"><Sparkles size={24} /></span><div><p className="ai-settings-eyebrow">让 AI 帮你准备下一份机会</p><h2 id="ai-settings-title">AI 接口配置</h2></div></div>
      <div className="ai-settings-status"><Badge tone={config?.configured ? 'green' : 'gray'}>{busy === 'load' ? '正在读取配置' : config?.configured ? 'AI 已配置' : '本地模板模式'}</Badge>{config && <small>{sourceLabels[config.source] || '本机配置'}{dirty ? ' · 有未保存修改' : ''}</small>}</div>
    </div>
    <p className="ai-settings-intro">填好接口、密钥和模型，统一用于求职材料整理、邮件草稿与回复、笔试面试准备。</p>
    {config?.warning && <div className="ai-settings-feedback"><p className="ai-settings-error" role="alert">{config.warning}</p></div>}
    {config ? <form onSubmit={save}>
      <div className="ai-settings-fields">
        <div className="field ai-settings-field"><label htmlFor="ai-base-url">接口地址 <span>Base URL</span></label><input id="ai-base-url" type="url" value={form.baseUrl} onChange={event => update('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" maxLength={2048} disabled={disabled} autoCapitalize="none" spellCheck={false} required aria-describedby="ai-base-url-hint" /><small id="ai-base-url-hint">填写服务商提供的 OpenAI 兼容接口地址，不加 /chat/completions。</small></div>
        <div className="field ai-settings-field"><label htmlFor="ai-api-key">API Key <span>接口密钥</span></label><div className="ai-settings-secret"><input id="ai-api-key" type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={event => update('apiKey', event.target.value)} placeholder={config.hasApiKey ? '已保存，留空保留' : '粘贴你的 API Key'} maxLength={4096} disabled={disabled} autoComplete="new-password" autoCapitalize="none" spellCheck={false} aria-describedby="ai-api-key-hint" /><button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} aria-pressed={showKey} onClick={() => setShowKey(current => !current)} disabled={disabled || !form.apiKey}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><small id="ai-api-key-hint">{config.hasApiKey ? '密钥已保存，本页不会读取或展示已保存的完整密钥。' : '从你选择的模型服务商控制台获取密钥。'}</small></div>
        <div className="field ai-settings-field"><label htmlFor="ai-model">模型名称 <span>Model</span></label><input id="ai-model" value={form.model} onChange={event => update('model', event.target.value)} placeholder="填写服务商的模型 ID" maxLength={200} disabled={disabled} autoCapitalize="none" spellCheck={false} aria-describedby="ai-model-hint" /><small id="ai-model-hint">与服务商提供的模型 ID 一致，需支持 JSON 格式输出。</small></div>
      </div>
      {addressChanged && <p className="ai-settings-address-note"><KeyRound size={15} />更换接口地址时，请重新填写 API Key，确认该密钥用于新的服务商。</p>}
      <div className="ai-settings-actions"><div><Button type="submit" busy={busy === 'save'} disabled={disabled}><Save size={16} />保存 AI 配置</Button><Button type="button" variant="secondary" busy={busy === 'test'} disabled={disabled} onClick={test}><PlugZap size={16} />{busy === 'test' ? '正在测试连接…' : '测试连接'}</Button></div><p>测试使用当前填写内容，不会自动保存。</p>{config.hasApiKey && <Button type="button" className="ai-settings-clear" variant="ghost" disabled={disabled} onClick={() => setConfirmClear(true)}><Trash2 size={14} />清除密钥</Button>}</div>
    </form> : busy !== 'load' && <Button type="button" variant="secondary" onClick={() => setLoadAttempt(current => current + 1)}><RefreshCw size={15} />重新读取配置</Button>}
    {confirmClear && <div className="ai-settings-confirm"><p><strong>清除已保存的 API Key？</strong>清除后将使用本地规则与模板；页面中未保存的修改也会重置。</p><div><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setConfirmClear(false)}>取消</Button><Button type="button" variant="secondary" busy={busy === 'clear'} disabled={Boolean(busy)} onClick={clear}>确认清除密钥</Button></div></div>}
    <div className="ai-settings-feedback" aria-live="polite" aria-atomic="true">
      {error && <p className="ai-settings-error" role="alert">{error}</p>}
      {message && <p className="ai-settings-success"><CheckCircle2 size={16} /><span>{message}</span></p>}
      {testResult && <p className="ai-settings-success"><CheckCircle2 size={16} /><span>连接测试通过 · {testResult.model}{Number.isFinite(testResult.latencyMs) ? ` · ${(testResult.latencyMs / 1000).toFixed(1)} 秒` : ''}。{dirty ? '请点击「保存 AI 配置」后用于生成。' : '当前接口可用于 AI 生成。'}</span></p>}
    </div>
    <div className="ai-settings-footer"><div className="ai-settings-uses"><span><FileText size={15} />求职材料</span><span><Mail size={15} />邮件写作</span><span><MessageSquareText size={15} />面试准备</span></div><p><ShieldCheck size={15} /><span>配置保存在本机，不随工作区导出。生成时相关内容会发送给你配置的模型服务商；简历事实始终以个人档案为准。</span></p></div>
  </section>;
}
