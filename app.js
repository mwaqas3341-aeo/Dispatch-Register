const CLIENT_ID = '98478009111-segpk2092ubc0up0h4dne5fk2o8vhc2p.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
const MASTER_SHEET_ID = '1jy4luyyqGusPcCCYLavPJu3Ykr0Akso5K4OcXCZ4Uyo';

let accessToken;

window.onload = () => {
    document.getElementById('date').valueAsDate = new Date();
    google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES,
        callback: (res) => { 
            accessToken = res.access_token; 
            document.getElementById('auth-section').classList.add('hidden'); 
            document.getElementById('dashboard').classList.remove('hidden'); 
            initDashboard(); 
        }
    }).requestAccessToken();
};

async function initDashboard() {
    // Fetch Dispatch # from Config!B1 and Offices from Offices!A:B
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values:batchGet?ranges=Config!B1&ranges=Offices!A:B`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();
    document.getElementById('dispatch-num-display').innerText = data.valueRanges[0].values[0][0];
    const select = document.getElementById('office-select');
    data.valueRanges[1].values.forEach(row => {
        let opt = document.createElement('option'); opt.value = row[1]; opt.innerText = row[0];
        select.appendChild(opt);
    });
}

document.getElementById('school-type').onchange = (e) => {
    const isGovt = e.target.value === 'govt';
    document.getElementById('govt-section').classList.toggle('hidden', !isGovt);
    document.getElementById('private-section').classList.toggle('hidden', isGovt);
};

document.getElementById('validate-btn').onclick = async () => {
    const emis = document.getElementById('emis-code').value;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/Schools!A:G`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const row = data.values.find(r => r[0] == emis);
    document.getElementById('govt-school-name').value = row ? row[5] : "Not Found";
};

document.getElementById('dispatch-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.innerText = "Processing..."; btn.disabled = true;

    try {
        // 1. Upload File
        const file = document.getElementById('report-file').files[0];
        const meta = JSON.stringify({name: file.name, mimeType: file.type});
        const form = new FormData();
        form.append('metadata', new Blob([meta], {type: 'application/json'}));
        form.append('file', file);
        const upRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST', headers: {'Authorization': 'Bearer ' + accessToken}, body: form
        });
        const fileData = await upRes.json();
        const link = `https://drive.google.com/file/d/${fileData.id}/view`;

        // 2. Prepare Data (Cols B-I)
        const rowData = [
            document.getElementById('date').value,
            document.getElementById('dispatch-num-display').innerText,
            Array.from(document.getElementById('office-select').selectedOptions).map(o => o.text).join(', '),
            document.getElementById('nature').value,
            document.getElementById('subject').value,
            link,
            document.getElementById('emis-code').value,
            document.getElementById('accused-name').value
        ];

        // 3. Log to Sheet (B:I)
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/Log Sheet!B:I:append?valueInputOption=USER_ENTERED`, {
            method: 'POST', headers: {'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json'},
            body: JSON.stringify({ values: [rowData] })
        });

        // 4. Send Email
        const emails = Array.from(document.getElementById('office-select').selectedOptions).map(o => o.value);
        const emailBody = `To: ${emails.join(', ')}\r\nSubject: Official Dispatch\r\n\r\nRegarding: ${document.getElementById('subject').value}\r\n\r\nLink: ${link}`;
        const raw = btoa(unescape(encodeURIComponent(emailBody))).replace(/\+/g, '-').replace(/\//g, '_');
        await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
            method: 'POST', headers: {'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json'},
            body: JSON.stringify({ raw: raw })
        });

        alert("Success! Dispatch logged and emailed.");
    } catch (err) { alert("Error: " + err.message); }
    finally { btn.innerText = "Generate Dispatch & Email"; btn.disabled = false; }
};
