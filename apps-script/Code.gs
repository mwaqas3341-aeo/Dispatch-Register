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
    mode:    p.mode === 'connect' ? 'connect' : 'upload',
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
