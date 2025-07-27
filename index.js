require('dotenv').config();
const express = require('express');
const { Groq } = require('groq-sdk');
const Parser = require('rss-parser');

const app = express();
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8'
  },
  timeout: 5000,
  customFields: {
    item: ['media:content', 'description', 'content:encoded']
  }
});

const RSS_FEEDS = [
  {
    category: 'breaking',
    url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms'
  },
  {
    category: 'technology',
    url: 'https://timesofindia.indiatimes.com/rssfeeds/66949542.cms'
  },
  {
    category: 'business',
    url: 'https://economictimes.indiatimes.com/prime/technology-and-startups/rssfeeds/63319172.cms'
  },
  {
    category: 'science',
    url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128672765.cms'  // Times of India Science RSS
  },
  {
    category: 'health',
    url: 'https://www.thehindu.com/sci-tech/health/feeder/default.rss'  // The Hindu Health RSS
  },
  {
    category: 'breaking',
    url: 'https://www.hindustantimes.com/feeds/rss/india/rssfeed.xml'
  }
];

// Enable JSON parsing middleware
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Store raw articles by category with loading status
const rawArticles = {
  breaking: { articles: [], isLoading: false, lastError: null },
  technology: { articles: [], isLoading: false, lastError: null },
  business: { articles: [], isLoading: false, lastError: null },
  science: { articles: [], isLoading: false, lastError: null },
  health: { articles: [], isLoading: false, lastError: null }
};

// Add delay between requests to prevent rate limiting
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Add retry mechanism for RSS feed fetching
async function fetchWithRetry(feed, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Fetching feed (attempt ${attempt}): ${feed.url}`);
      const feedData = await parser.parseURL(feed.url);
      console.log(`Successfully fetched ${feedData.items.length} items from ${feed.url}`);
      return feedData;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${feed.url}:`, error.message);
      if (attempt === maxRetries) {
        throw error;
      }
      // Exponential backoff with jitter
      const jitter = Math.random() * 1000;
      await delay(1000 * Math.pow(2, attempt - 1) + jitter);
    }
  }
}

// Add caching for sentiment analysis results with loading status
const analysisCache = {
  breaking: { timestamp: 0, data: null, isAnalyzing: false },
  technology: { timestamp: 0, data: null, isAnalyzing: false },
  business: { timestamp: 0, data: null, isAnalyzing: false },
  science: { timestamp: 0, data: null, isAnalyzing: false },
  health: { timestamp: 0, data: null, isAnalyzing: false }
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const INITIAL_LOAD_TIMEOUT = 10000; // 10 seconds

// Wait for initial RSS feed load
let initialLoadComplete = false;
let initialLoadPromise = new Promise((resolve) => {
  setTimeout(() => {
    initialLoadComplete = true;
    resolve();
  }, INITIAL_LOAD_TIMEOUT);
});

// Initialize RSS feed polling
async function initializeRSSPolling() {
  console.log('Starting RSS feed polling');

  // Initial fetch
  try {
    await fetchAllFeeds();
    initialLoadComplete = true;
  } catch (error) {
    console.error('Error in initial feed fetch:', error);
  }
  
  // Start RSS polling
  setInterval(fetchAllFeeds, 5 * 60 * 1000); // Poll every 5 minutes
}

// Separate function to fetch all feeds
async function fetchAllFeeds() {
  // Group feeds by category
  const feedsByCategory = RSS_FEEDS.reduce((acc, feed) => {
    if (!acc[feed.category]) {
      acc[feed.category] = [];
    }
    acc[feed.category].push(feed);
    return acc;
  }, {});

  // Process each category
  for (const [category, feeds] of Object.entries(feedsByCategory)) {
    rawArticles[category].isLoading = true;
    rawArticles[category].lastError = null;
    
    let categorySuccess = false;
    let allArticles = [];
    
    // Try each feed for this category
    for (const feed of feeds) {
      try {
        const feedData = await fetchWithRetry(feed);
        
        // Process new articles
        const newArticles = feedData.items.map(item => ({
          category: feed.category,
          title: item.title,
          content: item.contentSnippet || item.description || item['content:encoded'] || item.summary || '',
          url: item.link,
          source: feedData.title || feed.url.split('/')[2],
          timestamp: new Date(item.pubDate || item.isoDate || new Date()).toISOString()
        }));

        allArticles = [...allArticles, ...newArticles];
        categorySuccess = true;
        console.log(`Successfully processed feed ${feed.url} for category: ${category}`);
      } catch (error) {
        console.error(`Failed to process feed ${feed.url} after all retries:`, error.message);
        // Don't set category error yet, as we might have other feeds for this category
      }
      await delay(2000); // Increased delay between feeds to prevent rate limiting
    }
    
    if (categorySuccess) {
      // Combine with existing articles, remove duplicates, and keep most recent
      const existingArticles = rawArticles[category].articles || [];
      const combinedArticles = [...existingArticles, ...allArticles];
      const uniqueArticles = Array.from(new Map(
        combinedArticles.map(article => [article.url, article])
      ).values());

      // Sort by timestamp and keep most recent 10
      rawArticles[category].articles = uniqueArticles
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10);

      console.log(`Processed ${rawArticles[category].articles.length} articles for category: ${category}`);
      rawArticles[category].lastError = null;
    } else {
      // All feeds for this category failed
      rawArticles[category].lastError = "Failed to fetch articles from any source for this category";
    }
    
    rawArticles[category].isLoading = false;
  }
}

