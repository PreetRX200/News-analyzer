# News Sentiment Analyzer

A web application that analyzes news articles from various RSS feeds, performs sentiment analysis using Groq's LLM API, and provides a chat interface for users to ask questions about current news.

## Features

- Real-time news fetching from multiple RSS feeds
- Sentiment analysis of news articles using Groq's LLM API
- Categorization of news by topic (breaking, technology, business, science, health)
- Interactive chat interface for news-related questions
- Voice input support for the chat interface

## Tech Stack

- Frontend: HTML, CSS, JavaScript (Vanilla)
- Backend: Node.js, Express.js
- APIs: Groq API for LLM, RapidAPI for Google Search
- Deployment: Netlify (Serverless Functions)

## Deployment on Netlify

### Prerequisites

- [Netlify Account](https://app.netlify.com/signup)
- [Groq API Key](https://console.groq.com)
- [RapidAPI Key](https://rapidapi.com) (for Google Search API)

### Steps to Deploy

1. Fork or clone this repository

2. Create a new site on Netlify:
   - Go to [Netlify](https://app.netlify.com)
   - Click "New site from Git"
   - Connect to your Git provider and select the repository
   - Configure build settings:
     - Build command: `npm install`
     - Publish directory: `public`

3. Set up environment variables in Netlify:
   - Go to Site settings > Environment variables
   - Add the following variables:
     - `GROQ_API_KEY`: Your Groq API key
     - `RAPIDAPI_KEY`: Your RapidAPI key

4. Deploy the site:
   - Netlify will automatically deploy your site
   - You can trigger manual deploys from the Netlify dashboard

## Local Development

1. Clone the repository

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   GROQ_API_KEY=your_groq_api_key
   RAPIDAPI_KEY=your_rapidapi_key
   ```

4. Start the development server:
   ```
   npm start
   ```

5. Open your browser and navigate to `http://localhost:8080`

## Project Structure

- `public/`: Static files (HTML, CSS, JS)
- `netlify/functions/`: Serverless functions for Netlify deployment
  - `api.js`: Chat API function
  - `news.js`: News sentiment analysis function
- `netlify.toml`: Netlify configuration file
- `package.json`: Project dependencies and scripts

## License

ISC

This project analyzes news sentiment from live RSS feeds, summarizes articles, and provides LLM-powered insights.

## Features
- Fetches news from multiple RSS feeds by category
- Summarizes and analyzes sentiment using Groq LLM
- Interactive chatbot for news Q&A
- LLM-generated news summaries and opinions

## Deployment on Netlify

### 1. Build Setup
- The frontend is served from the `public` directory.
- Backend/API functions are provided via Netlify Functions (`netlify/functions/api.js`).
- The main Express app is adapted for serverless via `serverless-http`.

### 2. Environment Variables
- Store sensitive keys in `.env` (not committed to git):
  - `GROQ_API_KEY=your_groq_key`
  - `RAPIDAPI_KEY=your_rapidapi_key` (if using web search)

### 3. Netlify Configuration
- `netlify.toml` configures build and function routing.
- API routes `/api/*` are proxied to serverless functions.

### 4. To Deploy
1. Push your code to a Git repository (GitHub, GitLab, etc.).
2. Connect your repo to Netlify.
3. Set environment variables in the Netlify dashboard (`.env` is not deployed!).
4. Netlify will auto-detect the build and deploy.

### 5. Local Development
- Run `npm install` to install dependencies.
- Run `npm start` for local API + frontend.

## Notes
- Do NOT commit `.env` or sensitive keys.
- The serverless backend uses the same Express app as local dev.

---

For any issues or questions, please open an issue or contact the maintainer.
