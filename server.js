require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Route: Pull headings from URL ---
app.post('/api/pull-headings', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const { data: html } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HeadingOptimizer/1.0)' }
    });

    const $ = cheerio.load(html);
    const headings = [];

    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const text = $(el).text().trim();
      const level = el.name.toUpperCase();
      if (text) headings.push({ text, level });
    });

    res.json({ headings });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  }
});

// --- Route: Optimize headings with Claude ---
app.post('/api/optimize', async (req, res) => {
  const { headings, keyword, apiKey } = req.body;
  if (!headings || !headings.length) return res.status(400).json({ error: 'No headings provided' });
  if (!apiKey) return res.status(400).json({ error: 'API key is required' });

  const headingList = headings
    .map((h, i) => `${i + 1}. [${h.level}] ${h.text}`)
    .join('\n');

  const prompt = `You are an SEO content strategist. Optimize the following page headings for the primary keyword/topic: "${keyword || 'not specified'}".

For each heading, return an improved version that:
- Naturally incorporates the primary keyword or a semantic variant where appropriate
- Is clear, specific, and compelling
- Maintains the original intent and hierarchy
- Stays under 70 characters for H1, under 60 for H2–H6
- Avoids keyword stuffing

Here are the headings to optimize:
${headingList}

Respond ONLY with a JSON array in this exact format, no preamble, no markdown:
[
  {
    "original": "original heading text",
    "optimized": "optimized heading text",
    "level": "H1",
    "notes": "brief explanation of change"
  }
]`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-opus-4-7',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const raw = response.data.content[0].text.trim();
    const parsed = JSON.parse(raw);
    res.json({ results: parsed });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Optimization failed: ${msg}` });
  }
});

// --- Route: Export to Google Sheets ---
app.post('/api/export-sheets', async (req, res) => {
  const { results, sheetId, credentials } = req.body;
  if (!results || !results.length) return res.status(400).json({ error: 'No results to export' });
  if (!sheetId) return res.status(400).json({ error: 'Sheet ID is required' });
  if (!credentials) return res.status(400).json({ error: 'Service account credentials are required' });

  try {
    const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const header = [['Original Heading (A)', 'Optimized Heading (B)', 'Level', 'Char (A)', 'Char (B)', 'Notes']];
    const rows = results.map(r => [
      r.original,
      r.optimized || '',
      r.level,
      r.original.length,
      r.optimized ? r.optimized.length : '',
      r.notes || ''
    ]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [...header, ...rows] }
    });

    res.json({ success: true, rows: rows.length });
  } catch (err) {
    res.status(500).json({ error: `Sheets export failed: ${err.message}` });
  }
});

app.listen(PORT, () => console.log(`Heading Optimizer running on port ${PORT}`));
