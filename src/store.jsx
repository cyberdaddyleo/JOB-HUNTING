import React, {createContext, useContext, useState, useCallback, useEffect} from 'react';

const Workspace = createContext(null);
export async function api(path, options={}) {
  const res=await fetch(`/api${path}`, {...options,headers:{'Content-Type':'application/json',...options.headers}, ...(options.body !== undefined ? {body:JSON.stringify(options.body)} : {})});
  const result=await res.json().catch(()=>({error:'服务未返回有效数据，请检查本地服务。'}));
  if(!res.ok) throw new Error(result.error || '操作失败，请重试');
  return result;
}
export function WorkspaceProvider({children}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[toast,setToast]=useState(null);
  const [page,setPage]=useState(window.location.hash.slice(1)||'library');
  const notify=useCallback((message,type='success')=>setToast({message,type,id:Date.now()}),[]);
  const refresh=useCallback(async()=>{try {const next=await api('/bootstrap');setData(next);setError('');return next;}catch(e){setError(e.message);throw e;}},[]);
  const navigate=useCallback((next)=>{window.location.hash=next;setPage(next);window.scrollTo({top:0,behavior:'smooth'});},[]);
  const mutate=useCallback(async(path,body,method='POST')=>{try{const result=await api(path,{method,body});await refresh();return result;}catch(e){notify(e.message,'error');throw e;}},[refresh,notify]);
  useEffect(()=>{refresh().catch(()=>{});const onHash=()=>setPage(window.location.hash.slice(1)||'library');window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash);},[refresh]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),5000);return()=>clearTimeout(timer);},[toast]);
  return <Workspace.Provider value={{data,error,refresh,page,navigate,mutate,notify,toast,setToast}}>{children}</Workspace.Provider>;
}
export function useWorkspace(){return useContext(Workspace);}
