require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const Anthropic = require('@anthropic-ai/sdk');
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

  const anthropic = new Anthropic({ apiKey });

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
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim();
    const parsed = JSON.parse(raw);
    res.json({ results: parsed });
  } catch (err) {
    res.status(500).json({ error: `Optimization failed: ${err.message}` });
  }
});

app.listen(PORT, () => console.log(`Heading Optimizer running on port ${PORT}`));
