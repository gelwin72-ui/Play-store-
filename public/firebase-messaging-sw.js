/* Firebase Cloud Messaging Service Worker for AppHarbor Owner & Developer Push Alerts */
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    const title = payload.notification?.title || 'AppHarbor Alert';
    const options = {
      body: payload.notification?.body || 'New marketplace activity requires attention.',
      data: payload.data || {},
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    // Fallback for plain text push messages
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
