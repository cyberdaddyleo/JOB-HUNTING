import React,{useState} from 'react';
import {ArrowUpRight,LayoutDashboard,Search,Layers,Mail,CalendarDays,UserRound,Settings,Code2,ArrowRight,Menu,X,Monitor,ChevronDown,Database,CheckCircle2,AlertCircle,Loader2} from 'lucide-react';
import {useWorkspace} from './store.jsx';
import {Button} from './components/ui.jsx';
import Discover from './pages/Discover.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Applications from './pages/Applications.jsx';
import MailPage from './pages/Mail.jsx';
import Coach from './pages/Coach.jsx';
import Profile from './pages/Profile.jsx';
import SettingsPage from './pages/Settings.jsx';
import Library from './pages/Library.jsx';
import Documents from './pages/Documents.jsx';

const nav=[['dashboard','工作台',LayoutDashboard],['library','岗位库',Database],['discover','发现岗位',Search],['applications','投递管理',Layers],['documents','求职文件',Code2],['mail','邮件助手',Mail],['coach','面试准备',CalendarDays],['profile','求职档案',UserRound],['settings','数据与设置',Settings]];
const pages={library:Library,dashboard:Dashboard,discover:Discover,applications:Applications,documents:Documents,mail:MailPage,coach:Coach,profile:Profile,settings:SettingsPage};
export default function App(){
 const {data,error,refresh,page,navigate,toast,setToast}=useWorkspace();const [menu,setMenu]=useState(false);
 const Page=pages[page]||Discover, current=nav.find(n=>n[0]===page)||nav[1];
 const go=(key)=>{navigate(key);setMenu(false);};
 return <div className="app-shell">
  {menu&&<div className="nav-scrim" onClick={()=>setMenu(false)}/>}
  <aside className={`sidebar ${menu?'open':''}`} aria-label="主导航">
   <a href="#discover" className="brand" onClick={()=>setMenu(false)}><ArrowUpRight strokeWidth={2.6}/><strong>赛博老爸<span>·求职系统</span></strong></a>
   <button className="icon-button close-nav" aria-label="收起导航" onClick={()=>setMenu(false)}><X/></button>
   <div className="nav-caption">你的下一站，从这里开始</div>
   <nav>{nav.map(([key,label,Icon],i)=><React.Fragment key={key}>{i===7&&<div className="nav-divider"/>}<button className={`nav-item ${page===key?'active':''}`} onClick={()=>go(key)} aria-current={page===key?'page':undefined}><Icon size={20} strokeWidth={1.7}/><span>{label}</span>{key==='mail'&&data?.messages.filter(m=>!m.read).length>0&&<span className="nav-count">{data.messages.filter(m=>!m.read).length}</span>}</button></React.Fragment>)}</nav>
   <div className="sidebar-bottom"><div className="opensource-note developer-watermark"><Code2 size={20}/><span className="developed-label">DEVELOPED by</span><strong>@赛博老爸</strong><p>本版本为开源版本，禁止商用</p><button onClick={()=>go('settings')}>非商业使用许可 <span>v0.2.0 <ArrowUpRight size={13}/></span></button></div><button className="sidebar-profile" onClick={()=>go('profile')}><span className="avatar">{data?.profile.name?.slice(0,1)||'你'}</span><span><strong>{data?.profile.name||'求职者'}</strong><small>我的求职空间</small></span><ChevronDown size={15}/></button></div>
  </aside>
  <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={()=>setMenu(true)}><Menu size={20}/></button><span>我的求职空间</span><span className="slash">/</span><strong>{current[1]}</strong></div><button className="workspace-label" onClick={()=>go('settings')}><span className="online-dot"/><Monitor size={16}/><span>本地工作区</span><ChevronDown size={14}/></button></header>
  <main className={`main-content page-${page}`}>
   {!data?(error?<div className="connection-error"><AlertCircle size={35}/><h1>暂时无法连接本地服务</h1><p>{error}</p><p>请运行启动脚本，或在项目目录执行 npm run dev。</p><Button onClick={()=>refresh().catch(()=>{})}>重新连接</Button></div>:<div className="loading-screen"><Loader2 className="spin" size={28}/><p>正在打开你的求职空间…</p></div>):<Page/>}
  </main>
  {data&&<footer className="app-footer"><Database size={13}/><span>本地存储 · {data.jobs.some(j=>j.isDemo)?'含虚构示例岗位，已逐条标注':'你的求职数据由你掌握'}</span><span className="footer-right">一点准备，离理想更近一步 <ArrowUpRight size={13}/></span></footer>}
  </div>
  {toast&&<div className={`toast ${toast.type}`} role={toast.type==='error'?'alert':'status'}>{toast.type==='error'?<AlertCircle size={19}/>:<CheckCircle2 size={19}/>}<span>{toast.message}</span><button aria-label="关闭提示" className="icon-button" onClick={()=>setToast(null)}><X size={16}/></button></div>}
 </div>
}
