import { mkdir, readFile, stat, chmod, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './safety.js';
import { readJsonLimited } from './connectors.js';

const defaultBaseUrl = 'https://api.openai.com/v1';
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;

function field(value, label, max) {
  if (typeof value !== 'string' || value.length > max || controlCharacters.test(value)) fail(`${label}格式无效，请检查长度或不可见字符`);
  return value.trim();
}

function baseUrl(value) {
  const text = field(value, 'API 地址', 2000);
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch { fail('API 地址无效，请填写完整的 HTTPS 基础地址'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) fail('API 地址需要 HTTPS；本机模型可使用 localhost 或回环地址的 HTTP');
  if (url.username || url.password || url.search || url.hash) fail('API 地址不能包含账号、密码、查询参数或锚点');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { fail('API 地址路径格式无效'); }
  if (/\/chat\/completions\/*$/i.test(pathname)) fail('请填写 API 基础地址（例如 https://api.openai.com/v1），不要包含 /chat/completions');
  if (controlCharacters.test(pathname)) fail('API 地址不能包含不可见字符');
  return url.href.replace(/\/+$/, '');
}

const metadata = (value, source, warning) => ({ baseUrl: value.baseUrl, model: value.model, hasApiKey: Boolean(value.apiKey), configured: Boolean(value.baseUrl && value.model && value.apiKey), source, ...(warning ? { warning } : {}) });

// Keep credentials outside workspace data, exports and process.env. Each app owns
// an independent snapshot; only a completed atomic write activates new settings.
export async function createAIConfig({ directory, env = process.env, fetchImpl = fetch, testTimeoutMs = 25000 }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'ai-config.json');
  let current, source, warning;
  try {
    if ((await stat(filename)).size > 12000) throw new Error('oversized config');
    const saved = JSON.parse(await readFile(filename, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version !== 1) throw new Error('invalid config');
    current = { baseUrl: baseUrl(saved.baseUrl), model: field(saved.model, '模型名称', 200), apiKey: field(saved.apiKey, 'API Key', 4096) };
    await chmod(filename, 0o600);
    source = 'local';
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('本地 AI 配置无法读取；为保护已有配置，未重置文件。请检查 data/ai-config.json。');
    source = ['AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY'].some(name => Boolean(env[name])) ? 'environment' : 'none';
    try {
      current = { baseUrl: baseUrl(env.AI_BASE_URL || defaultBaseUrl), model: field(env.AI_MODEL || '', '模型名称', 200), apiKey: field(env.AI_API_KEY || '', 'API Key', 4096) };
    } catch {
      // An old invalid .env must not prevent opening the settings page. Discard
      // its entire AI tuple so its key cannot migrate to a different endpoint.
      current = { baseUrl: '', model: '', apiKey: '' };
      source = 'environment';
      warning = '原有环境变量中的 AI 配置无效，已停用。请在此重新填写并保存。';
    }
  }

  const candidate = input => {
    if ('clearApiKey' in input && typeof input.clearApiKey !== 'boolean') fail('clearApiKey 需要布尔值');
    const next = {
      baseUrl: 'baseUrl' in input ? baseUrl(input.baseUrl) : current.baseUrl,
      model: 'model' in input ? field(input.model, '模型名称', 200) : current.model,
      apiKey: current.apiKey,
    };
    const enteredKey = 'apiKey' in input ? field(input.apiKey, 'API Key', 4096) : '';
    if (input.clearApiKey === true) next.apiKey = '';
    else {
      if (next.baseUrl !== current.baseUrl && current.apiKey && !enteredKey) fail('API 地址已变化，请重新输入此服务的 API Key，避免把旧密钥发送给其他服务');
      next.apiKey = enteredKey || current.apiKey;
      if (!next.baseUrl || !next.model || !next.apiKey) fail('请填写 API 基础地址、模型名称和 API Key');
    }
    return next;
  };

  let pending = Promise.resolve();
  return {
    read: () => metadata(current, source, warning),
    getAIEnv: () => ({ ...env, AI_BASE_URL: current.baseUrl, AI_MODEL: current.model, AI_API_KEY: current.apiKey }),
    save(input) {
      const operation = pending.then(async () => {
        const next = candidate(input);
        const temporary = path.join(directory, `.ai-config-${randomUUID()}.tmp`);
        let handle;
        try {
          handle = await open(temporary, 'wx', 0o600);
          await handle.writeFile(JSON.stringify({ version: 1, ...next }, null, 2), 'utf8');
          await handle.sync();
          await handle.close(); handle = null;
          await rename(temporary, filename);
        } catch {
          await handle?.close().catch(() => {});
          await unlink(temporary).catch(() => {});
          fail('AI 配置保存失败，请检查本地数据目录权限；原配置仍然有效', 500);
        }
        current = next; source = 'local'; warning = undefined;
        return metadata(current, source);
      });
      pending = operation.catch(() => {});
      return operation;
    },
    async test(input) {
      const next = candidate(input);
      if (!metadata(next, source).configured) fail('请先填写 API 地址、模型名称和 API Key 再测试');
      const started = Date.now();
      const response = await readJsonLimited(`${next.baseUrl}/chat/completions`, {
        fetchImpl: async (url, options) => {
          const result = await fetchImpl(url, options);
          if (!result.ok || result.redirected) {
            await result.body?.cancel().catch(() => {});
            if (result.status === 401 || result.status === 403) fail('AI 验证失败：API Key 无效或没有模型访问权限', 502);
            if (result.status === 404) fail('AI 接口或模型不存在，请检查 API 基础地址和模型名称', 502);
            if (result.status === 429) fail('AI 服务额度不足或请求过于频繁，请检查账户额度后重试', 502);
            fail('AI 服务请求失败或发生重定向，请检查基础地址与服务状态', 502);
          }
          if (/text\/html/i.test(result.headers.get('content-type') || '')) {
            await result.body?.cancel().catch(() => {});
            fail('AI 地址返回了网页，请填写支持 Chat Completions 的 API 基础地址', 502);
          }
          return result;
        },
        timeout: testTimeoutMs, maxBytes: 60000, method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${next.apiKey}` },
        body: JSON.stringify({ model: next.model, temperature: 0.3, max_tokens: 100, response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: '这是 API 连接与 JSON 格式兼容性测试。只输出 JSON 对象 {"ok":true}，不需要任何个人资料。' },
          { role: 'user', content: '请返回 {"ok":true}。' },
        ] }),
      });
      let answer;
      try {
        const content = response?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.length > 2000) throw new Error('invalid content');
        answer = JSON.parse(content);
      } catch { fail('AI 响应格式不兼容：需要 Chat Completions 和 JSON 对象输出，请检查模型设置', 502); }
      if (!answer || Array.isArray(answer) || answer.ok !== true) fail('AI 未返回有效的测试结果，请选择支持 JSON 对象输出的模型', 502);
      return { ok: true, message: '连接成功，模型支持本系统使用的 JSON 输出参数。测试未保存配置。', model: next.model, latencyMs: Date.now() - started };
    },
  };
}
