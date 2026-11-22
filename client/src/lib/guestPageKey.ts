// Only this JS document owns the new guest capability. No persistent/browser
// storage, cookies, query strings, service workers, cross-tab messaging or logs.
const pages=new Map<string,string>();
export function holdGuestPage(id:string,key:string){
  if(/^[a-f0-9-]{36}$/.test(id)&&/^[a-f0-9]{64}$/.test(key))pages.set(id,key);
}
export function pageHeaders(path:string):Record<string,string>{
  const match=/^\/api\/guest-chat\/([a-f0-9-]{36})(?:\/|$)/.exec(path);
  const key=match&&pages.get(match[1]);return key?{"X-MAHA-Page-Key":key}:{};
}
function end(id:string,key:string){
  pages.delete(id);
  void fetch(`/api/guest-chat/${id}/end-page`,{method:"POST",credentials:"same-origin",keepalive:true,cache:"no-store",headers:{"Content-Type":"application/json","X-MAHA-Page-Key":key},body:"{}"}).catch(()=>{});
}
export function releaseGuestPage(id:string){const key=pages.get(id);if(key)end(id,key);}
if(typeof window!=="undefined"){
  let hiddenPage=false;
  window.addEventListener("pagehide",()=>{hiddenPage=pages.size>0;pages.forEach((key,id)=>end(id,key));});
  window.addEventListener("pageshow",e=>{if(e.persisted&&hiddenPage)location.reload();});
  window.addEventListener("hashchange",()=>pages.forEach((key,id)=>{
    if(location.hash.split("?")[0]!==`#/guest-chat/${id}`)end(id,key);
  }));
}
