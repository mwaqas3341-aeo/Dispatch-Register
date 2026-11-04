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
const recs = [
  { id: 'd1', dispatch_date: '2026-11-01', dispatch_no: 12, markaz_prefix: 'F.P', category: 'Complaint', subject: 'S1', dispatch_recipients: [{ name_snapshot: 'DEO Layyah' }], dispatch_documents: [] },
  { id: 'd2', dispatch_date: '2025-03-02', dispatch_no: 7, markaz_prefix: null, category: 'Transfer', subject: 'S2', dispatch_recipients: [], dispatch_documents: [] }
];
const docs = [{ id: 'doc1', dispatch_id: 'd1', source: 'user_drive', status: 'active' }, { id: 'doc2', dispatch_id: 'd1', source: 'legacy_url', status: 'active' }];
(async () => {
  let r = await run({}, async (c) => {
    await sleep(200); login(c); await sleep(1500);
    ok('number box shows MARKAZ/NO/YEAR', /^F\.P\/\d{4}\/\d{4}$/.test(c.w.document.getElementById('dispatchNo').textContent));
    c.w.document.getElementById('reportDate').value = '2024-05-01'; c.w.document.getElementById('reportDate').dispatchEvent(new c.w.Event('change')); await sleep(300);
    ok('previous-year date asks the database for that year', c.calls.some(x => x.startsWith('rpc:fn_next_dispatch_no:{"p_date":"2024-01-01"')) && /\/2024$/.test(c.w.document.getElementById('dispatchNo').textContent));
    c.w.loadReports(); await sleep(400);
    const cells = [...c.w.document.querySelectorAll('#reportSection tbody tr')].map(tr => tr.children[2].textContent);
    ok('report rows: stored prefix / fallback to own markaz', cells[0] === 'F.P/0012/2026' && cells[1] === 'F.P/0007/2025');
    ok('plain number kept for Drive folder names', c.w._reportFolder({ isoDate: '2026-11-01', dispatchNo: '0012' }) === 'Report_2026-0012');
    ok('markazPrefix rule', c.w.markazPrefix('Fateh Pur') === 'F.P' && c.w.markazPrefix('kot sultan') === 'K.S' && c.w.markazPrefix('') === '');
    ok('Deleted list / Restore UI removed', !c.w.document.getElementById('btnShowDel') && !c.w.document.getElementById('deletedSection') && typeof c.w.restoreRec === 'undefined');
    let asked = []; c.w.confirm = (m) => { asked.push(m); return true; };
    c.w.delReport('d1'); await sleep(700);
    ok('delete warns it is permanent and names F.P/0012/2026', /Permanently delete dispatch F\.P\/0012\/2026/.test(asked[0] || '') && /cannot be undone/.test(asked[0] || ''));
    ok('Drive file trashed first (only the Drive document)', c.calls.some(x => x.startsWith('fetch:drive?a=delete') || x.includes('a=delete:{"id":"doc1"')) && !c.calls.some(x => x.includes('"id":"doc2"')));
    const iDrive = c.calls.findIndex(x => x.includes('a=delete')), iRpc = c.calls.findIndex(x => x.startsWith('rpc:fn_delete_dispatch'));
    ok('database delete happens after Drive delete', iDrive >= 0 && iRpc > iDrive);
    ok('action-file blobs removed + next number refreshed', c.calls.includes('blob-remove:u1/d1/a.pdf') && c.calls.filter(x => x.startsWith('rpc:fn_next_dispatch_no')).length >= 3);
    c.finish();
  }, { dispatch_register: recs, dispatch_documents: docs });
  ok('no script errors (1)', r.errors.length === 0 || (console.log(r.errors), false));
  // Drive failure: user declines -> nothing deleted; user accepts -> record still deleted
  for (const accept of [false, true]) {
    r = await run({}, async (c) => {
      await sleep(200); login(c); await sleep(1500); c.w.loadReports(); await sleep(400);
      const q = []; c.w.confirm = (m) => { q.push(m); return q.length === 1 ? true : accept; };
      c.w.delReport('d1'); await sleep(900);
      const deleted = c.calls.some(x => x.startsWith('rpc:fn_delete_dispatch'));
      ok('Drive failure, user ' + (accept ? 'accepts' : 'declines') + ' -> record ' + (accept ? 'deleted' : 'kept'), q.length === 2 && /Drive could not remove 1 file/.test(q[1]) && deleted === accept);
      c.finish();
    }, { dispatch_register: recs, dispatch_documents: docs }, { driveFails: true });
  }
  // database refuses -> error toast, nothing else
  r = await run({}, async (c) => {
    await sleep(200); login(c); await sleep(1500); c.w.loadReports(); await sleep(400);
    c.w.confirm = () => true; c.w.delReport('d2'); await sleep(600);
    ok('database error is shown to the user', /db says no/.test(c.w.document.getElementById('toast').textContent));
    c.finish();
  }, { dispatch_register: recs, dispatch_documents: [] }, { deleteFails: true });
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
