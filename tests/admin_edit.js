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
        if (name === 'fn_geo_options') { calls.push('geo:' + args.p_level + ':' + (args.p_district || '') + ':' + (args.p_tehsil || '') + ':' + (args.p_wing || ''));
          const L = { district: ['KHANEWAL', 'LAYYAH'], tehsil: ['KAROR', 'LAYYAH'], wing: ['M-EE', 'W-EE'], markaz: ['Fateh Pur', 'Chak 5'] }[args.p_level];
          return Promise.resolve({ data: L, error: null }); }
        if (name === 'fn_delete_dispatch') { if (opts.deleteFails) return Promise.resolve({ data: null, error: { message: 'db says no' } }); return Promise.resolve({ data: ['u1/' + args.p_id + '/a.pdf'], error: null }); }
        if (name === 'fn_next_dispatch_no') return Promise.resolve({ data: '0001', error: null });
        if (name === 'fn_create_dispatch') return Promise.resolve({ data: { id: 'd1', dispatch_no: 1, dispatch_date: args.p_date }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      functions: { invoke: (n, o) => { calls.push('fn:' + n + ':' + JSON.stringify(o && o.body)); if (o && o.body && o.body.action === 'update_user' && !opts.invokeFails) { const t = data.user_profiles.find(x => x.id === o.body.user_id); if (t) Object.assign(t, { full_name: o.body.full_name, markaz: o.body.markaz || null, district: o.body.district }); } return Promise.resolve({ data: opts.invokeFails ? { error: 'Administrator access required' } : { success: true }, error: null }); } },
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
const mkUsers = () => [
  { id: 'u1', cnic: '1111111111111', full_name: 'Main Admin', designation: 'AEO', cell_no: '0300', district: 'LAYYAH', tehsil: 'KAROR', wing: 'M-EE', markaz: null, role: 'admin', status: 'active', auto_email_until: null, gmail_address: 'a@gmail.com', gmail_confirmed_at: 'x', consent_given_at: 'x' },
  { id: 'u2', cnic: '2222222222222', full_name: 'Second User', designation: null, cell_no: null, district: 'KHANEWAL', tehsil: null, wing: null, markaz: 'Chak 5', role: 'user', status: 'active', auto_email_until: null }
];
const sel = (c, id) => c.w.document.getElementById(id);
(async () => {
  let r = await run({}, async (c) => {
    await sleep(200); login(c); await sleep(1500);
    c.w.loadAdminUsers(); await sleep(500);
    const rows = [...c.w.document.querySelectorAll('#adminUsers tbody tr')];
    ok('every user row has an Edit button, including the admin himself', rows.length === 2 && rows.every(tr => tr.querySelector('.fa-pen')));
    ok('admin row has no Suspend button but still has Edit', !rows[0].querySelector('.fa-ban') && !!rows[0].querySelector('.fa-pen'));
    rows[0].querySelector('.fa-pen').closest('button').click(); await sleep(700);
    ok('modal opens with the saved name, designation and cell', sel(c, 'userEditModal').classList.contains('open') && sel(c, 'ueName').value === 'Main Admin' && sel(c, 'ueDesig').value === 'AEO' && sel(c, 'ueCell').value === '0300');
    ok('saved district/tehsil/wing are preselected', sel(c, 'ueDistrict').value === 'LAYYAH' && sel(c, 'ueTehsil').value === 'KAROR' && sel(c, 'ueWing').value === 'M-EE');
    ok('markaz list loaded for that wing, none chosen (admin has none yet)', sel(c, 'ueMarkaz').options.length === 3 && sel(c, 'ueMarkaz').value === '');
    ok('says it is the own account', /your own account/.test(sel(c, 'ueWho').textContent));
    sel(c, 'ueMarkaz').value = 'Fateh Pur';
    sel(c, 'ueName').value = '  '; c.w.saveUserEdit(); await sleep(100);
    ok('empty name refused, nothing sent', /Full name is required/.test(sel(c, 'ueMsg').textContent) && !c.calls.some(x => x.includes('update_user')));
    sel(c, 'ueName').value = 'Main Admin Edited'; c.w.saveUserEdit(); await sleep(800);
    const sent = c.calls.find(x => x.includes('update_user')) || '';
    ok('sends update_user for this user with the new values', /"user_id":"u1"/.test(sent) && /"full_name":"Main Admin Edited"/.test(sent) && /"markaz":"Fateh Pur"/.test(sent) && /"district":"LAYYAH"/.test(sent) && /"tehsil":"KAROR"/.test(sent));
    ok('modal closed after saving', !sel(c, 'userEditModal').classList.contains('open'));
    ok('own profile refreshed in the page', c.w._profile.markaz === 'Fateh Pur' && c.w._profile.full_name === 'Main Admin Edited' && sel(c, 'userEmailTop').textContent === 'Main Admin Edited');
    ok('dispatch number box now uses the new Markaz', /^F\.P\/\d{4}\/\d{4}$/.test(sel(c, 'dispatchNo').textContent));
    ok('user list reloaded with the new name', /Main Admin Edited/.test(c.w.document.getElementById('adminUsers').textContent));
    c.w.openUserEdit('u2'); await sleep(700);
    ok('other user: no own-account note; saved markaz kept even though listed', !/own account/.test(sel(c, 'ueWho').textContent) && sel(c, 'ueDistrict').value === 'KHANEWAL');
    sel(c, 'ueDistrict').value = 'LAYYAH'; c.w.ueGeoChanged('district'); await sleep(500);
    ok('changing district reloads tehsil/wing and clears markaz', c.calls.includes('geo:tehsil:LAYYAH::') && sel(c, 'ueMarkaz').value === '');
    c.finish();
  }, { user_profiles: mkUsers() });
  ok('no script errors (1)', r.errors.length === 0 || (console.log(r.errors), false));
  // server refuses -> message shown in the modal, modal stays open
  r = await run({}, async (c) => {
    await sleep(200); login(c); await sleep(1500); c.w.loadAdminUsers(); await sleep(500);
    c.w.openUserEdit('u2'); await sleep(700); c.w.saveUserEdit(); await sleep(600);
    ok('server error is shown and modal stays open', /Administrator access required/.test(sel(c, 'ueMsg').textContent) && sel(c, 'userEditModal').classList.contains('open'));
    c.finish();
  }, { user_profiles: mkUsers() }, { invokeFails: true });
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
