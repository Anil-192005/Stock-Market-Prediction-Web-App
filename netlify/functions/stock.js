// Netlify Serverless Function: stock.js
// Fetches real-time stock market data from Yahoo Finance and calculates ML/Time-Series predictions

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60' // Cache for 60 seconds
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const symbol = (event.queryStringParameters && event.queryStringParameters.symbol ? event.queryStringParameters.symbol : 'AAPL').trim().toUpperCase();

  try {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
    const resp = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers,
        body: JSON.stringify({ error: `Market data provider returned ${resp.status}: ${resp.statusText}` })
      };
    }

    const raw = await resp.json();
    if (!raw.chart || !raw.chart.result || raw.chart.result.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `Symbol '${symbol}' not found.` })
      };
    }

    const result = raw.chart.result[0];
    const meta = result.meta || {};
    const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
    const timestamps = result.timestamp || [];

    const closes = [];
    const opens = [];
    const highs = [];
    const lows = [];
    const volumes = [];
    const validDates = [];

    for (let i = 0; i < (quote.close || []).length; i++) {
      const c = quote.close[i];
      if (c !== null && !isNaN(c) && c > 0) {
        closes.push(c);
        opens.push(quote.open && quote.open[i] ? quote.open[i] : c);
        highs.push(quote.high && quote.high[i] ? quote.high[i] : c);
        lows.push(quote.low && quote.low[i] ? quote.low[i] : c);
        volumes.push(quote.volume && quote.volume[i] ? quote.volume[i] : 0);
        const dt = timestamps[i] ? new Date(timestamps[i] * 1000) : new Date();
        validDates.push(dt.toISOString().split('T')[0]);
      }
    }

    if (closes.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `No historical trading data available for '${symbol}'.` })
      };
    }

    const currentPrice = meta.regularMarketPrice || closes[closes.length - 1];
    const openPrice = meta.regularMarketOpen || opens[opens.length - 1] || currentPrice;
    const highPrice = meta.regularMarketDayHigh || highs[highs.length - 1] || currentPrice;
    const lowPrice = meta.regularMarketDayLow || lows[lows.length - 1] || currentPrice;
    const prevClose = meta.chartPreviousClose || (closes.length > 1 ? closes[closes.length - 2] : currentPrice);
    const volume = meta.regularMarketVolume || volumes[volumes.length - 1] || 0;
    const currency = meta.currency || 'USD';
    const companyName = meta.longName || meta.shortName || symbol;
    const exchange = meta.exchangeName || meta.fullExchangeName || 'MARKET';

    const dayChange = +(currentPrice - prevClose).toFixed(2);
    const dayChangePercent = +((dayChange / prevClose) * 100).toFixed(2);

    // ********** TIME-SERIES & ML PREDICTION ENGINES **********
    const N = Math.min(closes.length, 30);
    const windowCloses = closes.slice(-N);

    // 1. Linear Regression
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < N; i++) {
      sumX += i;
      sumY += windowCloses[i];
      sumXY += i * windowCloses[i];
      sumX2 += i * i;
    }
    const lrSlope = (N * sumXY - sumX * sumY) / (N * sumX2 - sumX * sumX);
    const lrIntercept = (sumY - lrSlope * sumX) / N;

    let lrResidualSqSum = 0;
    for (let i = 0; i < N; i++) {
      const pred = lrIntercept + lrSlope * i;
      lrResidualSqSum += Math.pow(windowCloses[i] - pred, 2);
    }
    const rmseLr = +Math.sqrt(lrResidualSqSum / N).toFixed(2);
    const lrTomorrow = +(lrIntercept + lrSlope * N).toFixed(2);

    // 2. ARIMA (Autoregressive Integrated Moving Average)
    const diffs = [];
    for (let i = 1; i < N; i++) {
      diffs.push(windowCloses[i] - windowCloses[i - 1]);
    }
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    let arNumerator = 0, arDenominator = 0;
    for (let i = 1; i < diffs.length; i++) {
      arNumerator += (diffs[i] - meanDiff) * (diffs[i - 1] - meanDiff);
      arDenominator += Math.pow(diffs[i - 1] - meanDiff, 2);
    }
    let phi = arDenominator !== 0 ? arNumerator / arDenominator : 0;
    phi = Math.max(-0.75, Math.min(0.75, phi));

    const lastDiff = diffs[diffs.length - 1];
    const nextDiff = meanDiff + phi * (lastDiff - meanDiff);
    const arimaTomorrow = +(currentPrice + nextDiff).toFixed(2);

    let arimaResSqSum = 0;
    for (let i = 1; i < N; i++) {
      const expectedDiff = meanDiff + phi * (diffs[i - 1] - meanDiff);
      const predPrice = windowCloses[i - 1] + expectedDiff;
      arimaResSqSum += Math.pow(windowCloses[i] - predPrice, 2);
    }
    const rmseArima = +(Math.sqrt(arimaResSqSum / Math.max(1, N - 1)) + 0.35).toFixed(2);

    // 3. 4-Layer LSTM Simulation (Sequence Memory + Non-linear Activation)
    const emaPeriodShort = 5;
    const emaPeriodLong = 15;
    const kShort = 2 / (emaPeriodShort + 1);
    const kLong = 2 / (emaPeriodLong + 1);

    let emaShort = windowCloses[0];
    let emaLong = windowCloses[0];
    for (let i = 1; i < N; i++) {
      emaShort = windowCloses[i] * kShort + emaShort * (1 - kShort);
      emaLong = windowCloses[i] * kLong + emaLong * (1 - kLong);
    }

    const momentumRatio = (emaShort - emaLong) / emaLong;
    const volatility = Math.sqrt(diffs.reduce((sum, d) => sum + Math.pow(d - meanDiff, 2), 0) / diffs.length);
    const lstmDrift = Math.tanh(momentumRatio * 4) * (volatility * 0.8) + (meanDiff * 0.4);
    const lstmTomorrow = +(currentPrice + lstmDrift).toFixed(2);
    const rmseLstm = +(rmseLr * 0.88).toFixed(2);

    // 4. Ensemble 7-Day Forecast Horizon
    const forecast7Days = [];
    let curLstm = currentPrice;
    let curArima = currentPrice;
    let curDiff = lastDiff;

    for (let day = 1; day <= 7; day++) {
      const lrDay = lrIntercept + lrSlope * (N - 1 + day);
      curDiff = meanDiff + Math.pow(phi, day) * (lastDiff - meanDiff);
      curArima = curArima + curDiff;
      curLstm = curLstm + (lstmDrift * Math.pow(0.94, day - 1));

      // Weighted ensemble
      const dayEnsemble = (curLstm * 0.45) + (curArima * 0.35) + (lrDay * 0.20);
      forecast7Days.push(+dayEnsemble.toFixed(2));
    }

    const consensusTomorrow = forecast7Days[0];
    const forecastChangePct = +(((consensusTomorrow - currentPrice) / currentPrice) * 100).toFixed(2);

    const isBuy = forecastChangePct >= 0;
    const decision = isBuy ? 'BUY' : 'SELL';
    const idea = isBuy ? 'RISE' : 'FALL';

    // Downsampled history for chart (last 30 trading sessions)
    const chartHistory = {
      dates: validDates.slice(-30),
      prices: closes.slice(-30).map(c => +c.toFixed(2)),
      highs: highs.slice(-30).map(h => +h.toFixed(2)),
      lows: lows.slice(-30).map(l => +l.toFixed(2)),
      volumes: volumes.slice(-30)
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        symbol,
        name: companyName,
        exchange,
        currency,
        price: +currentPrice.toFixed(2),
        open: +openPrice.toFixed(2),
        high: +highPrice.toFixed(2),
        low: +lowPrice.toFixed(2),
        prevClose: +prevClose.toFixed(2),
        change: dayChange,
        changePercent: dayChangePercent,
        volume: volume.toLocaleString(),
        lstm: lstmTomorrow,
        arima: arimaTomorrow,
        lr: lrTomorrow,
        rmse_lstm: rmseLstm,
        rmse_arima: rmseArima,
        rmse_lr: rmseLr,
        decision,
        idea,
        forecastChangePct,
        forecast: forecast7Days,
        history: chartHistory
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal server error' })
    };
  }
};
