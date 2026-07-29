// ================================================================
// update.js – Queue Upload Only (अलग Script)
// ================================================================

// ═══════════════════════════════════════════════════════════════
// ⚠️ CHANGE HERE: आफ्नो Google Apps Script URL राख्नुहोस्
// ═══════════════════════════════════════════════════════════════
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxl9SpSExpUM74jeKtmsSIza7vHApoiQO36QrY7apFIWSY8bybVIX7gyu58iTB1jrpD/exec';

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

function getAllPending() {
  return openDB().then(function(db) {
    return new Promise(function(res, rej) {
      var tx = db.transaction('queue', 'readonly');
      var all = tx.objectStore('queue').getAll();
      all.onsuccess = function() { res(all.result); };
      all.onerror = function() { rej(all.error); };
    });
  });
}

function removeFromQueue(photoId) {
  return openDB().then(function(db) {
    return new Promise(function(res, rej) {
      var tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').delete(photoId);
      tx.oncomplete = function() { res(); };
      tx.onerror = function() { rej(tx.error); };
    });
  });
}

// ---------- Upload ----------
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
      console.error('[Upload] ❌ Server error:', resp.status, errorText);
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

// ---------- Process Queue (Fixed – No Infinite Loop) ----------
var isProcessing = false;

async function processQueue() {
  // ✅ Prevent concurrent runs
  if (isProcessing) {
    console.log('[Upload] ⏳ Already processing, skipping...');
    return;
  }

  if (!navigator.onLine) {
    console.log('[Upload] 🔴 Offline, cannot upload');
    return;
  }

  isProcessing = true;

  try {
    var pending = await getAllPending();

    if (pending.length === 0) {
      console.log('[Upload] 📭 Queue is empty');
      isProcessing = false;
      return;
    }

    console.log('[Upload] 📤 Processing ' + pending.length + ' photos...');

    // ✅ Upload all in parallel
    var uploadPromises = pending.map(function(entry) {
      return uploadPhoto(entry);
    });

    var results = await Promise.all(uploadPromises);

    // ✅ Remove successfully uploaded photos
    var toRemove = [];
    for (var i = 0; i < pending.length; i++) {
      if (results[i]) {
        toRemove.push(pending[i].photoId);
        console.log('[Upload] 🎉 Uploaded:', pending[i].fileName);
      } else {
        console.warn('[Upload] ⏳ Upload failed for:', pending[i].fileName);
        // ❌ Retry logic हटाइयो – यहाँ Retry गर्नु हुँदैन
        // पुन: प्रयास गर्नको लागि user ले फेरि page refresh गर्नुपर्छ वा अर्को mechanism
      }
    }

    for (var j = 0; j < toRemove.length; j++) {
      await removeFromQueue(toRemove[j]);
    }

    console.log('[Upload] ✅ Completed. Remaining:', pending.length - toRemove.length);

  } catch (e) {
    console.error('[Upload] ❌ Queue error:', e);
  }

  isProcessing = false;
}

// ---------- Start (loading page खुल्दा Auto Run) ----------
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(processQueue, 500);
} else {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(processQueue, 500);
  });
}

// ✅ Make it global for manual trigger
window.processQueue = processQueue;
