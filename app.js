const CLIENT_ID = '98478009111-segpk2092ubc0up0h4dne5fk2o8vhc2p.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
const MASTER_SHEET_ID = '1jy4luyyqGusPcCCYLavPJu3Ykr0Akso5K4OcXCZ4Uyo';

let accessToken;

// Navigation
function showSection(id) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

window.onload = () => {
    document.getElementById('date').valueAsDate = new Date();
    google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES,
        callback: (res) => { 
            accessToken = res.access_token; 
            document.getElementById('auth-section').classList.add('hidden'); 
            showSection('dashboard');
            initDashboard();
        }
    }).requestAccessToken();
};

async function initDashboard() {
    // 1. Fetch Dispatch Numbers and Offices
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values:batchGet?ranges=Log Sheet!B:C&ranges=Offices!A:B`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();
    
    // 2. Logic: Next Dispatch No
    const logs = data.valueRanges[0].values || [];
    const today = new Date().toLocaleDateString('en-GB'); 
    const todaysLogs = logs.filter(r => r[0] === today);
    const nextNo = todaysLogs.length > 0 ? (parseInt(todaysLogs[todaysLogs.length-1][1].split('-')[1]) + 1) : 1;
    document.getElementById('dispatch-num-display').innerText = `D-${today.split('/')[2]}-${String(nextNo).padStart(3, '0')}`;

    // 3. Render Checkboxes
    const container = document.getElementById('office-checkboxes');
    data.valueRanges[1].values.forEach(row => {
        container.innerHTML += `<label><input type="checkbox" value="${row[1]}" data-name="${row[0]}"> ${row[0]}</label><br>`;
    });
}

function toggleSchoolInputs() {
    const isGovt = document.getElementById('school-type').value === 'govt';
    document.getElementById('govt-inputs').classList.toggle('hidden', !isGovt);
    document.getElementById('private-inputs').classList.toggle('hidden', isGovt);
}

async function validateEmis() {
    const emis = document.getElementById('emis-code').value;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/Schools!F:G`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    // Col F is index 0, Col G is index 1 in this slice
    const row = data.values.find(r => r[0] == emis);
    document.getElementById('govt-school-name').value = row ? row[1] : "Not Found";
}

document.getElementById('dispatch-form').onsubmit = async (e) => {
    e.preventDefault();
    // Logic for selected offices
    const selected = Array.from(document.querySelectorAll('#office-checkboxes input:checked')).map(i => i.dataset.name).join(', ');
    const emails = Array.from(document.querySelectorAll('#office-checkboxes input:checked')).map(i => i.value).join(', ');
    
    alert("Data prepared. Proceeding with upload...");
    // ... (Use your existing Upload/Write functions here)
};

async function loadReports() {
    const dateFilter = document.getElementById('filter-date').value;
    const kw = document.getElementById('filter-keyword').value.toLowerCase();
    
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/Log Sheet!B:I`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const filtered = data.values.filter(r => 
        (!dateFilter || r[0] === dateFilter) && 
        (!kw || JSON.stringify(r).toLowerCase().includes(kw))
    );
    document.getElementById('report-list').innerHTML = `<pre>${JSON.stringify(filtered, null, 2)}</pre>`;
}
