import test from 'node:test';
import assert from 'node:assert/strict';
import { readImap, sendSmtp } from '../server/mail.js';

test('empty IMAP search returns zero messages and always releases read-only mailbox', async () => {
  let released = false;
  let loggedOut = false;
  const result = await readImap({ IMAP_HOST: 'imap.company.invalid', IMAP_USER: 'me', IMAP_PASS: 'secret' }, config => {
    assert.equal(config.secure, true);
    return { connect: async () => {}, getMailboxLock: async (_name, options) => { assert.equal(options.readOnly, true); return { release: () => { released = true; } }; }, search: async () => false, logout: async () => { loggedOut = true; }, close: () => {} };
  });
  assert.deepEqual(result, []);
  assert.equal(released, true);
  assert.equal(loggedOut, true);
});

test('SMTP adapter sends the original resume bytes with TLS and no file or URL access', async () => {
  let resultMail;
  let closed = false;
  const receipt = await sendSmtp({ to: 'hr@company.careers', subject: '求职', body: '正文', resumeText: 'fallback', attachment: { name: 'resume.pdf', mime: 'application/pdf', content: Buffer.from('%PDF-') } }, { SMTP_PORT: '587', SMTP_HOST: 'smtp.company.invalid', SMTP_USER: 'me', SMTP_PASS: 'secret', SMTP_FROM: 'me@company.careers' }, config => {
    assert.equal(config.requireTLS, true);
    assert.equal(config.disableFileAccess, true);
    assert.equal(config.disableUrlAccess, true);
    return { sendMail: async mail => { resultMail = mail; return { accepted: ['hr@company.careers'], messageId: 'receipt' }; }, close: () => { closed = true; } };
  });
  assert.equal(receipt.messageId, 'receipt');
  assert.equal(resultMail.attachments.length, 1);
  assert.equal(resultMail.attachments[0].filename, 'resume.pdf');
  assert.equal(resultMail.attachments[0].content.toString(), '%PDF-');
  assert.equal(closed, true);
});
