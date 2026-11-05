const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('' + __dirname + '/../index.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function run(profileOverrides, steps, dataOv, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const errors = [], calls = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push('jsdomError: ' + ((e.detail && e.detail.message) || e.message)));
    const profile = Object.assign({ id: 'u1', cnic: '1111111111111', full_name: 'Test User', district: 'LAYYAH', tehsil: 'T1', wing: 'W-EE',
      role: 'user', markaz: 'Fateh Pur', status: 'active', must_change_password: false, gmail_address: 'a@gmail.com', gmail_confirmed_at: 'x', consent_given_at: 'x', drive_folder_id: 'f' }, profileOverrides);
    const data = {
      user_profiles: [profile],
      app_config: [{ key: 'school_types', value: 'Govt,Private' }, { key: 'emis_school_type', value: 'Govt' }, { key: 'org_name', value: 'Org' }],
      recipients: [{ id: 'r1', owner_id: 'u1', office_name: 'DEO Layyah', officer_name: 'X', email_office: 'a@b.c', scope_level: 'district', is_active: true }],
      dispatch_register: [], dispatch_recipients: [], schools: [{ name: 'GPS Test' }]
    };
    Object.assign(data, dataOv || {});
    let signedIn = false;
    function builder(table) {
      const b = {};
      ['select','eq','gte','lte','order','limit','insert','update','upsert','neq'].forEach(m => b[m] = () => b);
      b.maybeSingle = () => Promise.resolve({ data: (data[table] || [])[0] || null, error: null });
      b.then = (res, rej) => Promise.resolve({ data: data[table] || [], count: (data[table] || []).length, error: null }).then(res, rej);
      return b;
    }
    const fake = {
      auth: {
        getSession: () => Promise.resolve({ data: { session: signedIn ? { access_token: 'tok', user: { id: 'u1' } } : null } }),
        getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }),
        signInWithPassword: (c) => { calls.push('login:' + c.email); signedIn = true; return Promise.resolve({ data: {}, error: null }); },
        signOut: () => { signedIn = false; return Promise.resolve({}); },
        refreshSession: () => Promise.resolve({})
      },
      from: builder,
      rpc: (name, args) => {
        calls.push('rpc:' + name + ':' + JSON.stringify(args));
        if (name === 'fn_my_drive_connection') return Promise.resolve({ data: [], error: null });
        if (name === 'fn_update_my_profile') {
          if (opts.profileFails) return Promise.resolve({ data: null, error: { message: 'Prefix may use letters, digits, dot and dash only (max 12 characters)' } });
          const me = data.user_profiles[0];
          Object.assign(me, { full_name: args.p_full_name, cell_no: args.p_cell_no || null, gmail_address: args.p_gmail, ref_prefix: args.p_ref_prefix || null, ref_pad: args.p_ref_pad });
          return Promise.resolve({ data: Object.assign({}, me), error: null });
        }
        if (name === 'fn_delete_dispatch') { if (opts.deleteFails) return Promise.resolve({ data: null, error: { message: 'db says no' } }); return Promise.resolve({ data: ['u1/' + args.p_id + '/a.pdf'], error: null }); }
        if (name === 'fn_next_dispatch_no') return Promise.resolve({ data: '0001', error: null });
        if (name === 'fn_create_dispatch') return Promise.resolve({ data: { id: 'd1', dispatch_no: 1, dispatch_date: args.p_date }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      functions: { invoke: (n) => { calls.push('fn:' + n); return Promise.resolve({ data: { success: true }, error: null }); } },
      storage: { from: (b) => ({ remove: (p) => { calls.push('blob-remove:' + p.join(',')); return Promise.resolve({ data: [], error: null }); } }) }
    };
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      url: 'https://mwaqas3341-aeo.github.io/Dispatch-Register/',
      beforeParse(w) { w.fetch = (url, o) => { calls.push('fetch:' + String(url).split('/').pop() + ':' + (o && o.body)); return Promise.resolve({ ok: !opts.driveFails, status: opts.driveFails ? 502 : 200, json: () => Promise.resolve(opts.driveFails ? { error: 'Drive down' } : {}) }); }; w.supabase = { createClient: () => fake }; w.XLSX = {}; w.alert = () => {}; w.confirm = () => true; } });
    const w = dom.window;
    const vis = id => { const e = w.document.getElementById(id); return !!e && e.style.display !== 'none'; };
    const finish = () => { resolve({ errors, calls }); try { w.close(); } catch (e) {} };
    setTimeout(() => { errors.push('TIMEOUT'); finish(); }, 15000);
    Promise.resolve(steps({ w, vis, calls, errors, finish })).catch(e => { errors.push('test threw: ' + (e && e.stack || e)); finish(); });
  });
}
const login = (c) => { c.w.document.getElementById('loginCnic').value = '1111111111111'; c.w.document.getElementById('loginPw').value = 'secret123'; c.w.doLogin(); };

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const yr = new Date().getFullYear();
const el = (c, id) => c.w.document.getElementById(id);
const recs = [{ id: 'd1', dispatch_date: '2026-11-01', dispatch_no: 12, markaz_prefix: 'F.P', category: 'Complaint', subject: 'S1', dispatch_recipients: [{ name_snapshot: 'DEO' }], dispatch_documents: [] }];
const prof = { cell_no: '03001234567', gmail_address: 'old@gmail.com', designation: 'AEO', ref_prefix: null, ref_pad: 4 };
const fill = (c, o) => { Object.keys(o).forEach(k => { el(c, k).value = o[k]; }); };
(async () => {
  let r = await run(prof, async (c) => {
    await sleep(200); login(c); await sleep(1500);
    c.w.openProfile(); await sleep(100);
    ok('profile window opens prefilled', el(c, 'profileModal').classList.contains('open') && el(c, 'pfName').value === 'Test User' && el(c, 'pfCell').value === '03001234567' && el(c, 'pfGmail').value === 'old@gmail.com' && el(c, 'pfPad').value === '4');
    ok('prefix box suggests the Markaz initials and preview matches', el(c, 'pfPrefix').placeholder === 'F.P' && el(c, 'pfPreview').textContent === 'F.P/0012/' + yr);
    fill(c, { pfPrefix: 'fp-1', pfPad: '6' }); c.w.profPreview();
    ok('preview follows prefix (upper-cased) and digits', el(c, 'pfPreview').textContent === 'FP-1/000012/' + yr);
    // validation: nothing is sent
    const bad = [[{ pfName: ' ' }, /Full name/], [{ pfName: 'X', pfCell: 'abc' }, /Cell number/], [{ pfCell: '03001234567', pfGmail: 'a@yahoo.com' }, /valid Gmail/], [{ pfGmail: 'old@gmail.com', pfPrefix: 'A/B' }, /Prefix/]];
    let allBlocked = true;
    for (const [vals, re] of bad) { fill(c, vals); c.w.saveProfile(); await sleep(50); if (!re.test(el(c, 'pfMsg').textContent)) { allBlocked = false; console.log('  not blocked:', JSON.stringify(vals), '->', JSON.stringify(el(c, 'pfMsg').textContent)); } }
    ok('bad name / cell / Gmail / prefix are refused with a message', allBlocked && !c.calls.some(x => x.startsWith('rpc:fn_update_my_profile')));
    // save without changing Gmail: no Drive warning
    let asked = []; c.w.confirm = (m) => { asked.push(m); return true; };
    fill(c, { pfName: 'Ali Raza', pfCell: '0301 1234567', pfGmail: 'OLD@gmail.com', pfPrefix: 'fp-1', pfPad: '6' }); c.w.saveProfile(); await sleep(700);
    const sent = c.calls.find(x => x.startsWith('rpc:fn_update_my_profile')) || '';
    ok('saves own details; Gmail unchanged so no warning', asked.length === 0 && /"p_full_name":"Ali Raza"/.test(sent) && /"p_cell_no":"0301 1234567"/.test(sent) && /"p_gmail":"old@gmail.com"/.test(sent) && /"p_ref_prefix":"FP-1"/.test(sent) && /"p_ref_pad":6/.test(sent));
    ok('window closes, header and profile refreshed', !el(c, 'profileModal').classList.contains('open') && el(c, 'userEmailTop').textContent === 'Ali Raza' && c.w._profile.ref_pad === 6);
    ok('Drive window NOT opened when Gmail is unchanged', !el(c, 'driveModal').classList.contains('open'));
    c.w.loadReports(); await sleep(500);
    ok('report numbers now shown in the chosen format', c.w.document.querySelector('#reportSection tbody tr').children[2].textContent === 'FP-1/000012/2026');
    ok('next-number box uses the chosen format', /^FP-1\/\d{6}\/\d{4}$/.test(el(c, 'dispatchNo').textContent));
    ok('Drive folder name still uses the fixed 4-digit number', c.w._reportFolder({ isoDate: '2026-11-01', dispatchNo: c.w.fmtNo(12) }) === 'Report_2026-0012');
    // clearing the prefix goes back to the stored / Markaz prefix
    c.w.openProfile(); fill(c, { pfPrefix: '', pfPad: '3' }); c.w.saveProfile(); await sleep(600); c.w.loadReports(); await sleep(500);
    ok('blank prefix falls back to the Markaz initials; 3 digits', c.w.document.querySelector('#reportSection tbody tr').children[2].textContent === 'F.P/012/2026');
    // Gmail change: warning, decline, then accept
    c.w.openProfile(); fill(c, { pfGmail: 'New.Person@gmail.com' });
    asked = []; c.w.confirm = (m) => { asked.push(m); return false; };
    const before = c.calls.filter(x => x.startsWith('rpc:fn_update_my_profile')).length;
    c.w.saveProfile(); await sleep(300);
    ok('Gmail change warns about Drive and asks first', /new\.person@gmail\.com/.test(asked[0] || '') && /Google Drive/.test(asked[0] || '') && /old Google Drive/.test(asked[0] || ''));
    ok('declining the warning saves nothing', c.calls.filter(x => x.startsWith('rpc:fn_update_my_profile')).length === before && el(c, 'profileModal').classList.contains('open'));
    c.w.confirm = () => true; c.w.saveProfile(); await sleep(800);
    ok('accepting saves the new Gmail (lower-cased) and opens the Drive connection window', c.calls.some(x => /"p_gmail":"new\.person@gmail\.com"/.test(x)) && el(c, 'driveModal').classList.contains('open') && c.w._profile.gmail_address === 'new.person@gmail.com');
    // password
    c.w.openProfile(); c.w.document.querySelector('#profileModal button.btn-out i.fa-key').closest('button').click(); await sleep(100);
    ok('Change password button leads to the password window', !el(c, 'profileModal').classList.contains('open') && el(c, 'pwModal').classList.contains('open'));
    c.finish();
  }, { dispatch_register: recs });
  ok('no script errors (1)', r.errors.length === 0 || (console.log(r.errors), false));
  r = await run(prof, async (c) => {
    await sleep(200); login(c); await sleep(1500); c.w.openProfile(); c.w.saveProfile(); await sleep(600);
    ok('server error is shown and the window stays open', /Prefix may use letters/.test(el(c, 'pfMsg').textContent) && el(c, 'profileModal').classList.contains('open') && !el(c, 'pfSave').disabled);
    c.finish();
  }, { dispatch_register: recs }, { profileFails: true });
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
