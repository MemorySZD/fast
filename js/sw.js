// ================================================================
// sw.js – Service Worker
// ================================================================

// ═══════════════════════════════════════════════════════════════
// ⚠️⚠️⚠️ CHANGE HERE: Apps Script URL (उही) ⚠️⚠️⚠️
// ═══════════════════════════════════════════════════════════════
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxl9SpSExpUM74jeKtmsSIza7vHApoiQO36QrY7apFIWSY8bybVIX7gyu58iTB1jrpD/exec';
const CACHE_NAME = 'pro-camera-v1';

const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/sw.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[SW] Caching assets...');
        return cache.addAll(urlsToCache);
      })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        if (response) return response;
        return fetch(event.request).then(function(networkResponse) {
          if (event.request.url.startsWith(self.location.origin)) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        }).catch(function() {
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

self.addEventListener('sync', function(event) {
  if (event.tag === 'photo-sync') {
    event.waitUntil(handleSync());
  }
});

async function handleSync() {
  try {
    if (!GAS_URL || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
      console.error('[SW] ❌ GAS_URL not set');
      return;
    }

    var db = await openDB();
    var queue = await getAllPending(db);

    if (queue.length === 0) return;

    console.log('[SW] 📤 Syncing ' + queue.length + ' photos...');

    var compressedPromises = queue.map(function(entry) {
      return uploadPhoto(entry, 'compressed');
    });
    var compressedResults = await Promise.all(compressedPromises);

    var originalPromises = [];
    var toRemove = [];
    for (var i = 0; i < queue.length; i++) {
      if (compressedResults[i]) {
        originalPromises.push(uploadPhoto(queue[i], 'original'));
      }
    }
    var originalResults = await Promise.all(originalPromises);

    var idx = 0;
    for (var j = 0; j < queue.length; j++) {
      if (compressedResults[j] && originalResults[idx]) {
        toRemove.push(queue[j].photoId);
        console.log('[SW] ✅ Both uploaded:', queue[j].fileName);
        idx++;
      }
    }
    for (var k = 0; k < toRemove.length; k++) {
      await removeFromQueue(db, toRemove[k]);
    }

  } catch (error) {
    console.warn('[SW] Sync error:', error);
    throw error;
  }
}

async function uploadPhoto(entry, type) {
  try {
    var payload = {
      action: type === 'compressed' ? 'upload_compressed' : 'upload_original',
      photoId: entry.photoId,
      image: type === 'compressed' ? entry.compressed : entry.original,
      fileName: type === 'compressed' ? entry.compressedFileName : entry.fileName,
      createdAt: entry.createdAt || new Date().toISOString(),
      cameraType: entry.cameraType || 'back',
      captureType: entry.captureType || 'auto'
    };
    var resp = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var result = await resp.json();
    if (result.success) return true;
    else throw new Error('Upload failed: ' + JSON.stringify(result));
  } catch (err) {
    console.warn('[SW] ⏳ ' + type + ' failed:', entry.fileName, err.message);
    return false;
  }
}

function openDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('PhotoQueueDB', 3);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (db.objectStoreNames.contains('queue')) db.deleteObjectStore('queue');
      db.createObjectStore('queue', { keyPath: 'photoId' });
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

function getAllPending(db) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction('queue', 'readonly');
    var store = tx.objectStore('queue');
    var all = store.getAll();
    all.onsuccess = function() { resolve(all.result); };
    all.onerror = function() { reject(all.error); };
  });
}

function removeFromQueue(db, photoId) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction('queue', 'readwrite');
    var store = tx.objectStore('queue');
    store.delete(photoId);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
  });
}
