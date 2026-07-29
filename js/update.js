// ================================================================
// upload.js – केवल Queue Upload को लागि (Camera बिना)
// ================================================================

(function() {
  'use strict';

  // ⚠️ यहाँ आफ्नो Apps Script URL हाल्नुहोस् (app.js मा जस्तै)
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbxl9SpSExpUM74jeKtmsSIza7vHApoiQO36QrY7apFIWSY8bybVIX7gyu58iTB1jrpD/exec';

  // DOM elements (loading page मा status देखाउन)
  var statusEl = document.getElementById('status');

  // ---------- IndexedDB Helpers ----------
  function openDB() {
    return new Promise(function(res, rej) {
      var req = indexedDB.open('PhotoQueueDB', 3);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('queue')) {
          db.createObjectStore('queue', { keyPath: 'photoId' });
        }
      };
      req.onsuccess = function() { res(req.result); };
      req.onerror = function() { rej(req.error); };
    });
  }

  function getAllPending(db) {
    return new Promise(function(res, rej) {
      var tx = db.transaction('queue', 'readonly');
      var all = tx.objectStore('queue').getAll();
      all.onsuccess = function() { res(all.result); };
      all.onerror = function() { rej(all.error); };
    });
  }

  function removeFromQueue(db, photoId) {
    return new Promise(function(res, rej) {
      var tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').delete(photoId);
      tx.oncomplete = function() { res(); };
      tx.onerror = function() { rej(tx.error); };
    });
  }

  // ---------- Upload Function ----------
  async function uploadPhoto(entry) {
    try {
      if (!GAS_URL || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        console.error('[Upload] ❌ GAS_URL not set!');
        return false;
      }

      var payload = {
        action: 'upload_photo',
        photoId: entry.photoId,
        image: entry.image,
        fileName: entry.fileName,
        createdAt: entry.createdAt || new Date().toISOString(),
        captureType: entry.captureType || 'manual',
        cameraType: entry.cameraType || 'back'
      };

      var resp = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        var errorText = await resp.text();
        console.error('[Upload] ❌ Upload error:', resp.status, errorText);
        return false;
      }

      var result = await resp.json();
      if (result.success) {
        console.log('[Upload] ✅ Uploaded:', entry.fileName);
        return true;
      } else {
        console.error('[Upload] ❌ Upload failed:', result.error);
        return false;
      }
    } catch (err) {
      console.error('[Upload] ❌ Upload error:', err);
      return false;
    }
  }

  // ---------- Process Queue (सबै Pending Upload) ----------
  async function processQueue() {
    if (!navigator.onLine) {
      if (statusEl) statusEl.textContent = '🔴 Offline – पछि प्रयास हुनेछ';
      console.log('[Upload] 🔴 Offline');
      return;
    }

    try {
      if (statusEl) statusEl.textContent = '📤 Uploading...';
      var db = await openDB();
      var pending = await getAllPending(db);

      if (pending.length === 0) {
        if (statusEl) statusEl.textContent = '✅ सबै फोटो Upload भयो!';
        console.log('[Upload] 📭 Queue empty');
        return;
      }

      console.log('[Upload] 📤 Processing ' + pending.length + ' photos...');
      if (statusEl) statusEl.textContent = '⏳ ' + pending.length + ' photos pending...';

      var uploadPromises = pending.map(function(entry) {
        return uploadPhoto(entry);
      });
      var results = await Promise.all(uploadPromises);

      var toRemove = [];
      for (var i = 0; i < pending.length; i++) {
        if (results[i]) {
          toRemove.push(pending[i].photoId);
          console.log('[Upload] 🎉 Uploaded:', pending[i].fileName);
        } else {
          console.warn('[Upload] ⏳ Upload failed for:', pending[i].fileName);
          // Retry logic: 1, 2, 4, 8... seconds
          var delay = Math.min(Math.pow(2, (pending[i].retryCount || 0)), 60) * 1000;
          pending[i].retryCount = (pending[i].retryCount || 0) + 1;
          pending[i].lastAttempt = Date.now();
          // Update queue entry
          var tx = db.transaction('queue', 'readwrite');
          tx.objectStore('queue').put(pending[i]);
          await new Promise(function(res) { tx.oncomplete = res; });
          setTimeout(function() { if (navigator.onLine) processQueue(); }, delay);
        }
      }

      for (var j = 0; j < toRemove.length; j++) {
        await removeFromQueue(db, toRemove[j]);
      }

      // फेरि check गर्ने (यदि कुनै बाँकी छ भने)
      var remaining = await getAllPending(db);
      if (remaining.length > 0) {
        setTimeout(function() { if (navigator.onLine) processQueue(); }, 2000);
      } else {
        if (statusEl) statusEl.textContent = '✅ सबै फोटो Upload भयो!';
      }

    } catch (e) {
      console.error('[Upload] ❌ Queue error:', e);
      if (statusEl) statusEl.textContent = '❌ Error: ' + e.message;
    }
  }

  // ---------- Start Upload ----------
  // Main app.js को जस्तो checkAndStart नगरी सिधै processQueue() चलाउने
  if (document.readyState === 'complete') {
    processQueue();
  } else {
    window.addEventListener('load', processQueue);
  }

  // Global बनाउने (यदि कतै बाट call गर्नु पर्यो भने)
  window.uploadProcessQueue = processQueue;

})();
