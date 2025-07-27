// Netlify serverless function for News Sentiment Analysis
const { Groq } = require('groq-sdk');
const Parser = require('rss-parser');

// Initialize Groq client
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

exports.handler = async (event, context) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Get category from path parameter
  const path = event.path.split('/');
  const category = path[path.length - 1].toLowerCase();

  // Validate category
  const validCategories = ['breaking', 'technology', 'business', 'science', 'health'];
  if (!validCategories.includes(category)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Invalid category',
        available_categories: validCategories
      })
    };
  }

  try {
    // Get RSS feeds for the requested category
    const categoryFeeds = RSS_FEEDS.filter(feed => feed.category === category);
    if (categoryFeeds.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'No feeds available for this category',
          category: category
        })
      };
    }

    // Fetch articles from RSS feeds
    const articles = [];
    for (const feed of categoryFeeds) {
      try {
        const feedData = await fetchWithRetry(feed);
        
        // Process articles
        const newArticles = feedData.items.map(item => ({
          category: feed.category,
          title: item.title,
          content: item.contentSnippet || item.description || item['content:encoded'] || item.summary || '',
          url: item.link,
          source: feedData.title || feed.url.split('/')[2],
          timestamp: new Date(item.pubDate || item.isoDate || new Date()).toISOString()
        }));

        articles.push(...newArticles);
      } catch (error) {
        console.error(`Failed to process feed ${feed.url}:`, error.message);
      }
      await delay(2000); // Delay between feed requests
    }

    // Sort by timestamp and keep most recent 5
    const recentArticles = articles
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);

    if (recentArticles.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'No articles available',
          category: category
        })
      };
    }

    // Analyze sentiment for each article
    const analyzedArticles = [];
    for (const article of recentArticles) {
      try {
        const analysis = await analyzeSentiment(article);
        analyzedArticles.push(analysis);
      } catch (error) {
        console.error(`Error analyzing article: ${article.title}`, error);
      }
      await delay(1000); // Delay between analysis requests
    }

    // Categorize articles by sentiment
    const positive = analyzedArticles
      .filter(a => a.sentiment_score > 0.3)
      .sort((a, b) => b.sentiment_score - a.sentiment_score);

    const negative = analyzedArticles
      .filter(a => a.sentiment_score < -0.3)
      .sort((a, b) => a.sentiment_score - b.sentiment_score);

    const neutral = analyzedArticles
      .filter(a => a.sentiment_score >= -0.3 && a.sentiment_score <= 0.3);

    // Return the results
    return {
      statusCode: 200,
      body: JSON.stringify({
        category,
        summary: {
          total_articles: recentArticles.length,
          analyzed_articles: analyzedArticles.length,
          positive_count: positive.length,
          negative_count: negative.length,
          neutral_count: neutral.length
        },
        articles: {
          positive,
          negative,
          neutral
        },
        last_updated: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error(`Error processing ${category} articles:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error while analyzing articles',
        message: error.message,
        category: category
      })
    };
  }
};