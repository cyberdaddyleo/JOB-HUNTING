import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { capabilities, fail, validEmail } from './safety.js';
import { plainText } from './connectors.js';

/** SMTP never sends HTML, executes URLs, or attaches arbitrary local files. */
export async function sendSmtp(mail, env = process.env, createTransport = options => nodemailer.createTransport(options)) {
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) fail('SMTP_PORT 请使用465（TLS）或587（STARTTLS）');
  const transport = createTransport({
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port === 587,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  });
  try {
    const info = await transport.sendMail({
      from: env.SMTP_FROM, to: mail.to, envelope: { from: env.SMTP_FROM, to: [mail.to] },
      subject: mail.subject, text: mail.body, messageId: mail.messageId,
      ...(mail.replyToId ? { inReplyTo: mail.replyToId, references: [mail.replyToId] } : {}),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      ...(mail.attachment ? { attachments: [{ filename: mail.attachment.name, content: mail.attachment.content, contentType: mail.attachment.mime }] } : mail.resumeText ? { attachments: [{ filename: 'resume.txt', content: mail.resumeText, contentType: 'text/plain; charset=utf-8' }] } : {}),
    });
    if (!info.accepted?.some(address => String(address).toLowerCase() === mail.to.toLowerCase())) throw new Error('SMTP recipient not accepted');
    return { messageId: info.messageId };
  } finally { transport.close(); }
}

export function classifyMessage(subject, body) {
  const text = `${subject}\n${body}`;
  if (/面试|interview|沟通邀请/i.test(text)) return 'interview';
  if (/测评|笔试|作业|assessment|assignment|coding challenge/i.test(text)) return 'assessment';
  if (/收到|感谢|进展|follow.?up|application/i.test(text)) return 'followup';
  return 'other';
}

export async function readImap(env = process.env, createClient = options => new ImapFlow(options)) {
  if (!capabilities(env).imap) fail('IMAP 尚未配置，请在本地 .env 设置邮箱参数', 503);
  const port = Number(env.IMAP_PORT || 993);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('IMAP_PORT 无效');
  const client = createClient({
    host: env.IMAP_HOST, port, secure: true,
    auth: { user: env.IMAP_USER, pass: env.IMAP_PASS },
    logger: false, emitLogs: false,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 25000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    maxIdleTime: 10000,
  });
  const watchdog = setTimeout(() => client.close(), 60000);
  let lock;
  try {
    await client.connect();
    lock = await client.getMailboxLock('INBOX', { readOnly: true });
    const ids = ((await client.search({ since: new Date(Date.now() - 30 * 86400000) }, { uid: true })) || []).slice(-100);
    if (!ids.length) return [];
    const metadata = [];
    for await (const message of client.fetch(ids, { uid: true, size: true }, { uid: true })) {
      if (message.size <= 1024 * 1024) metadata.push(message);
    }
    const messages = [];
    const mailboxKey = createHash('sha256').update(`${env.IMAP_HOST}:${env.IMAP_USER}:${client.mailbox.uidValidity}`).digest('hex').slice(0, 20);
    let bytes = 0;
    for (const meta of metadata) {
      bytes += meta.size;
      if (bytes > 8 * 1024 * 1024) break;
      const fetched = await client.fetchOne(meta.uid, { source: true }, { uid: true });
      if (!fetched?.source || fetched.source.length > 1024 * 1024) continue;
      const parsed = await simpleParser(fetched.source, { skipHtmlToText: false, skipTextToHtml: true, maxHtmlLengthToParse: 100000 });
      const from = parsed.from?.value;
      if (from?.length !== 1 || !validEmail(from[0].address)) continue;
      const autoSubmitted = String(parsed.headers.get('auto-submitted') || '').toLowerCase();
      const precedence = String(parsed.headers.get('precedence') || '').toLowerCase();
      const automated = Boolean((autoSubmitted && autoSubmitted !== 'no') || /bulk|list|junk/.test(precedence) || parsed.headers.has('list-id') || parsed.headers.has('x-auto-response-suppress') || /(?:no.?reply|mailer-daemon|postmaster)@/i.test(from[0].address));
      messages.push({
        messageId: String(parsed.messageId || `${mailboxKey}:${meta.uid}`).slice(0, 500),
        from: from[0].address.toLowerCase(), subject: String(parsed.subject || '（无主题）').replace(/[\r\n]/g, ' ').slice(0, 500),
        body: String(parsed.text || plainText(parsed.html || '')).slice(0, 40000),
        receivedAt: (parsed.date instanceof Date && Number.isFinite(parsed.date.valueOf()) ? parsed.date : new Date()).toISOString(),
        automated, inReplyTo: String(parsed.inReplyTo || '').slice(0, 500),
      });
    }
    return messages;
  } catch { fail('邮箱同步失败，请检查 IMAP 配置、网络及邮箱授权码；服务端未记录密码', 502); }
  finally {
    clearTimeout(watchdog);
    lock?.release();
    try { await client.logout(); } catch { client.close(); }
  }
}
