// Always badge via WorkerNavigator, not ServiceWorkerRegistration.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { title: "MAHA Partner Platform", body: "You have a new notification." }; }
  event.waitUntil((async () => {
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
      ...(payload.requireInteraction && !payload.silent ? { vibrate: [250, 100, 250] } : {}),
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
        await client.navigate(target.href); await client.focus(); return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
