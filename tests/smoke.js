const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('' + __dirname + '/../index.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function run(profileOverrides, steps) {
  return new Promise((resolve) => {
    const errors = [], calls = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push('jsdomError: ' + ((e.detail && e.detail.message) || e.message)));
    const profile = Object.assign({ id: 'u1', cnic: '1111111111111', full_name: 'Test User', district: 'LAYYAH', tehsil: 'T1', wing: 'W-EE',
      role: 'user', status: 'active', must_change_password: false, gmail_address: 'a@gmail.com', gmail_confirmed_at: 'x', consent_given_at: 'x', drive_folder_id: 'f' }, profileOverrides);
    const data = {
      user_profiles: [profile],
      app_config: [{ key: 'school_types', value: 'Govt,Private' }, { key: 'emis_school_type', value: 'Govt' }, { key: 'org_name', value: 'Org' }],
      recipients: [{ id: 'r1', owner_id: 'u1', office_name: 'DEO Layyah', officer_name: 'X', email_office: 'a@b.c', scope_level: 'district', is_active: true }],
      dispatch_register: [], dispatch_recipients: [], schools: [{ name: 'GPS Test' }]
    };
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
        getSession: () => Promise.resolve({ data: { session: signedIn ? { user: { id: 'u1' } } : null } }),
        getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }),
        signInWithPassword: (c) => { calls.push('login:' + c.email); signedIn = true; return Promise.resolve({ data: {}, error: null }); },
        signOut: () => { signedIn = false; return Promise.resolve({}); },
        refreshSession: () => Promise.resolve({})
      },
      from: builder,
      rpc: (name, args) => {
        calls.push('rpc:' + name + ':' + JSON.stringify(args));
        if (name === 'fn_next_dispatch_no') return Promise.resolve({ data: '0001', error: null });
        if (name === 'fn_create_dispatch') return Promise.resolve({ data: { id: 'd1', dispatch_no: 1, dispatch_date: args.p_date }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      functions: { invoke: (n) => { calls.push('fn:' + n); return Promise.resolve({ data: { success: true }, error: null }); } },
      storage: {}
    };
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      url: 'https://mwaqas3341-aeo.github.io/Dispatch-Register/',
      beforeParse(w) { w.supabase = { createClient: () => fake }; w.XLSX = {}; w.alert = () => {}; w.confirm = () => true; } });
    const w = dom.window;
    const vis = id => { const e = w.document.getElementById(id); return !!e && e.style.display !== 'none'; };
    const finish = () => { resolve({ errors, calls }); try { w.close(); } catch (e) {} };
    setTimeout(() => { errors.push('TIMEOUT'); finish(); }, 15000);
    Promise.resolve(steps({ w, vis, calls, errors, finish })).catch(e => { errors.push('test threw: ' + (e && e.stack || e)); finish(); });
  });
}
const login = (c) => { c.w.document.getElementById('loginCnic').value = '1111111111111'; c.w.document.getElementById('loginPw').value = 'secret123'; c.w.doLogin(); };
(async () => {
  let r = await run({}, async (c) => {
    await sleep(300);
    console.log('1 sign-in screen at start:', c.vis('s-signin'));
    login(c); await sleep(1500);
    console.log('1 login used CNIC email:', c.calls.filter(x => x.startsWith('login:')).join());
    console.log('1 main app visible:', c.w.document.getElementById('mainApp').style.display === 'block');
    console.log('1 office checkbox rendered:', !!c.w.document.querySelector('#officeCheckboxContainer input[type=checkbox]'));
    c.w.document.getElementById('fCategory').value = 'Complaint';
    c.w.document.getElementById('fDescription').value = 'Test subject';
    const st = c.w.document.getElementById('schoolType'); st.value = 'Private'; st.dispatchEvent(new c.w.Event('change', {bubbles:true})); if (typeof c.w.onSchoolTypeChange==='function') c.w.onSchoolTypeChange();
    c.w.document.getElementById('schoolName').value = 'Some School';
    c.w.document.querySelector('#officeCheckboxContainer input[type=checkbox]').checked = true;
    c.w.submitDispatch(); await sleep(800);
    console.log('1 toast:', (c.w.document.getElementById('toast')||{}).textContent, '| date:', c.w.document.getElementById('reportDate').value);
    const create = c.calls.filter(x => x.startsWith('rpc:fn_create_dispatch'));
    console.log('1 create-dispatch rpc calls:', create.length, create[0] ? create[0].slice(0, 260) : '');
    c.finish();
  });
  console.log('1 errors:', JSON.stringify(r.errors));
  for (const [label, ov, expect] of [['legacy must_change_password flag is ignored', { must_change_password: true }, 's-done'], ['no gmail', { gmail_confirmed_at: null }, 's-gmail'], ['no drive consent', { consent_given_at: null }, 's-consent']]) {
    r = await run(ov, async (c) => { await sleep(200); login(c); await sleep(700);
      console.log('2', label, '-> shows', expect + ':', c.vis(expect), '| app still hidden:', c.w.document.getElementById('mainApp').style.display !== 'block'); c.finish(); });
    if (r.errors.length) console.log('2 errors', JSON.stringify(r.errors));
  }
  r = await run({ role: 'admin' }, async (c) => { await sleep(200); login(c); await sleep(1500);
    console.log('3 admin tab visible for admin:', c.w.document.getElementById('adminTabBtn').style.display !== 'none'); c.finish(); });
  r = await run({}, async (c) => { await sleep(200); login(c); await sleep(1500);
    console.log('3 admin tab hidden for user:', c.w.document.getElementById('adminTabBtn').style.display === 'none');
    c.w.signOut(); await sleep(400);
    c.w.document.getElementById('loginCnic').value = '12ab'; c.w.document.getElementById('loginPw').value = 'x'; c.w.doLogin();
    console.log('3 bad CNIC message:', c.w.document.getElementById('loginMsg').textContent); c.finish(); });
  console.log('3 errors:', JSON.stringify(r.errors));
  process.exit(0);
})();
