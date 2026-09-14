// MAHA Partner Platform service worker — push notifications only (no offline cache).

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "MAHA", body: event.data ? event.data.text() : "" };
  }

  // "silent" style (per the recipient's own notification preference): no
  // sound, no popup -- just bump the app icon badge so the count is visible
  // without interrupting anyone. Falls back gracefully where the Badging
  // API isn't supported.
  if (payload.silent) {
    event.waitUntil(
      (async () => {
        try {
          if ("setAppBadge" in self.registration) {
            await self.registration.setAppBadge(payload.badgeCount || 0);
          }
        } catch (e) {
          // Badging API not supported/allowed -- nothing else to do for silent pushes.
        }
      })()
    );
    return;
  }

  const title = payload.title || "MAHA Partner Platform";
  const options = {
    body: payload.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: payload.url || "./" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && targetUrl) {
            client.navigate(targetUrl).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
