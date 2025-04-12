const { google } = require('googleapis');

const SHEET_ID = '1QDhwWDIiSTZeGlfFBMLqsxt0avUs9Il1zE7cBR-5VSE';
const SHEET_NAME = 'Form Responses 1';

module.exports = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  try {
    // Auth using env variables
    const credentials = {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      project_id: process.env.GOOGLE_PROJECT_ID,
    };

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_NAME,
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No data found in the sheet.' });
    }

    let matchedRow = null;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const orderId = row[0]?.trim();
      const email = row[1]?.trim();
      const driveLink = row[2]?.trim();
      const readyStatus = row[3]?.trim().toLowerCase();

      if (orderId === query && readyStatus === 'yes') {
        matchedRow = {
          orderId,
          email,
          isSongReady: true,
          songUrl: convertToDirectDownloadLink(driveLink),
        };
        break;
      }
    }

    if (!matchedRow) {
      return res.json({ isSongReady: false });
    }

    return res.json(matchedRow);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

function convertToDirectDownloadLink(shareLink) {
  const match = shareLink.match(/\/d\/(.*?)\//);
  if (match && match[1]) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }
  return shareLink;
}
