import 'dotenv/config';
import {spawn} from 'node:child_process';
const port=Number(process.env.PORT)||4318;
const url=`http://127.0.0.1:${port}`;
const open=()=>{if(process.platform==='darwin')spawn('open',[url],{stdio:'ignore'});else console.log(`在浏览器打开 ${url}`);};
try{const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1500)});const health=await response.json();if(health.ok){console.log(`本地服务已运行：${url}`);open();process.exit(0);}}catch{}
const server=spawn(process.execPath,['server/index.js'],{stdio:'inherit'});
server.on('error',e=>{console.error('无法启动本地服务：',e.message);process.exit(1)});
server.on('exit',code=>process.exit(code||0));
let attempts=0;const timer=setInterval(async()=>{attempts++;try{const res=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1000)});if(res.ok){clearInterval(timer);open();}}catch{}if(attempts>=20){clearInterval(timer);console.log(`服务启动较慢，请检查上方日志，然后打开 ${url}`);}},500);
process.on('SIGINT',()=>server.kill('SIGINT'));process.on('SIGTERM',()=>server.kill('SIGTERM'));
