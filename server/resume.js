import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fail, string, invalidateProfileReview } from './safety.js';

const maxSize = 5 * 1024 * 1024;
const mimes = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain', '.md': 'text/markdown' };
const assetPath = (dataDir, filename) => {
  if (!/^[0-9a-f-]{36}\.bin$/.test(filename || '')) fail('简历文件记录无效，请重新上传', 409);
  return path.join(dataDir, 'attachments', filename);
};
export async function saveResume(store, dataDir, input) {
  const name = string(input.name, '简历文件名', 180, true);
  if (/[\/\\\x00-\x1f]/.test(name)) fail('简历文件名不能包含路径或控制字符');
  const extension = path.extname(name).toLowerCase();
  const mime = mimes[extension];
  if (!mime) fail('仅支持 PDF、DOCX、TXT 或 MD 简历');
  if (input.mime && input.mime !== mime && !(extension === '.md' && input.mime === 'text/plain') && input.mime !== 'application/octet-stream') fail('文件 MIME 类型与扩展名不匹配');
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(maxSize / 3) * 4) fail('简历文件最大5MB', 413);
  if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) fail('简历文件编码无效');
  const content = Buffer.from(input.base64, 'base64');
  if (!content.length) fail('简历文件不能为空');
  if (content.length > maxSize) fail('简历文件最大5MB', 413);
  if (extension === '.pdf' && !content.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('文件内容不是可识别的PDF');
  if (extension === '.docx' && (!content.subarray(0, 2).equals(Buffer.from('PK')) || !content.includes(Buffer.from('[Content_Types].xml')) || !content.includes(Buffer.from('word/')))) fail('文件内容不是可识别的DOCX');
  if (['.txt', '.md'].includes(extension) && (content.includes(0) || !Buffer.from(content.toString('utf8')).equals(content))) fail('文本简历需要有效UTF-8编码，且不能含二进制内容');
  await mkdir(path.join(dataDir, 'attachments'), { recursive: true, mode: 0o700 });
  const filename = `${randomUUID()}.bin`;
  await writeFile(assetPath(dataDir, filename), content, { mode: 0o600, flag: 'wx' });
  let previous;
  try {
    const metadata = await store.update(state => {
      previous = state.resumeAsset?.filename;
      state.resumeAsset = { filename };
      state.profile.resumeFile = { name, mime, size: content.length, updatedAt: new Date().toISOString() };
      invalidateProfileReview(state, '原始简历附件已更新');
      return state.profile.resumeFile;
    });
    if (previous) await unlink(assetPath(dataDir, previous)).catch(() => {});
    return metadata;
  } catch (error) { await unlink(assetPath(dataDir, filename)).catch(() => {}); throw error; }
}
export async function deleteResume(store, dataDir) {
  const filename = await store.update(state => {
    const filename = state.resumeAsset?.filename;
    delete state.resumeAsset; delete state.profile.resumeFile;
    invalidateProfileReview(state, '原始简历附件已移除');
    return filename;
  });
  if (filename) await unlink(assetPath(dataDir, filename)).catch(() => {});
  return { ok: true };
}
export async function readResume(state, dataDir) {
  if (!state.profile.resumeFile) return null;
  const file = assetPath(dataDir, state.resumeAsset?.filename);
  try {
    const info = await stat(file);
    if (info.size > maxSize || info.size !== state.profile.resumeFile.size) fail('原始简历文件大小与记录不一致，请重新上传', 409);
    const content = await readFile(file);
    return { name: state.profile.resumeFile.name, mime: state.profile.resumeFile.mime, content };
  } catch { fail('原始简历文件不可读取，请重新上传或移除后使用文本简历', 409); }
}
