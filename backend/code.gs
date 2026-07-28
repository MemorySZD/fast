// ================================================================
// Code.gs – Google Apps Script
// ================================================================

// ═══════════════════════════════════════════════════════════════
// ⚠️ CHANGE HERE: आफ्नो Google Drive Folder ID राख्नुहोस्
// ═══════════════════════════════════════════════════════════════
const ROOT_FOLDER_ID = '1bLy13XuMTUV9lQBUmbxcfD_kuH70MmJS';
const PHOTO_ID_PROPERTY = "UPLOADED_PHOTO_IDS";

function doGet() {
  return jsonResponse({
    success: true,
    service: "Pro Camera PWA",
    status: "online",
    time: new Date().toISOString()
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: "No request data" });
    }

    var data = JSON.parse(e.postData.contents);
    var action = data.action || '';

    if (action === 'upload_compressed') {
      return handleCompressedUpload(data);
    } else if (action === 'upload_original') {
      return handleOriginalUpload(data);
    } else {
      return jsonResponse({ success: false, error: "Invalid action" });
    }

  } catch (error) {
    return jsonResponse({ success: false, error: String(error) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function handleCompressedUpload(data) {
  try {
    var photoId = String(data.photoId || "");
    if (!photoId) {
      return jsonResponse({ success: false, error: "Missing photoId" });
    }

    if (!data.image) {
      return jsonResponse({ success: false, error: "Missing image" });
    }

    var properties = PropertiesService.getScriptProperties();
    var uploaded = JSON.parse(properties.getProperty(PHOTO_ID_PROPERTY) || "{}");

    if (uploaded[photoId] && uploaded[photoId].compressedFileId) {
      return jsonResponse({
        success: true,
        duplicate: true,
        fileId: uploaded[photoId].compressedFileId
      });
    }

    var imageData = data.image;
    var base64String = imageData;
    if (imageData.includes(',')) {
      base64String = imageData.split(',')[1];
    }

    var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    var timezone = Session.getScriptTimeZone();
    var dateFolderName = Utilities.formatDate(createdAt, timezone, "yyyy-MM-dd");
    var dateFolder = getOrCreateFolder(rootFolder, dateFolderName);
    var compressedFolder = getOrCreateFolder(dateFolder, 'Compressed');

    var fileName = data.fileName || (
      "IMG_" + Utilities.formatDate(createdAt, timezone, "yyyyMMdd_HHmmss_SSS") +
      "_" + photoId + "_comp.jpg"
    );

    var bytes = Utilities.base64Decode(base64String);
    var blob = Utilities.newBlob(bytes, 'image/jpeg', fileName);
    var file = compressedFolder.createFile(blob);

    if (!uploaded[photoId]) uploaded[photoId] = {};
    uploaded[photoId].compressedFileId = file.getId();
    uploaded[photoId].compressedUrl = file.getUrl();
    uploaded[photoId].compressedName = file.getName();
    properties.setProperty(PHOTO_ID_PROPERTY, JSON.stringify(uploaded));

    return jsonResponse({
      success: true,
      duplicate: false,
      fileId: file.getId(),
      url: file.getUrl(),
      name: file.getName()
    });

  } catch (error) {
    return jsonResponse({ success: false, error: String(error) });
  }
}

function handleOriginalUpload(data) {
  try {
    var photoId = String(data.photoId || "");
    if (!photoId) {
      return jsonResponse({ success: false, error: "Missing photoId" });
    }

    if (!data.image) {
      return jsonResponse({ success: false, error: "Missing image" });
    }

    var properties = PropertiesService.getScriptProperties();
    var uploaded = JSON.parse(properties.getProperty(PHOTO_ID_PROPERTY) || "{}");

    if (!uploaded[photoId] || !uploaded[photoId].compressedFileId) {
      return jsonResponse({
        success: false,
        error: "Compressed version must be uploaded first"
      });
    }

    if (uploaded[photoId].originalFileId) {
      return jsonResponse({
        success: true,
        duplicate: true,
        fileId: uploaded[photoId].originalFileId
      });
    }

    var imageData = data.image;
    var base64String = imageData;
    if (imageData.includes(',')) {
      base64String = imageData.split(',')[1];
    }

    var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    var timezone = Session.getScriptTimeZone();
    var dateFolderName = Utilities.formatDate(createdAt, timezone, "yyyy-MM-dd");
    var dateFolder = getOrCreateFolder(rootFolder, dateFolderName);
    var originalFolder = getOrCreateFolder(dateFolder, 'Original');

    var fileName = data.fileName || (
      "IMG_" + Utilities.formatDate(createdAt, timezone, "yyyyMMdd_HHmmss_SSS") +
      "_" + photoId + ".png"
    );

    var bytes = Utilities.base64Decode(base64String);
    var blob = Utilities.newBlob(bytes, 'image/png', fileName);
    var file = originalFolder.createFile(blob);

    uploaded[photoId].originalFileId = file.getId();
    uploaded[photoId].originalUrl = file.getUrl();
    uploaded[photoId].originalName = file.getName();
    properties.setProperty(PHOTO_ID_PROPERTY, JSON.stringify(uploaded));

    return jsonResponse({
      success: true,
      duplicate: false,
      fileId: file.getId(),
      url: file.getUrl(),
      name: file.getName()
    });

  } catch (error) {
    return jsonResponse({ success: false, error: String(error) });
  }
}

function getOrCreateFolder(parent, name) {
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}