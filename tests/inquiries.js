// Action Taken / Supporting Documents UI flow against an in-memory fake backend.
// Run: npm i jsdom@24 && node tests/inquiries.js
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + (extra || ''))); };

const errors = [];
const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push((e.detail && e.detail.message) || e.message));
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
  beforeParse(w) { w.supabase = { createClient: () => fake }; w.XLSX = {}; w.alert = () => {}; w.confirm = () => true; w.open = (u) => { w.__opened = u; }; } });
const w = dom.window, $ = id => w.document.getElementById(id);
const post = (d) => w.dispatchEvent(new w.MessageEvent('message', { data: Object.assign({ source: 'dispatch-uploader' }, d), origin: 'https://n-abc-script.googleusercontent.com' }));

(async () => {
  await sleep(300);
  $('loginCnic').value = '1111111111111'; $('loginPw').value = 'secret123'; w.doLogin(); await sleep(1500);
  w.UPLOADER_URL = 'https://script.google.com/macros/s/AKfy/exec';
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

  // multi-file upload against inquiry 2
  w.uploadCaseDocs(db.dispatch_inquiries[1].id);
  const src = $('uploaderFrame').src; const nonce = /[?&]n=([^&]+)/.exec(src)[1];
  ok('uploader path is report/inquiry folder', decodeURIComponent(/path=([^&]+)/.exec(src)[1]) === 'Reports/Report_2026-0007/Inquiries/Inquiry_2/action_documents', src);
  post({ nonce, type: 'uploaded_many', email: 'a@gmail.com', folderId: 'f', failed: ['bad.exe'], files: [
    { id: 'g1', name: 'a.pdf', mimeType: 'application/pdf', size: 1000, webViewLink: 'https://drive.google.com/file/d/g1/view', path: 'Reports/Report_2026-0007/Inquiries/Inquiry_2/action_documents' },
    { id: 'g2', name: 'b.jpg', mimeType: 'image/jpeg', size: 2000, webViewLink: 'https://drive.google.com/file/d/g2/view', path: 'x' }] });
  await sleep(400);
  const inqDocs = db.dispatch_documents.filter(d => d.doc_kind === 'inquiry');
  ok('2 inquiry documents linked to inquiry 2 + report', inqDocs.length === 2 && inqDocs.every(d => d.inquiry_id === db.dispatch_inquiries[1].id && d.dispatch_id === 'd1'));

  // supporting docs tab
  w.caseTab('d'); w.uploadCaseDocs(null);
  const n2 = /[?&]n=([^&]+)/.exec($('uploaderFrame').src)[1];
  ok('supporting path', /Supporting_Documents/.test(decodeURIComponent($('uploaderFrame').src)));
  post({ nonce: n2, type: 'uploaded_many', email: 'a@gmail.com', folderId: 'f', files: [{ id: 'g3', name: 'c.png', mimeType: 'image/png', size: 500, webViewLink: 'https://drive.google.com/file/d/g3/view', path: 'p' }] });
  await sleep(400);
  ok('supporting doc stored with kind=supporting, no inquiry', db.dispatch_documents.some(d => d.doc_kind === 'supporting' && !d.inquiry_id));
  ok('supporting tab shows file with name', /c\.png/.test($('caseBody').textContent) && !/a\.pdf/.test($('caseBody').textContent));

  // wrong Google account is rejected
  w.uploadCaseDocs(null); const n3 = /[?&]n=([^&]+)/.exec($('uploaderFrame').src)[1]; const before = db.dispatch_documents.length;
  post({ nonce: n3, type: 'uploaded_many', email: 'other@gmail.com', folderId: 'f', files: [{ id: 'z', name: 'z.pdf', mimeType: 'application/pdf', size: 1, webViewLink: 'https://drive.google.com/x', path: 'p' }] }); await sleep(200);
  ok('upload from a different Google account is not recorded', db.dispatch_documents.length === before);
  // bad nonce rejected
  post({ nonce: 'nope', type: 'uploaded_many', email: 'a@gmail.com', folderId: 'f', files: [{ id: 'z' }] }); await sleep(100);
  ok('bad nonce ignored', db.dispatch_documents.length === before);

  w.caseTab('d'); await sleep(50);
  w.openDoc(db.dispatch_documents.find(d => d.doc_kind === 'supporting').id); ok('view opens drive link', /drive\.google\.com/.test(w.__opened || ''));
  db.dispatch_documents.push({ id: 'evil', dispatch_id: 'd1', doc_kind: 'supporting', status: 'active', file_name: 'e', drive_web_view_link: 'javascript:alert(1)', created_at: '2026-03-06T00:00:00Z' });
  w.reloadCase(); await sleep(200); w.__opened = ''; w.openDoc('evil'); ok('non-Drive link refused', !w.__opened);
  w.delDoc(db.dispatch_documents.find(d => d.doc_kind === 'supporting').id); await sleep(250);
  ok('delete document (soft)', db.dispatch_documents.find(d => d.file_name === 'c.png').status === 'deleted' && !/c\.png/.test($('caseBody').textContent));

  w.caseTab('a'); w.delInquiry(db.dispatch_inquiries[1].id); await sleep(250);
  ok('delete inquiry soft-deletes it and its docs; others remain', db.dispatch_inquiries[1].record_status === 'deleted' && db.dispatch_documents.filter(d => d.inquiry_id).every(d => d.status === 'deleted') && (($('caseBody').textContent.match(/Inquiry \d/g)) || []).length === 3);
  ok('main-attachment logic untouched (hasFile ignores supporting docs)', w._lastReportData[0].hasFile === false);
  ok('no script errors', errors.length === 0, JSON.stringify(errors));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('threw', e); process.exit(1); });
