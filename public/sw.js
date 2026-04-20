// Service Worker — 삼성 브라우저 PWA 인식용
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
