/* Service Worker — handles notification click → focus/open correct chat tab */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/* Handle notification clicks from the browser */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const roomId = event.notification.data && event.notification.data.roomId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window first
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (roomId) {
            client.postMessage({ type: 'OPEN_ROOM', roomId });
          }
          return;
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
