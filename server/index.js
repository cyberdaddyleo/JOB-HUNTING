import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为1–65535之间的整数');
try {
  const { app, service } = await createApp();
  const server = app.listen(port, '127.0.0.1', () => console.log(`赛博老爸·求职系统 本地服务：http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口${port}已被占用，请关闭旧服务或修改PORT。` : '本地服务启动失败。'); process.exit(1); });
  // All automation requires explicit saved settings and lives only while this process runs.
  const timer = setInterval(() => service.runAutomation().catch(() => console.error('自动化本轮未完成；请查看应用日志和本地配置。')), 60000);
  timer.unref();
  const shutdown = () => { clearInterval(timer); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch {
  console.error('赛博老爸·求职系统 未能启动。请检查 data/state.json、目录权限与环境配置；原始数据不会自动重置。');
  process.exit(1);
}
