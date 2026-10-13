// Netlify Serverless Function: search.js
// Searches Yahoo Finance tickers and companies for live autocomplete

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const q = (event.queryStringParameters && event.queryStringParameters.q ? event.queryStringParameters.q : '').trim();
  if (!q) {
    return { statusCode: 200, headers, body: JSON.stringify([]) };
  }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    const data = await resp.json();
    const quotes = (data.quotes || []).filter(item => item.isYahooFinance !== false && item.symbol);
    const results = quotes.map(item => ({
      Ticker: item.symbol,
      Name: item.shortname || item.longname || item.symbol,
      Exchange: item.exchange || item.quoteType || 'STOCK',
      Country: item.exchDisp || ''
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(results)
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify([])
    };
  }
};
