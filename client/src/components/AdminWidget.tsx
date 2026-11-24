import {useEffect,useState} from "react";
import {useAuth} from "@/context/AuthContext";
import {Button} from "@/components/ui/button";
import {adminChatDestination} from "@shared/adminChatTarget";
export function widgetLocation(path:string){
  if(path==="/admin/widget-settings")return {action:"settings",id:""};
  const m=/^\/admin\/widget-(open|connect|names)\/([0-9a-f]{64})(?:\/([0-9a-f]{32,64}))?\/?$/.exec(path);
  return m?{action:m[1],id:m[2],extra:m[3]||""}:null;
}
export function AdminWidget({action,id,extra=""}:{action:string;id:string;extra?:string}){
  const {user}=useAuth(),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
  const [devices,setDevices]=useState<{id:string;createdAt:number}[]>([]);
  const [showNames,setShowNames]=useState(false),[done,setDone]=useState(false);
  const allowed=user?.role==="admin"&&!user.impersonating;
  const api=async(path:string,body?:object)=>{
    const r=await fetch(`/api/admin/widget/${path}`,{method:body?"POST":"GET",credentials:"same-origin",redirect:"error",cache:"no-store",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
    if(!r.ok)throw Error(r.status===404||r.status===403?"This widget is not connected to this MAHA account.":r.status===410?(path.startsWith("row/")?"This conversation is no longer waiting. Open Chat Inbox to choose another.":"Pairing expired. Start again on the phone."):"Could not connect. Check your connection and try again.");return r.json();
  };
  const load=async()=>setDevices(await api("devices"));
  useEffect(()=>{let active=true;if(allowed&&action==="open")api(extra?`row/${id}/${extra}`:`open/${id}`).then(({path})=>{
    if(path!=="/admin/chat"&&adminChatDestination(new URL(`/admin/#${path}`,location.origin))!==path)throw Error("Invalid destination.");
    if(active)location.replace(`/admin/#${path}`);
  }).catch(e=>{if(active)setStatus(e.message);});
  if(allowed&&action==="settings")load().catch(e=>setStatus(e.message));return()=>{active=false;};},[action,id,extra,allowed,user?.id]);
  const run=async(f:()=>Promise<void>)=>{setBusy(true);try{await f();}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}};
  return <main className="max-w-md mx-auto p-5 space-y-4"><h1 className="font-semibold text-xl">MAHA chat widget</h1>
    {!allowed?<p>This feature is for the signed-in administrator who paired the phone.</p>:action==="connect"||action==="names"?<>
      <p>Connect the widget to <strong>{user?.name}</strong>? By default it shows only the unread count and age. Message text is never shown.</p>
      <p>Approve only if you just started this on your own phone. No code to enter. <small>Phone check: <strong>{id.slice(0,8).toUpperCase()}</strong>.</small></p>
      {(!done&&(extra.length===64||action==="names"))&&<label className="flex items-start gap-3"><input type="checkbox" checked={showNames} onChange={e=>setShowNames(e.target.checked)}/><span>Show who’s waiting on Home screen<br/><small>Anyone viewing the Home screen can see up to three contact names. You can turn this off in the widget app.</small></span></label>}
      {!done?<Button disabled={busy||(action==="names"&&!showNames)} onClick={()=>run(async()=>{await api(action==="names"?"allow-names":"approve",{id,namesId:action==="names"?id:extra,showNames});setDone(true);setStatus("Connected. Return to the MAHA Widget app.");})}>{action==="names"?"Allow names":"Connect widget"}</Button>:
      <a className="inline-block rounded bg-primary text-primary-foreground px-4 py-3" href="intent://return#Intent;scheme=maha-widget;package=clinic.maha.inboxwidget;end">Return to widget</a>}
    </>:action==="settings"?<>
      <p>Disconnect a lost or unused phone here. This stops future snapshots without changing your MAHA login.</p>
      {devices.map(d=><div key={d.id} className="flex items-center justify-between"><span>Phone {d.id.slice(0,8).toUpperCase()} · {new Date(d.createdAt).toLocaleDateString()}</span><Button variant="outline" disabled={busy} onClick={()=>run(async()=>{await api("revoke",{id:d.id});await load();setStatus("Phone disconnected.");})}>Disconnect</Button></div>)}
      {!devices.length&&!status&&<p>No paired phones listed.</p>}
    </>:!status&&<p>Opening your latest unread conversation…</p>}
    <p role="status">{status}</p><a href="/admin/#/admin/chat" className="underline">Back to Chat Inbox</a>
  </main>;
}
