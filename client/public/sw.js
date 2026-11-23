// Always badge via WorkerNavigator, not ServiceWorkerRegistration.
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { title: "MAHA Partner Platform", body: "You have a new notification." }; }
  event.waitUntil((async () => {
    if(payload.guest){
      const id=payload.guest;
      if(typeof id!=="string"||!/^[a-f0-9-]{36}$/.test(id))return;
      try{
        const sub=await self.registration.pushManager.getSubscription();
        if(!sub)return;
        const auth=await fetch(new URL(`./api/guest-chat/${id}/notifications/check`,self.registration.scope),{method:"POST",credentials:"include",cache:"no-store",redirect:"error",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})});
        if(!auth.ok)return;
        await self.registration.showNotification("MAHA",{body:"MAHA replied. Open your chat.",icon:"./icon-192.png",data:{url:`/#/guest-chat/${id}`}});
      }catch{/* Off-device, offline, expired or revoked: no chat-specific display. */}
      return;
    }
    let count = payload.badgeCount;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(new URL("./api/notifications", self.registration.scope), { credentials: "include", signal: controller.signal });
      if (response.ok) count = (await response.json()).count;
    } catch {} finally { clearTimeout(timeout); }
    if (Number.isFinite(count) && count >= 0 && "setAppBadge" in self.navigator) {
      try { await self.navigator.setAppBadge(Math.floor(count)); } catch {}
    }
    const launch=adminTapURL(payload.url,payload.tag);
    await self.registration.showNotification(payload.title || "MAHA Partner Platform", {
      body: payload.body || "Open MAHA to review your new notification.",
      icon: "./icon-192.png", badge: "./icon-192.png", tag: payload.tag,
      requireInteraction: !!payload.requireInteraction, silent: !!payload.silent,
      ...(payload.priority === "high" && !payload.silent ? { vibrate: [250, 100, 250] } : {}),
      ...(launch?{navigate:launch}:{}), // Native activation where available; legacy agents ignore this option.
      data: { url: payload.url || "./" },
    });
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      client.postMessage({ type: "MAHA_NOTIFICATIONS_CHANGED" });
    }
  })());
});
function adminTapURL(path,id){
  if(typeof id!=="string"||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))return null;
  if(typeof path!=="string"||!/^\/admin\/#\/admin\/chat\/(?:(?:thread|dm)\/[1-9]\d*|room\/main|invitation\/[\da-f-]{36})$/i.test(path))return null;
  return new URL(`/admin/open-alert/${id}`,self.registration.scope).href;
}
async function rememberAdminTap(id){
  // Only a tap writes. No message, sender name, credentials or private
  // conversation ID are stored. The signed-in server resolves ownership.
  const cache=await caches.open("maha-admin-tap-v1"),now=Date.now();
  for(const key of await cache.keys()){
    const ts=Number(new URL(key.url).pathname.split("/").at(-2));
    if(!Number.isFinite(ts)||now-ts>300000)await cache.delete(key);
  }
  await cache.put(new URL(`/admin/.tap/${now}/${id}`,self.registration.scope),new Response("1"));
}
async function activateAdminTap(url,id){
  // Use transient activation immediately, before disk access, app startup,
  // network requests, window enumeration, or navigating a suspended client.
  const open=(async()=>self.clients.openWindow(url))().catch(()=>null);
  const saved=rememberAdminTap(id).catch(()=>{});
  try{
    const opened=await open;
    if(opened && opened.url===url)return;
    const visible=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const eligible=c=>{try{const u=new URL(c.url);return u.origin===self.location.origin&&u.pathname.startsWith("/admin/")&&!/^#\/(?:continue-chat|guest-chat)\//.test(u.hash);}catch{return false;}};
    const client=opened&&eligible(opened)?opened:visible.find(eligible);
    if(client){
      try{await client.focus();}catch{}
      await saved;
      try{client.postMessage({type:"MAHA_ADMIN_TAP",id});}catch{}
    }
  } finally {await saved;}
}
self.addEventListener("notificationclick", event => {
  const launch=adminTapURL(event.notification.data?.url,event.notification.tag);
  if(launch){
    event.waitUntil(activateAdminTap(launch,event.notification.tag).finally(()=>event.notification.close()));
    return;
  }
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "./", self.registration.scope);
    if (target.origin !== self.location.origin) return;
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(client.url).origin === target.origin && "focus" in client) {
        // Do not replace an open guest document: some guest credentials live
        // only for the lifetime of that page.
        if (/^#\/(?:continue-chat|guest-chat)\//.test(new URL(client.url).hash)) continue;
        try { const next=await client.navigate(target.href); if(next!==null){await (next||client).focus(); return;} } catch {}
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
