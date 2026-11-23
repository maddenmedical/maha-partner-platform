// Always badge via WorkerNavigator, not ServiceWorkerRegistration.
self.addEventListener("install", () => self.skipWaiting());
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
    await self.registration.showNotification(payload.title || "MAHA Partner Platform", {
      body: payload.body || "Open MAHA to review your new notification.",
      icon: "./icon-192.png", badge: "./icon-192.png", tag: payload.tag,
      requireInteraction: !!payload.requireInteraction, silent: !!payload.silent,
      ...(payload.priority === "high" && !payload.silent ? { vibrate: [250, 100, 250] } : {}),
      data: { url: payload.url || "./" },
    });
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      client.postMessage({ type: "MAHA_NOTIFICATIONS_CHANGED" });
    }
  })());
});
self.addEventListener("notificationclick", event => {
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
