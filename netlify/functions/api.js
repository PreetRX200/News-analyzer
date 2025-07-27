// Netlify serverless function for API
const express = require('express');
const serverless = require('serverless-http');
const { Groq } = require('groq-sdk');
const multer = require('multer');
const upload = multer({ dest: '/tmp/' }); // Use /tmp for serverless functions
const https = require('https');

const app = express();
const router = express.Router();

// Enable JSON parsing middleware
app.use(express.json());

// Initialize Groq client
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Use Google Search API (google-search74) via RapidAPI to get news context using https module
async function googleSearchNews(query) {
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

// Simple health check and mock chat endpoint
router.post('/chat/test', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });
  // Mock: echo message and fake context/answer
  const mockContext = `Mock context for: ${message}`;
  const mockAnswer = `This is a mock answer to: '${message}'. (Context: ${mockContext})`;
  res.json({ answer: mockAnswer, context: mockContext });
});

// Use the router for all routes
app.use('/.netlify/functions/api', router);

// Export the serverless handler
module.exports.handler = serverless(app);