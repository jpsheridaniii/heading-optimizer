require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

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

  const prompt = `You are an SEO content strategist. Analyze the following page headings for the primary keyword/topic: "${keyword || 'not specified'}".

## Scoring Rubric (score each heading 1–10)
- **Keyword presence** (3 pts): Primary keyword or strong semantic variant naturally included
- **Length** (2 pts): H1 under 70 chars, H2–H6 under 60 chars
- **Clarity & specificity** (2 pts): Concrete, descriptive, not vague or generic
- **Compelling language** (2 pts): Action-oriented, benefit-driven, or curiosity-inducing
- **Hierarchy fit** (1 pt): Appropriate for its heading level (H1 = page topic, H2 = section, etc.)

## CRITICAL RULES — follow exactly, no exceptions:
1. Score every heading using the rubric above.
2. If a heading scores 8, 9, or 10: the "optimized" field MUST be the EXACT SAME STRING as "original". Do not change a single character. Notes should say "No change needed".
3. If a heading scores 7 or below: rewrite it to improve the score. The "optimized" field must differ from "original".
4. Only add new headings (with "original" set to "") if there is a clear structural gap in the page. Do not add new headings just to pad the list.
5. Do not reorder existing headings.

Here are the headings to optimize:
${headingList}

Respond ONLY with a valid JSON array — no preamble, no markdown fences, no explanation:
[
  {
    "original": "exact original heading text",
    "optimized": "rewritten or identical heading text",
    "level": "H1",
    "score": 7,
    "notes": "brief explanation of score and changes"
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

app.listen(PORT, () => console.log(`Heading Optimizer running on port ${PORT}`));
