const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

const SHEET_ID = '1QDhwWDIiSTZeGlfFBMLqsxt0avUs9Il1zE7cBR-5VSE';
const SHEET_NAME = 'Form Responses 1';

module.exports = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing order ID or email.' });
  }

  try {
    const filePath = path.join(process.cwd(), 'songcart-order-tracker.json');
    const fileContents = await fs.readFile(filePath, 'utf8');
    const credentials = JSON.parse(fileContents);

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
