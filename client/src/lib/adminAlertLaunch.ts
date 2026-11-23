const uuid=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const cacheName="maha-admin-tap-v1", ttl=300000;
export const launchNotice=()=>{const m=/^\/admin\/open-alert\/([^/]+)\/?$/.exec(location.pathname);return m&&uuid.test(m[1])?m[1]:null;};
async function entries(){
  const cache=await caches.open(cacheName),now=Date.now();
  const rows=await Promise.all((await cache.keys()).map(async key=>{
    const m=/^\/admin\/\.(tap|handled)\/(\d+)\/([\da-f-]+)$/.exec(new URL(key.url).pathname);
    if(!m||!uuid.test(m[3])||Number(m[2])>now||now-Number(m[2])>ttl){await cache.delete(key);return null;}
    return {kind:m[1],time:Number(m[2]),id:m[3]};
  }));
  return {cache,rows:rows.filter(x=>x!==null)};
}
export async function handled(id:string,openedAt:number){
  try{
    const {cache,rows}=await entries();
    const tap=rows.filter(x=>x.kind==="tap"&&x.id===id).sort((a,b)=>b.time-a.time)[0];
    const time=tap?.time??openedAt;
    await cache.put(`/admin/.handled/${time}/${id}`,new Response("1"));
  }catch{/* Storage is optional: the direct path remains usable. */}
}
export function watchAdminAlertLaunch(){
  if(location.pathname!=="/admin/")return;
  const open=(id:string)=>{if(uuid.test(id)&&location.pathname==="/admin/"&&!/^#\/(?:guest-chat|continue-chat)\//.test(location.hash))location.assign(`/admin/open-alert/${id}`);};
  const resume=async()=>{
    if(document.visibilityState!=="visible"||!(matchMedia("(display-mode: standalone)").matches||(navigator as Navigator&{standalone?:boolean}).standalone))return;
    try{
      const {rows}=await entries();
      const last=rows.filter(x=>x.kind==="handled").reduce((v,x)=>Math.max(v,x.time),0);
      const tap=rows.filter(x=>x.kind==="tap"&&x.time>last).sort((a,b)=>b.time-a.time)[0];
      if(tap&&document.visibilityState==="visible")open(tap.id);
    }catch{}
  };
  try{navigator.serviceWorker?.addEventListener("message",e=>{
    if(e.source===navigator.serviceWorker.controller&&e.data?.type==="MAHA_ADMIN_TAP"&&typeof e.data.id==="string")open(e.data.id);
  });}catch{}
  window.addEventListener("pageshow",resume);document.addEventListener("visibilitychange",resume);
  void resume();
}
