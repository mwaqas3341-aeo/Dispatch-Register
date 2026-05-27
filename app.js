// Your specific Google OAuth Client ID
const CLIENT_ID = '98478009111-segpk2092ubc0up0h4dne5fk2o8vhc2p.apps.googleusercontent.com';

// Scopes required for Drive uploads and Sheets reading/writing
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

let tokenClient;
let accessToken = null;

// The ID of your Master Sheet
const MASTER_SHEET_ID = '1jy4luyyqGusPcCCYLavPJu3Ykr0Akso5K4OcXCZ4Uyo'; 

window.onload = function () {
    // Initialize the Google Identity Services Token Client
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                accessToken = tokenResponse.access_token;
                
                // Hide login, show dashboard
                document.getElementById('auth-section').classList.add('hidden');
                document.getElementById('dashboard').classList.remove('hidden');
                
                console.log("Authorization successful.");
            }
        },
    });
};

// Trigger the Google Login Popup
document.getElementById('auth-btn').onclick = () => {
    tokenClient.requestAccessToken();
};

// Handle EMIS Validation directly from your Google Sheet
document.getElementById('validate-btn').onclick = async () => {
    const emisInput = document.getElementById('emis-code').value;
    const displaySpan = document.getElementById('school-name-display');

    if (emisInput.length !== 8) {
        displaySpan.style.color = 'red';
        displaySpan.innerText = "Please enter exactly 8 digits.";
        return;
    }

    displaySpan.style.color = 'blue';
    displaySpan.innerText = "Searching database...";

    try {
        // Fetching data from the Schools tab (Assuming EMIS is in Col A, Name in Col F)
        // If your tab name is different, change 'Schools!A:G' to 'YourTabName!A:G'
        const range = 'Schools!A:G'; 
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${range}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error("Failed to fetch data. Check Sheet ID and permissions.");

        const data = await response.json();
        const rows = data.values;
        let found = false;

        // Search the rows for the EMIS code
        if (rows && rows.length > 0) {
            for (let i = 0; i < rows.length; i++) {
                // rows[i][0] is Column A, rows[i][5] is Column F
                if (rows[i][0] == emisInput) {
                    displaySpan.style.color = '#28a745';
                    displaySpan.innerText = `Found: ${rows[i][5]}`; 
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            displaySpan.style.color = 'red';
            displaySpan.innerText = "School not found in database.";
        }

    } catch (error) {
        console.error(error);
        displaySpan.style.color = 'red';
        displaySpan.innerText = "Error searching database.";
    }
};

// Form Submission Placeholder (Next Phase)
// --- CORE FUNCTION 1: Upload File to Google Drive ---
async function uploadFileToDrive(file) {
    const metadata = {
        name: file.name,
        mimeType: file.type
    };
    
    // We use a multipart form to send both the file name/metadata and the file data
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
        body: form
    });

    if (!response.ok) throw new Error("File upload failed.");
    
    const data = await response.json();
    
    // We need to change the file permissions so anyone with the link can view it 
    // (necessary for the hyperlink in your Log Sheet)
    await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });

    return data.id; 
}

// --- CORE FUNCTION 2: Write Row to Google Sheets ---
async function appendToLogSheet(rowData) {
    // Assuming your tab is named "Log Sheet" and spans A to J
    const range = 'Log Sheet!A:J'; 
    const body = { values: [rowData] };

    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error("Failed to write to Log Sheet.");
    return await response.json();
}

// --- MAIN SUBMISSION HANDLER ---
document.getElementById('dispatch-form').onsubmit = async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.innerText = "Processing... Please wait";
    submitBtn.disabled = true;

    try {
        const emisInput = document.getElementById('emis-code').value;
        const schoolName = document.getElementById('school-name-display').innerText.replace('Found: ', '');
        const subject = document.getElementById('subject').value;
        const fileInput = document.getElementById('report-file');
        const file = fileInput.files[0];

        // 1. Upload the file to Drive
        const fileId = await uploadFileToDrive(file);
        const fileLink = `https://drive.google.com/file/d/${fileId}/view`;

        // 2. Prepare the data array based on your specific Log Sheet structure
        // Col A: Sr No (Can be automated by a Sheet formula, leaving blank for now)
        // Col B: Date
        // Col C: Dispatch No (Placeholder, we will add the auto-generator later)
        // Col D: Select Office (Recipient)
        // Col E: Category
        // Col F: Subject
        // Col G: Remarks
        // Col H: Report Link
        // Col I: EMIS Code
        // Col J: Accused Name / Notes
        
        const todayDate = new Date().toLocaleDateString('en-GB'); // Format: DD/MM/YYYY
        
        const rowData = [
            "", // Sr No
            todayDate, // Date
            "Pending Dispatch No", // Dispatch No
            schoolName, // Using the validated school name as recipient for now
            "File Forward", // Default category
            subject, 
            "Submitted via Portal", // Default remark
            fileLink, 
            emisInput, 
            "" // Accused Name
        ];

        // 3. Send data to Sheet
        await appendToLogSheet(rowData);

        alert("Dispatch successfully logged and file uploaded!");
        document.getElementById('dispatch-form').reset();
        document.getElementById('school-name-display').innerText = "";
        
    } catch (error) {
        console.error(error);
        alert("An error occurred during submission. Check the console.");
    } finally {
        submitBtn.innerText = "Generate Dispatch & Upload";
        submitBtn.disabled = false;
    }
};
