const CLIENT_ID = '98478009111-segpk2092ubc0up0h4dne5fk2o8vhc2p.apps.googleusercontent.com';
// ADDED gmail.send scope
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
const MASTER_SHEET_ID = '1jy4luyyqGusPcCCYLavPJu3Ykr0Akso5K4OcXCZ4Uyo';

let accessToken;

// 1. Initialize
window.onload = () => {
    // Populate Date
    document.getElementById('date').valueAsDate = new Date();
    
    // Auth Init (same as before)
    google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES,
        callback: (res) => { accessToken = res.access_token; document.getElementById('auth-section').classList.add('hidden'); document.getElementById('dashboard').classList.remove('hidden'); loadDashboardData(); }
    }).requestAccessToken();
};

async function loadDashboardData() {
    // Fetch Next Dispatch Number and Office List
    // Logic: Fetch Config!B1 and Offices!A:B
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values:batchGet?ranges=Config!B1&ranges=Offices!A:B`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();
    document.getElementById('dispatch-num-display').innerText = data.valueRanges[0].values[0][0];
    
    // Populate Dropdown
    const select = document.getElementById('office-select');
    data.valueRanges[1].values.forEach(row => {
        let opt = document.createElement('option');
        opt.value = row[1]; // Email
        opt.innerText = row[0]; // Name
        select.appendChild(opt);
    });
}

// 2. Logic: Handle Conditional Form
document.getElementById('school-type').onchange = (e) => {
    const isGovt = e.target.value === 'govt';
    document.getElementById('govt-section').classList.toggle('hidden', !isGovt);
    document.getElementById('private-section').classList.toggle('hidden', isGovt);
};

// 3. Logic: Send Email (Professional Wrapper)
async function sendProfessionalEmail(toEmails, subject, body, fileLink) {
    const emailContent = [
        `To: ${toEmails.join(', ')}`,
        `Subject: Dispatch Alert: ${subject}`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        `<h3>Official Dispatch</h3><p>${body}</p><br><a href="${fileLink}">View Document</a>`
    ].join('\r\n');

    const base64EncodedEmail = btoa(unescape(encodeURIComponent(emailContent))).replace(/\+/g, '-').replace(/\//g, '_');

    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: base64EncodedEmail })
    });
}

// 4. Submit
document.getElementById('dispatch-form').onsubmit = async (e) => {
    e.preventDefault();
    const selectedOptions = Array.from(document.getElementById('office-select').selectedOptions);
    const emails = selectedOptions.map(o => o.value);
    
    // Perform File Upload -> Log to Sheet -> Send Email
    // ... [Use previous uploadFileToDrive and appendToLogSheet functions here] ...
    
    await sendProfessionalEmail(emails, document.getElementById('subject').value, document.getElementById('details').value, fileLink);
    alert("Dispatch Successful!");
};
