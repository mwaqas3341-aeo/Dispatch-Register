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
document.getElementById('dispatch-form').onsubmit = (e) => {
    e.preventDefault();
    alert("Form submitted! Ready to build the Drive upload and Log Sheet logic next.");
};
