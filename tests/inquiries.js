// Action Taken / Supporting Documents UI flow against an in-memory fake backend.
// Run: npm i jsdom@24 && node tests/inquiries.js
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + (extra || ''))); };

const errors = [];
const vc = new VirtualConsole(); vc.on('jsdomError', e => !/navigation/.test(e.message) && errors.push((e.detail && e.detail.message) || e.message));
const profile = { id: 'u1', cnic: '1111111111111', full_name: 'Test User', district: 'LAYYAH', tehsil: 'T1', wing: 'W-EE', role: 'user',
  status: 'active', must_change_password: false, gmail_address: 'a@gmail.com', gmail_confirmed_at: 'x', consent_given_at: 'x', drive_folder_id: 'f' };
const db = { user_profiles: [profile], app_config: [], recipients: [], schools: [], dispatch_recipients: [],
  dispatch_register: [{ id: 'd1', dispatch_date: '2026-03-05', dispatch_no: 7, category: 'Complaint', subject: 'S', status: 'active', dispatch_recipients: [], dispatch_documents: [] }],
  dispatch_inquiries: [], dispatch_documents: [] };
let seq = 0;
function builder(table) {
  const f = []; let rows = null, ins = null;
  const b = {};
  b.select = () => b; b.limit = () => b; b.order = () => b;
  b.eq = (k, v) => { f.push(r => r[k] === v); return b; };
  b.in = (k, v) => { f.push(r => v.includes(r[k])); return b; };
  b.gte = b.lte = () => b;
  b.insert = (x) => { ins = [].concat(x).map(r => Object.assign({ id: 'x' + (++seq), status: 'active', created_at: '2026-03-06T00:00:00Z' }, r)); db[table].push(...ins); return b; };
  b.maybeSingle = () => Promise.resolve({ data: (db[table] || [])[0] || null, error: null });
  b.then = (res, rej) => Promise.resolve({ data: ins ? ins : (db[table] || []).filter(r => f.every(fn => fn(r))), error: null }).then(res, rej);
  return b;
}
let signedIn = false;
const fake = {
  auth: { getSession: () => Promise.resolve({ data: { session: signedIn ? { user: { id: 'u1' } } : null } }), getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }),
    signInWithPassword: () => { signedIn = true; return Promise.resolve({ data: {}, error: null }); }, signOut: () => Promise.resolve({}), refreshSession: () => Promise.resolve({}) },
  from: builder,
  rpc: (name, a) => {
    if (name === 'fn_add_inquiry') {
      const n = db.dispatch_inquiries.filter(q => q.dispatch_id === a.p_dispatch_id).length + 1;
      const row = { id: 'q' + (++seq), dispatch_id: a.p_dispatch_id, inquiry_no: n, authority: a.p_authority, action_details: a.p_details, action_date: a.p_date,
        action_status: a.p_status || 'pending', remarks: a.p_remarks || null, record_status: 'active' };
      db.dispatch_inquiries.push(row); return Promise.resolve({ data: row, error: null });
    }
    if (name === 'fn_update_inquiry') { const q = db.dispatch_inquiries.find(x => x.id === a.p_id); Object.assign(q, { authority: a.p_authority, action_details: a.p_details, action_date: a.p_date, action_status: a.p_status, remarks: a.p_remarks }); return Promise.resolve({ data: q, error: null }); }
    if (name === 'fn_delete_inquiry') { db.dispatch_inquiries.find(x => x.id === a.p_id).record_status = 'deleted'; db.dispatch_documents.forEach(d => { if (d.inquiry_id === a.p_id) d.status = 'deleted'; }); return Promise.resolve({ data: null, error: null }); }
    if (name === 'fn_delete_document') { db.dispatch_documents.find(x => x.id === a.p_id).status = 'deleted'; return Promise.resolve({ data: null, error: null }); }
    return Promise.resolve({ data: null, error: null });
  },
  functions: { invoke: () => Promise.resolve({ data: {}, error: null }) }, storage: {}
};
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://mwaqas3341-aeo.github.io/Dispatch-Register/',
  beforeParse(w) { w.supabase = { createClient: () => fake }; w.XLSX = {}; w.alert = () => {}; w.confirm = () => true; w.open = (u) => { w.__opened = u; return { location: {}, close() {} }; }; } });
const w = dom.window, $ = id => w.document.getElementById(id);
const post = (d) => w.dispatchEvent(new w.MessageEvent('message', { data: Object.assign({ source: 'dispatch-uploader' }, d), origin: 'https://n-abc-script.googleusercontent.com' }));