// Analyze sentiment using Groq
async function analyzeSentiment(article) {
  console.log('Analyzing article:', article.title);
  try {
    const response = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a news sentiment analyzer. Analyze the news article and provide a response in this exact JSON format:
{
  "title": "Original article title",
  "summary": "2-5 sentence summary of the article",
  "sentiment": "positive/negative/neutral",
  "bias": "One line describing any bias detected",
  "mood": "3-5 relevant emojis that capture the article's mood",
  "sentiment_score": <number between -1 and 1>,
  "bias_level": <number between 0 and 10>,
  "manipulative_score": <number between 0 and 10>
}`
        },
        {
          role: "user",
          content: `Title: ${article.title}\n\nContent: ${article.content}`
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      max_tokens: 1000,
      top_p: 0.9
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    
    return {
      title: article.title,
      url: article.url,
      source: article.source,
      timestamp: article.timestamp,
      summary: analysis.summary,
      overall_sentiment: analysis.sentiment,
      sentiment_score: analysis.sentiment_score,
      bias_level: analysis.bias_level,
      manipulative_score: analysis.manipulative_score,
      positive: analysis.mood,
      negative: analysis.bias
    };
  } catch (error) {
    console.error('Error in sentiment analysis:', { error: error.message, article: article.title });
    return {
      title: article.title,
      url: article.url,
      source: article.source,
      timestamp: article.timestamp,
      summary: 'Analysis temporarily unavailable',
      overall_sentiment: 'neutral',
      sentiment_score: 0,
      bias_level: 0,
      manipulative_score: 0,
      positive: '❓',
      negative: 'Analysis temporarily unavailable'
    };
  }
}

// Analyze articles for a category
async function analyzeArticles(category) {
  console.log(`Starting analysis for category: ${category}`);
  const articles = rawArticles[category].articles;
  if (!articles || articles.length === 0) {
    console.log(`No articles found for category: ${category}`);
    return {
      positive: [],
      negative: [],
      neutral: [],
      suggestions: ["No articles available for analysis."]
    };
  }

  console.log(`Found ${articles.length} articles to analyze`);
  const analyzedArticles = [];
  const suggestions = new Set();

  for (const article of articles) {
    try {
      const analysis = await analyzeSentiment(article);
      analyzedArticles.push(analysis);
      if (analysis.recommendations) {
        suggestions.add(analysis.recommendations);
      }
    } catch (error) {
      console.error(`Error analyzing article: ${article.title}`, error);
      // Continue with next article
    }
  }

  console.log(`Successfully analyzed ${analyzedArticles.length} articles`);
  
  // Sort articles by sentiment score and include article metadata
  const positive = analyzedArticles
    .filter(a => a.sentiment_score > 0.3)
    .sort((a, b) => b.sentiment_score - a.sentiment_score)
    .slice(0, 5);

  const negative = analyzedArticles
    .filter(a => a.sentiment_score < -0.3)
    .sort((a, b) => a.sentiment_score - b.sentiment_score)
    .slice(0, 5);

  const neutral = analyzedArticles
    .filter(a => a.sentiment_score >= -0.3 && a.sentiment_score <= 0.3)
    .slice(0, 5);

  console.log(`Categorized articles - Positive: ${positive.length}, Negative: ${negative.length}, Neutral: ${neutral.length}`);

  return {
    positive,
    negative,
    neutral,
    suggestions: Array.from(suggestions)
  };
}

// API endpoint to get analyzed articles by category
app.get('/api/articles/:category', async (req, res) => {
  const category = req.params.category.toLowerCase();
  
  try {
    console.log(`Received request for category: ${category}`);
    
    // Check if initial load is complete
    if (!initialLoadComplete) {
      console.log('Waiting for initial load to complete...');
      await initialLoadPromise;
    }

    if (!(category in rawArticles)) {
      console.log(`Category ${category} not found`);
      return res.status(404).json({
        error: 'Category not found',
        available_categories: Object.keys(rawArticles)
      });
    }

    // Check if category is loading or has error
    if (rawArticles[category].isLoading) {
      console.log(`Category ${category} is still loading articles`);
      return res.status(202).json({
        status: 'loading',
        message: 'Articles are being fetched',
        category: category
      });
    }

    if (rawArticles[category].lastError) {
      console.log(`Error found for category ${category}: ${rawArticles[category].lastError}`);
      return res.status(500).json({
        error: 'Error fetching articles',
        message: rawArticles[category].lastError,
        category: category
      });
    }

    // Check if we have articles
    if (!rawArticles[category].articles || rawArticles[category].articles.length === 0) {
      console.log(`No articles found for category ${category}`);
      return res.status(404).json({
        error: 'No articles available',
        message: 'Please try again in a few moments as articles are being fetched',
        category: category
      });
    }

    // Check cache and analysis status
    const cache = analysisCache[category];
    const cacheAge = Date.now() - (cache?.timestamp || 0);
    console.log(`Cache status for ${category}:`, {
      hasCache: !!cache?.data,
      cacheAge: Math.floor(cacheAge / 1000) + ' seconds',
      isAnalyzing: cache?.isAnalyzing
    });

    if (cache?.data && cacheAge < CACHE_DURATION) {
      console.log(`Serving cached analysis for ${category} (${Math.floor(cacheAge / 1000)}s old)`);
      return res.json({
        ...cache.data,
        cache_status: {
          from_cache: true,
          age: Math.floor(cacheAge / 1000),
          expires_in: Math.floor((CACHE_DURATION - cacheAge) / 1000)
        }
      });
    }

    if (cache?.isAnalyzing) {
      console.log(`Analysis in progress for ${category}`);
      return res.status(202).json({
        status: 'analyzing',
        message: 'Articles are being analyzed',
        category: category,
        started_at: cache.analysisStartTime
      });
    }

    console.log(`Starting fresh analysis for ${category}`);
    analysisCache[category] = {
      ...analysisCache[category],
      isAnalyzing: true,
      analysisStartTime: new Date().toISOString()
    };

    const analysis = await analyzeArticles(category);
    
    // Cache the results
    analysisCache[category] = {
      timestamp: Date.now(),
      data: {
        category,
        summary: {
          total_articles: rawArticles[category].articles.length,
          analyzed_articles: analysis.positive.length + analysis.negative.length + analysis.neutral.length,
          positive_count: analysis.positive.length,
          negative_count: analysis.negative.length,
          neutral_count: analysis.neutral.length
        },
        articles: {
          positive: analysis.positive,
          negative: analysis.negative,
          neutral: analysis.neutral
        },
        reader_suggestions: analysis.suggestions,
        last_updated: new Date().toISOString()
      },
      isAnalyzing: false,
      analysisStartTime: null
    };

    console.log(`Analysis complete for ${category}, cached results`);
    res.json({
      ...analysisCache[category].data,
      cache_status: {
        from_cache: false,
        just_analyzed: true
      }
    });
  } catch (error) {
    console.error(`Error processing ${category} articles:`, error);
    analysisCache[category].isAnalyzing = false;
    analysisCache[category].analysisStartTime = null;
    res.status(500).json({
      error: 'Internal server error while analyzing articles',
      message: error.message,
      category: category
    });
  }
});

// Remove the old /api/articles endpoint since we're doing on-demand analysis
app.get('/api/articles', (req, res) => {
  const categories = Object.keys(rawArticles);
  const summary = categories.reduce((acc, category) => {
    const articles = rawArticles[category].articles;
    const cache = analysisCache[category];
    acc[category] = {
      article_count: articles.length,
      has_analysis: cache && cache.data && (Date.now() - cache.timestamp) < CACHE_DURATION,
      last_updated: articles.length > 0 ? articles[0].timestamp : null
    };
    return acc;
  }, {});
  
  res.json({
    available_categories: categories,
    articles_per_category: summary,
    initial_load_complete: initialLoadComplete
  });
});

// Mount the chatbot API
const chatApi = require('./api');
app.use('/api', chatApi);

// Serve static files from public directory
app.use(express.static('public'));

// Export rawArticles for use in other modules (e.g., api.js)
module.exports.rawArticles = rawArticles;

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log(`- http://localhost:${PORT}/api/articles (All articles)`);
  console.log(`- http://localhost:${PORT}/api/articles/:category (Articles by category)`);
  await initializeRSSPolling();
});