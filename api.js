// api.js: Handles Google Search API + Groq LLM for chat context
const express = require('express');
const https = require('https');
const { Groq } = require('groq-sdk');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Save uploads to 'uploads/' directory

const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Use Google Search API (google-search74) via RapidAPI to get news context using https module
async function googleSearchNews(query) {
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY not set in environment');

  const options = {
    method: 'GET',
    hostname: 'google-search74.p.rapidapi.com',
    port: null,
    path: `/?query=${encodeURIComponent(query)}&limit=5&related_keywords=true`,
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'google-search74.p.rapidapi.com'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, function (res) {
      const chunks = [];
      res.on('data', function (chunk) {
        chunks.push(chunk);
      });
      res.on('end', function () {
        const body = Buffer.concat(chunks);
        console.log('Raw API response:', body.toString());
        let data;
        try {
          data = JSON.parse(body.toString());
        } catch (e) {
          console.error('Failed to parse API response:', body.toString());
          return reject(new Error('Failed to parse API response'));
        }
        console.log('Parsed API response:', data);
        let snippets = [];
        if (data && data.results) {
          snippets = data.results.map(item => `• ${item.title}: ${item.description || ''}`);
        } else {
          console.error('Unexpected API response structure:', data);
        }
        console.log('API response snippets:', snippets);
        resolve(snippets.join('\n'));
      });
    });
    req.on('error', (err) => {
      console.error('API request error:', err);
      reject(err);
    });
    req.end();
  });
}

// Use Groq LLM for concise, conversational answers
async function getGroqAnswer(context, question) {
  const prompt = `You are a helpful news chatbot. Use the following news context to answer the user's question in a short, conversational way (2-3 sentences max, no long paragraphs).\n\nNews context:\n${context}\n\nUser: ${question}\nBot:`;
  const chatResp = await groq.chat.completions.create({
    model: "llama3-70b-8192", // Use Groq's production Llama 3 model
    messages: [
      { role: "system", content: "You are a helpful news chatbot." },
      { role: "user", content: prompt }
    ],
    max_tokens: 120,
    temperature: 0.6,
    stream: false
  });
  return chatResp.choices[0].message.content.trim();
}

// POST /api/chat: { message }
router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });
  try {
    console.log('[CHAT] User message:', message);
    const context = await googleSearchNews(message);
    console.log('[CHAT] News context:', context);
    const answer = await getGroqAnswer(context, message);
    console.log('[CHAT] LLM answer:', answer);
    res.json({ answer });
  } catch (err) {
    console.error('[CHAT] Error:', err);
    res.status(500).json({ error: 'Failed to get answer', detail: err.message });
  }
});

// POST /api/voice-to-text: Accepts audio file, returns transcription using Groq Whisper
router.post('/voice-to-text', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
  try {
    const fs = require('fs');
    const audioBuffer = fs.readFileSync(req.file.path);

    // Log file info
    console.log('[VOICE-TO-TEXT] Received file:', req.file.originalname, 'size:', req.file.size, 'bytes');

    // Use correct model name and parameters
    const whisperResp = await groq.audio.transcriptions.create({
      file: audioBuffer,
      filename: req.file.originalname || 'audio.webm',
      model: 'whisper-large-v3-turbo',
      response_format: 'json',
      language: 'en'
    });

    console.log('[VOICE-TO-TEXT] Whisper response:', whisperResp);
    if (whisperResp && whisperResp.text) {
      res.json({ text: whisperResp.text });
    } else {
      // Defensive: return the full response for debugging
      res.json({ error: 'No transcription text returned', whisperResp });
    }
  } catch (err) {
    console.error('[VOICE-TO-TEXT] Error:', err);
    res.status(500).json({ error: 'Failed to transcribe audio', detail: err.message });
  }
});

// Simple health check and mock chat endpoint
router.post('/chat/test', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });
  // Mock: echo message and fake context/answer
  const mockContext = `Mock context for: ${message}`;
  const mockAnswer = `This is a mock answer to: '${message}'. (Context: ${mockContext})`;
  res.json({ answer: mockAnswer, context: mockContext });
});

// --- LLM News Summary Endpoint ---
// This endpoint provides a summary/opinion based on the latest RSS articles for a given category
router.get('/llm-news-summary/:category', async (req, res) => {
  try {
    // Dynamically require the rawArticles store from the main app
    let rawArticles;
    try {
      // Try to require the main app and get rawArticles (must be exported in index.js)
      rawArticles = require('./index.js').rawArticles;
    } catch (e) {
      // If not exported, return error and instructions
      return res.status(500).json({
        error: 'rawArticles not exported from index.js',
        instructions: 'Please export rawArticles from index.js as module.exports.rawArticles = rawArticles;'
      });
    }
    const category = req.params.category.toLowerCase();
    const articles = rawArticles[category]?.articles || [];
    if (!articles.length) {
      return res.status(404).json({ error: 'No articles found for this category.' });
    }
    // Build context for the LLM
    const context = articles.slice(0, 5).map((a, i) =>
      `${i + 1}. [${a.title}]: ${a.content.slice(0, 200)}`
    ).join('\n');
    const prompt = `You are an AI news analyst. Here are the latest news headlines and summaries for the "${category}" category:\n\n${context}\n\nPlease provide a 3-5 sentence summary of the overall trends, sentiment, and any notable events or patterns you see in this news batch.`;
    const summary = await getGroqAnswer(context, prompt);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get LLM news summary', detail: err.message });
  }
});

module.exports = router;