(async () => {
  await sleep(300);
  $('loginCnic').value = '1111111111111'; $('loginPw').value = 'secret123'; w.doLogin(); await sleep(1500);
  w.loadReports(); await sleep(300);
  ok('report row has Action Taken button', !!w.document.querySelector('#reportSection button[title="Action Taken & Documents"]'));
  w.openCase('d1'); await sleep(300);
  ok('case modal opens, empty state', $('caseModal').classList.contains('open') && /No action recorded/.test($('caseBody').textContent));

  for (const [a, dt] of [['DEO Layyah', '2026-03-10'], ['Director Inquiries', '2026-04-02'], ['CEO', '2026-05-01'], ['Secretary', '2026-05-09']]) {
    w.openInquiryForm(); $('inqAuth').value = a; $('inqDetails').value = 'Action by ' + a; $('inqDate').value = dt; w.saveInquiry(); await sleep(250);
  }
  ok('4 inquiries recorded for ONE report with Inquiry 1..4', db.dispatch_inquiries.map(q => q.inquiry_no).join() === '1,2,3,4');
  ok('timeline lists all four', (($('caseBody').textContent.match(/Inquiry \d/g)) || []).length === 4);
  w.openInquiryForm(); $('inqAuth').value = ''; w.saveInquiry(); await sleep(100);
  ok('validation blocks empty authority', /required/.test($('inqMsg').textContent) && db.dispatch_inquiries.length === 4);

  w.openInquiryForm(db.dispatch_inquiries[1].id); $('inqStatus').value = 'completed'; w.saveInquiry(); await sleep(250);
  ok('edit inquiry', db.dispatch_inquiries[1].action_status === 'completed' && /Completed/.test($('caseBody').textContent));

  // uploads go through the Edge Function client (stubbed here); verify what the UI sends
  const sent = []; const calls = [];
  w.driveUpload = (file, meta, prog) => { const bad = w._checkFile(file); if (bad) return Promise.reject(new Error(bad)); sent.push(meta); prog && prog(100);
    const d = { id: 'doc' + sent.length, dispatch_id: meta.dispatch_id, inquiry_id: meta.inquiry_id || null, doc_kind: meta.kind, file_name: file.name, mime_type: file.type, file_size: file.size, status: 'active', created_at: '2026-03-06T00:00:00Z' };
    db.dispatch_documents.push(d); return Promise.resolve(d); };
  w.driveJson = (a, b) => { calls.push([a, b]); if (a === 'delete') db.dispatch_documents.find(x => x.id === b.id).status = 'deleted'; return Promise.resolve({ success: true }); };
  w.driveCall = (a, b) => { calls.push([a, b]); return Promise.resolve({ ok: true, blob: () => Promise.resolve(new w.Blob(['x'])) }); };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  const pickQueue = []; w._pickFiles = (m, cb) => cb(pickQueue.shift());
  const mk = (n, t, size = 100) => { const f = new w.File(['x'.repeat(Math.min(size, 50))], n, { type: t }); Object.defineProperty(f, 'size', { value: size }); return f; };

  ok('client rejects .exe', !!w._checkFile(mk('a.exe', 'application/octet-stream')));
  ok('client rejects >10MB', /10 MB/.test(w._checkFile(mk('a.pdf', 'application/pdf', 11 * 1024 * 1024))));
  ok('client accepts pdf/jpg/jpeg/png', ['a.pdf', 'b.JPG', 'c.jpeg', 'd.png'].every(n => !w._checkFile(mk(n, n.endsWith('pdf') ? 'application/pdf' : 'image/jpeg'))));

  pickQueue.push([mk('a.pdf', 'application/pdf'), mk('b.jpg', 'image/jpeg'), mk('bad.exe', 'application/x-msdownload')]);
  w.uploadCaseDocs(db.dispatch_inquiries[1].id); await sleep(500);
  const inqDocs = db.dispatch_documents.filter(d => d.doc_kind === 'inquiry');
  ok('batch to inquiry 2: valid files uploaded, invalid one reported, all linked to inquiry + report', inqDocs.length === 2 && inqDocs.every(d => d.inquiry_id === db.dispatch_inquiries[1].id && d.dispatch_id === 'd1'));

  w.caseTab('d'); pickQueue.push([mk('c.png', 'image/png')]); w.uploadCaseDocs(null); await sleep(400);
  ok('supporting doc uploaded with kind=supporting and no inquiry', db.dispatch_documents.some(d => d.doc_kind === 'supporting' && !d.inquiry_id));
  ok('supporting tab shows file, uploader name, and not inquiry files', /c\.png/.test($('caseBody').textContent) && /Test User/.test($('caseBody').textContent) && !/a\.pdf/.test($('caseBody').textContent));

  w.openDoc(db.dispatch_documents.find(d => d.doc_kind === 'supporting').id, false); await sleep(100);
  ok('view goes through the backend (no public Drive link)', calls.some(c => c[0] === 'file' && c[1].download === false));
  w.openDoc(db.dispatch_documents.find(d => d.doc_kind === 'supporting').id, true); await sleep(100);
  ok('download goes through the backend', calls.some(c => c[0] === 'file' && c[1].download === true));
  w.delDoc(db.dispatch_documents.find(d => d.doc_kind === 'supporting').id); await sleep(300);
  ok('delete document calls backend and refreshes list', calls.some(c => c[0] === 'delete') && !/c\.png/.test($('caseBody').textContent));
  ok('no Google Apps Script left in the page', !/script\.google\.com|UPLOADER_URL|openUploader/.test(html));

  w.caseTab('a'); w.delInquiry(db.dispatch_inquiries[1].id); await sleep(250);
  ok('delete inquiry soft-deletes it and its docs; others remain', db.dispatch_inquiries[1].record_status === 'deleted' && db.dispatch_documents.filter(d => d.inquiry_id).every(d => d.status === 'deleted') && (($('caseBody').textContent.match(/Inquiry \d/g)) || []).length === 3);
  ok('main-attachment logic untouched (hasFile ignores supporting docs)', w._lastReportData[0].hasFile === false);
  ok('no script errors', errors.length === 0, JSON.stringify(errors));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('threw', e); process.exit(1); });
