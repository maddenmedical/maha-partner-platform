// MAHA Partner Platform service worker — push notifications only (no offline cache).

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "MAHA", body: event.data ? event.data.text() : "" };
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
