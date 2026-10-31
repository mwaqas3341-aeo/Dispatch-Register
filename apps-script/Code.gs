/**
 * Dispatch Register - Drive uploader.
 * Deployed as a web app that runs AS THE USER who opens it, so every file
 * lands in that user's own Google Drive. It holds no data and no secrets.
 * Scope: drive.file only (the app can see only files/folders it created).
 */
var ALLOWED_ORIGIN = 'https://mwaqas3341-aeo.github.io';   // the site that embeds this page
var FOLDER_NAME    = 'Dispatch Register Files';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var params = {
    mode:    p.mode === 'connect' ? 'connect' : (p.mode === 'docs' ? 'docs' : 'upload'),
    path:    cleanPath_(p.path),
    label:   String(p.label || '').replace(/[^A-Za-z0-9 #._-]/g, '').slice(0, 40),
    nonce:   String(p.n || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40),
    allowed: ALLOWED_ORIGIN
  };
  var t = HtmlService.createTemplateFromFile('Uploader');
  t.params = JSON.stringify(params);
  return t.evaluate()
    .setTitle('Dispatch Register - Google Drive')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** "Reports/Report_2026-0007/Supporting_Documents" -> sanitized array of up to 6 folder names. */
function cleanPath_(s) {
  return String(s || '').split('/').map(function (x) { return x.replace(/[^A-Za-z0-9_.-]/g, ''); })
    .filter(function (x) { return x && x !== '.' && x !== '..'; }).slice(0, 6);
}

function subFolder_(parentId, name) {
  var q = "mimeType='application/vnd.google-apps.folder' and name='" + name + "' and '" + parentId + "' in parents and trashed=false";
  var res = Drive.Files.list({ q: q, fields: 'files(id)', pageSize: 1 });
  if (res.files && res.files.length) return res.files[0].id;
  return Drive.Files.create({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }).id;
}

/** True only if the bytes really are a PDF, JPEG or PNG (extension/MIME claims are not trusted). */
function sniffType_(bytes) {
  function b(i) { return (bytes[i] + 256) % 256; }
  if (bytes.length > 4 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return 'application/pdf';
  if (bytes.length > 3 && b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'image/jpeg';
  if (bytes.length > 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'image/png';
  return null;
}

/** Saves a validated PDF/JPG/PNG into <root>/<path...> in the user's Drive. Folders are created on demand. */
function uploadDoc(b64, name, path) {
  var bytes = Utilities.base64Decode(b64);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB.');
  var mime = sniffType_(bytes);
  if (!mime) throw new Error('Only PDF, JPG and PNG files are allowed.');
  var parts = cleanPath_(path.join ? path.join('/') : path);
  if (!parts.length) throw new Error('Missing folder.');
  var folderId = ensureFolder_();
  parts.forEach(function (n) { folderId = subFolder_(folderId, n); });
  var ext   = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime];
  var base  = String(name || 'file').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9 _-]+/g, '_').slice(0, 60) || 'file';
  var stamp = Utilities.formatDate(new Date(), 'Asia/Karachi', 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000);
  var fname = stamp + '_' + base + ext;
  var f = Drive.Files.create({ name: fname, parents: [folderId] }, Utilities.newBlob(bytes, mime, fname),
                             { fields: 'id,name,mimeType,size,webViewLink' });
  return { email: Session.getActiveUser().getEmail(), folderId: ensureFolder_(), id: f.id, name: name, storedName: f.name,
           mimeType: f.mimeType, size: f.size, webViewLink: f.webViewLink, path: parts.join('/') };
}

function ensureFolder_() {
  var q = "mimeType='application/vnd.google-apps.folder' and name='" + FOLDER_NAME + "' and trashed=false";
  var res = Drive.Files.list({ q: q, fields: 'files(id)', pageSize: 1 });
  if (res.files && res.files.length) return res.files[0].id;
  return Drive.Files.create({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }).id;
}

/** Called once: authorizes, creates the folder, reports which Google account is in use. */
function connect() {
  return { email: Session.getActiveUser().getEmail(), folderId: ensureFolder_() };
}

/** Saves one file into the user's own Drive folder. */
function uploadFile(b64, name, mime) {
  var folderId = ensureFolder_();
  var safe  = String(name || 'file').replace(/[\\\/:*?"<>|]+/g, '_').slice(-120);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Karachi', 'yyyyMMdd_HHmmss');
  var blob  = Utilities.newBlob(Utilities.base64Decode(b64), mime || 'application/octet-stream', stamp + '_' + safe);
  var f = Drive.Files.create({ name: stamp + '_' + safe, parents: [folderId] }, blob,
                             { fields: 'id,name,mimeType,size,webViewLink' });
  return { email: Session.getActiveUser().getEmail(), folderId: folderId,
           id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, webViewLink: f.webViewLink };
}
