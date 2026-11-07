/**
 * ============================================================================
 * Groww-Style Real-Time Stock Engine (GrowwEngine)
 * ============================================================================
 * Provides:
 * 1. Second-to-second / minute-to-minute live price & tick streaming
 * 2. High-performance Canvas charting (Line Spline & Candlestick OHLC)
 * 3. Timeframe switches (1D Live, 1W, 1M, 1Y, 3Y, 5Y, ALL)
 * 4. Interactive Crosshair & Floating Tooltip with live pulsing indicator
 * 5. Groww Performance Range Sliders (Today's Low/High, 52-Week Range)
 * 6. Live Level 2 Market Depth (Order Book) with Buyer/Seller Sentiment Meter
 * 7. Instant Buy/Sell Order Pad & Virtual Portfolio Tracker with real-time P&L
 * 8. Web Audio API synthesized soft trading chimes
 */

(function (window) {
  'use strict';

  // ==========================================
  // 1. Audio FX Module (Web Audio API)
  // ==========================================
  const GrowwAudio = {
    enabled: false,
    audioCtx: null,

    init() {
      if (!this.audioCtx && (window.AudioContext || window.webkitAudioContext)) {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.audioCtx = new AudioContextClass();
        } catch (e) {
          console.warn('AudioContext not available');
        }
      }
    },

    toggle() {
      this.enabled = !this.enabled;
      if (this.enabled) this.init();
      return this.enabled;
    },

    playTick(isUp) {
      if (!this.enabled || !this.audioCtx) return;
      try {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isUp ? 880 : 440, this.audioCtx.currentTime);
        gain.gain.setValueAtTime(0.02, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.08);
      } catch (e) {}
    },

    playOrderSuccess() {
      if (!this.enabled || !this.audioCtx) return;
      try {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const now = this.audioCtx.currentTime;
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.07);
          gain.gain.setValueAtTime(0.08, now + i * 0.07);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.15);
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now + i * 0.07);
          osc.stop(now + i * 0.07 + 0.16);
        });
      } catch (e) {}
    }
  };

  // ==========================================
  // 2. Real-Time Market Feed Simulator
  // ==========================================
  class GrowwFeed {
    constructor() {
      this.currentStock = null;
      this.currentPrice = 0;
      this.prevClose = 0;
      this.openPrice = 0;
      this.dayHigh = 0;
      this.dayLow = 0;
      this.volume = 1000000;
      this.intervalMs = 1000; // default 1 second
      this.timerId = null;
      this.isPaused = false;
      this.subscribers = [];
      this.intradayTicks = []; // array of { time: string, price: number }
      this.intradayCandles = []; // array of { time: string, open, high, low, close, volume }
      this.currentCandle = null;
    }

    setStock(stock) {
      this.currentStock = stock;
      this.currentPrice = stock.price || 100;
      this.prevClose = stock.prevClose || stock.price * 0.99;
      this.openPrice = stock.open || stock.price;
      this.dayHigh = stock.high || Math.max(this.currentPrice, this.openPrice);
      this.dayLow = stock.low || Math.min(this.currentPrice, this.openPrice);
      this.volume = typeof stock.volume === 'number' ? stock.volume : parseInt(String(stock.volume || '1000000').replace(/,/g, ''), 10) || 1250000;

      this.generateInitialIntraday();
      this.start();
    }

    generateInitialIntraday() {
      this.intradayTicks = [];
      this.intradayCandles = [];
      
      const count = 60; // 60 points representing historical intraday progression
      let p = this.openPrice;
      const target = this.currentPrice;
      const stepDrift = (target - p) / count;

      const startTime = new Date();
      startTime.setHours(9, 30, 0, 0); // 9:30 AM market open

      for (let i = 0; i < count; i++) {
        const t = new Date(startTime.getTime() + i * 5 * 60 * 1000); // 5 min interval
        const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Random micro volatility
        const rand = (Math.random() - 0.49) * (this.openPrice * 0.0035);
        p += stepDrift + rand;
        
        // Bound within dayHigh and dayLow
        p = Math.max(this.dayLow * 0.998, Math.min(this.dayHigh * 1.002, p));
        const finalP = i === count - 1 ? this.currentPrice : +p.toFixed(2);
        
        this.intradayTicks.push({
          time: timeStr,
          price: finalP,
          timestamp: t.getTime()
        });

        // Generate matching candle
        const o = +p.toFixed(2);
        const c = +(p + (Math.random() - 0.5) * (p * 0.002)).toFixed(2);
        const h = +(Math.max(o, c) + Math.random() * (p * 0.0015)).toFixed(2);
        const l = +(Math.min(o, c) - Math.random() * (p * 0.0015)).toFixed(2);
        const v = Math.floor(1000 + Math.random() * 5000);

        this.intradayCandles.push({
          time: timeStr,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: v
        });
      }

      // Initialize active working candle
      const last = this.intradayTicks[this.intradayTicks.length - 1];
      this.currentCandle = {
        time: last.time,
        open: last.price,
        high: last.price,
        low: last.price,
        close: last.price,
        volume: 250
      };
    }

    start() {
      this.stop();
      if (this.isPaused) return;

      this.timerId = setInterval(() => {
        this.nextTick();
      }, this.intervalMs);
    }

    stop() {
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    }

    setSpeed(speedMs) {
      this.intervalMs = speedMs;
      if (!this.isPaused) this.start();
    }

    togglePause() {
      this.isPaused = !this.isPaused;
      if (this.isPaused) {
        this.stop();
      } else {
        this.start();
      }
      return this.isPaused;
    }

    nextTick() {
      if (this.isPaused || !this.currentStock) return;

      // Calculate micro-tick using Ornstein-Uhlenbeck random walk centered around current valuation
      const volatility = 0.0008; // ~0.08% per tick
      const meanReversionDrift = (this.openPrice - this.currentPrice) * 0.0005;
      const brownian = (Math.random() - 0.495) * (this.currentPrice * volatility);
      const delta = +(brownian + meanReversionDrift).toFixed(2);
      
      const oldPrice = this.currentPrice;
      let newPrice = +(this.currentPrice + delta).toFixed(2);
      if (newPrice <= 0.05) newPrice = 0.05;

      this.currentPrice = newPrice;
      const isUp = newPrice >= oldPrice;

      // Update High & Low bounds
      if (newPrice > this.dayHigh) this.dayHigh = newPrice;
      if (newPrice < this.dayLow) this.dayLow = newPrice;

      // Increment volume
      const tickVol = Math.floor(25 + Math.random() * 150);
      this.volume += tickVol;

      // Calculate Day Change & Percent
      const change = +(newPrice - this.prevClose).toFixed(2);
      const changePct = +((change / this.prevClose) * 100).toFixed(2);

      // Now time
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Append tick to 1D series
      this.intradayTicks.push({
        time: timeStr,
        price: newPrice,
        timestamp: now.getTime()
      });
      // Cap at 200 intraday data points to ensure smooth performance
      if (this.intradayTicks.length > 200) {
        this.intradayTicks.shift();
      }

      // Update active candle
      if (this.currentCandle) {
        this.currentCandle.close = newPrice;
        if (newPrice > this.currentCandle.high) this.currentCandle.high = newPrice;
        if (newPrice < this.currentCandle.low) this.currentCandle.low = newPrice;
        this.currentCandle.volume += tickVol;
      }

      // Play soft tick sound if enabled
      GrowwAudio.playTick(isUp);

      const tickData = {
        symbol: this.currentStock.symbol,
        price: newPrice,
        oldPrice: oldPrice,
        delta: delta,
        isUp: isUp,
        change: change,
        changePercent: changePct,
        high: this.dayHigh,
        low: this.dayLow,
        open: this.openPrice,
        prevClose: this.prevClose,
        volume: this.volume,
        time: timeStr,
        ticks: this.intradayTicks,
        candles: this.intradayCandles,
        currentCandle: this.currentCandle
      };

      this.notify(tickData);
    }

    subscribe(fn) {
      if (typeof fn === 'function') {
        this.subscribers.push(fn);
      }
    }

    notify(data) {
      for (const fn of this.subscribers) {
        try {
          fn(data);
        } catch (e) {
          console.error('GrowwFeed subscriber error:', e);
        }
      }
    }
  }

  // ==========================================
  // 3. Groww High-Performance Interactive Canvas Chart
  // ==========================================
  class GrowwChart {
    constructor(canvasId, options = {}) {
      this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
      if (!this.canvas) return;

      this.ctx = this.canvas.getContext('2d');
      this.options = Object.assign({
        currencySym: '$',
        timeframe: '1D', // 1D, 1W, 1M, 1Y, 3Y, 5Y, ALL
        mode: 'line',     // 'line' or 'candle'
        showIndicators: { sma: false, ema: false, bollinger: false },
        onCrosshair: null
      }, options);

      this.dataPoints = []; // for line mode: { label, value, timestamp }
      this.candles = [];    // for candle mode: { label, open, high, low, close, volume }
      this.prevClose = 0;
      this.currentPrice = 0;
      
      this.hoverIndex = -1;
      this.mouseX = -1;
      this.mouseY = -1;
      this.isHovering = false;

      this.dpr = window.devicePixelRatio || 1;
      this.initCanvasSize();
      this.attachEventListeners();
    }

    initCanvasSize() {
      if (!this.canvas) return;
      const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : { width: 800, height: 350 };
      this.width = rect.width || 800;
      this.height = Math.max(280, rect.height || 350);

      this.canvas.width = this.width * this.dpr;
      this.canvas.height = this.height * this.dpr;
      this.canvas.style.width = this.width + 'px';
      this.canvas.style.height = this.height + 'px';
      this.ctx.scale(this.dpr, this.dpr);
    }

    attachEventListeners() {
      if (!this.canvas) return;

      window.addEventListener('resize', () => {
        this.initCanvasSize();
        this.render();
      });

      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        this.isHovering = true;
        this.calculateHoverIndex();
        this.render();
      });

      this.canvas.addEventListener('mouseleave', () => {
        this.isHovering = false;
        this.hoverIndex = -1;
        this.render();
        if (this.options.onCrosshair) {
          this.options.onCrosshair(null);
        }
      });

      // Touch support for mobile devices
      this.canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
          const rect = this.canvas.getBoundingClientRect();
          this.mouseX = e.touches[0].clientX - rect.left;
          this.mouseY = e.touches[0].clientY - rect.top;
          this.isHovering = true;
          this.calculateHoverIndex();
          this.render();
        }
      }, { passive: true });

      this.canvas.addEventListener('touchend', () => {
        this.isHovering = false;
        this.hoverIndex = -1;
        this.render();
        if (this.options.onCrosshair) {
          this.options.onCrosshair(null);
        }
      });
    }

    calculateHoverIndex() {
      const items = this.options.mode === 'candle' ? this.candles : this.dataPoints;
      if (!items || items.length === 0) return;

      const paddingLeft = 15;
      const paddingRight = 65;
      const chartWidth = this.width - paddingLeft - paddingRight;
      
      const relX = Math.max(0, Math.min(chartWidth, this.mouseX - paddingLeft));
      const step = chartWidth / (items.length - 1 || 1);
      this.hoverIndex = Math.min(items.length - 1, Math.max(0, Math.round(relX / step)));

      if (this.options.onCrosshair) {
        const selected = items[this.hoverIndex];
        this.options.onCrosshair(selected, this.prevClose);
      }
    }

    setTimeframe(tf, stockProfile) {
      this.options.timeframe = tf;
      if (tf === '1D') {
        // Intraday handled by live feed
        return;
      }

      // Generate realistic multi-period aggregated curves using historical profile
      this.loadHistoricalTimeframe(tf, stockProfile);
      this.render();
    }

    loadHistoricalTimeframe(tf, profile) {
      if (!profile) return;
      const baseHistory = profile.historyCloses || [profile.price * 0.9, profile.price];
      const dates = profile.historyDates || [];

      let pointsCount = 30;
      let multiplier = 1;

      if (tf === '1W') pointsCount = 7;
      else if (tf === '1M') pointsCount = 22;
      else if (tf === '1Y') pointsCount = 52;
      else if (tf === '3Y') pointsCount = 78;
      else if (tf === '5Y') pointsCount = 100;
      else if (tf === 'ALL') pointsCount = 120;

      this.dataPoints = [];
      this.candles = [];

      const current = profile.price;
      const startPrice = current * (tf === '1W' ? 0.98 : tf === '1M' ? 0.93 : tf === '1Y' ? 0.78 : tf === '5Y' ? 0.52 : 0.45);
      const stepDrift = (current - startPrice) / pointsCount;

      let p = startPrice;
      const now = new Date();

      for (let i = 0; i < pointsCount; i++) {
        const d = new Date(now.getTime() - (pointsCount - i) * (tf === '1W' ? 86400000 : tf === '1M' ? 86400000 : 7 * 86400000));
        const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: tf.includes('Y') || tf === 'ALL' ? '2-digit' : undefined });
        
        p += stepDrift + (Math.random() - 0.48) * (current * 0.025);
        if (i === pointsCount - 1) p = current;
        const val = +Math.max(1, p).toFixed(2);

        this.dataPoints.push({
          label: dateStr,
          value: val,
          timestamp: d.getTime()
        });

        // Candlestick representation
        const open = +(val * (1 + (Math.random() - 0.5) * 0.015)).toFixed(2);
        const close = val;
        const high = +(Math.max(open, close) + Math.random() * (val * 0.012)).toFixed(2);
        const low = +(Math.min(open, close) - Math.random() * (val * 0.012)).toFixed(2);
        const volume = Math.floor(50000 + Math.random() * 200000);

        this.candles.push({
          label: dateStr,
          open,
          high,
          low,
          close,
          volume
        });
      }

      this.prevClose = this.dataPoints[0].value;
      this.currentPrice = current;
    }

    setMode(mode) {
      this.options.mode = mode; // 'line' or 'candle'
      this.render();
    }

    toggleIndicator(name) {
      if (this.options.showIndicators.hasOwnProperty(name)) {
        this.options.showIndicators[name] = !this.options.showIndicators[name];
        this.render();
      }
      return this.options.showIndicators[name];
    }

    updateIntraday(ticks, candles, prevClose, currentPrice) {
      if (this.options.timeframe !== '1D') return;

      this.prevClose = prevClose;
      this.currentPrice = currentPrice;

      this.dataPoints = ticks.map(t => ({
        label: t.time,
        value: t.price,
        timestamp: t.timestamp
      }));

      this.candles = candles.map(c => Object.assign({}, c));
      this.render();
    }

    render() {
      if (!this.ctx || !this.canvas) return;

      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      // Clear Canvas
      ctx.clearRect(0, 0, w, h);

      const items = this.options.mode === 'candle' ? this.candles : this.dataPoints;
      if (!items || items.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Streaming market ticks...', w / 2, h / 2);
        return;
      }

      const paddingLeft = 15;
      const paddingRight = 65;
      const paddingTop = 25;
      const paddingBottom = 35;
      const chartWidth = w - paddingLeft - paddingRight;
      const chartHeight = h - paddingTop - paddingBottom;

      // Extract values to find Min / Max
      let minVal, maxVal;
      if (this.options.mode === 'candle') {
        minVal = Math.min(...items.map(c => c.low));
        maxVal = Math.max(...items.map(c => c.high));
      } else {
        minVal = Math.min(...items.map(p => p.value));
        maxVal = Math.max(...items.map(p => p.value));
      }

      // If prevClose is present, make sure it's within scale for reference
      if (this.prevClose > 0) {
        minVal = Math.min(minVal, this.prevClose * 0.999);
        maxVal = Math.max(maxVal, this.prevClose * 1.001);
      }

      // Add 5% breathing room
      const span = maxVal - minVal || 1;
      const yMin = minVal - span * 0.08;
      const yMax = maxVal + span * 0.08;
      const yRange = yMax - yMin;

      const getX = (index) => paddingLeft + (index / (items.length - 1 || 1)) * chartWidth;
      const getY = (val) => paddingTop + chartHeight - ((val - yMin) / yRange) * chartHeight;

      // 1. Draw Subtle Grid Lines & Y-Axis Labels
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#64748b';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';

      const gridSteps = 4;
      for (let i = 0; i <= gridSteps; i++) {
        const val = yMin + (yRange / gridSteps) * i;
        const y = getY(val);

        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(w - paddingRight, y);
        ctx.stroke();

        ctx.fillText(this.options.currencySym + val.toFixed(2), w - paddingRight + 8, y + 4);
      }

      // 2. Draw Previous Close Horizontal Dashed Line (Groww Style)
      if (this.prevClose > 0 && this.prevClose >= yMin && this.prevClose <= yMax) {
        const prevCloseY = getY(this.prevClose);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(paddingLeft, prevCloseY);
        ctx.lineTo(w - paddingRight, prevCloseY);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText('Prev Close', w - paddingRight + 8, prevCloseY - 3);
        ctx.restore();
      }

      // Determine gain/loss state: Groww Green (#00d09c) or Groww Red (#eb5b3c)
      const lastPrice = items[items.length - 1].close !== undefined ? items[items.length - 1].close : items[items.length - 1].value;
      const referenceBase = this.prevClose || (items[0].open !== undefined ? items[0].open : items[0].value);
      const isPositive = lastPrice >= referenceBase;

      const mainColor = isPositive ? '#00d09c' : '#eb5b3c';
      const gradientStart = isPositive ? 'rgba(0, 208, 156, 0.22)' : 'rgba(235, 91, 60, 0.22)';
      const gradientEnd = isPositive ? 'rgba(0, 208, 156, 0.00)' : 'rgba(235, 91, 60, 0.00)';

      // 3. Render Mode: Line or Candlestick
      if (this.options.mode === 'candle') {
        this.renderCandles(ctx, items, getX, getY, chartWidth);
      } else {
        this.renderLine(ctx, items, getX, getY, paddingTop, chartHeight, mainColor, gradientStart, gradientEnd);
      }

      // 4. Render Technical Indicators if toggled
      if (this.options.showIndicators.sma) {
        this.renderSMA(ctx, items, getX, getY, 20, '#38bdf8');
      }
      if (this.options.showIndicators.ema) {
        this.renderEMA(ctx, items, getX, getY, 50, '#f59e0b');
      }
      if (this.options.showIndicators.bollinger) {
        this.renderBollinger(ctx, items, getX, getY, 20, 'rgba(168, 85, 247, 0.4)');
      }

      // 5. Draw Time Axis Labels (Bottom)
      ctx.fillStyle = '#64748b';
      ctx.font = '10px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      const timeStep = Math.max(1, Math.floor(items.length / 5));
      for (let i = 0; i < items.length; i += timeStep) {
        const x = getX(i);
        ctx.fillText(items[i].label, x, h - 12);
      }

      // 6. Interactive Crosshair & Hover Tooltip
      if (this.isHovering && this.hoverIndex >= 0 && this.hoverIndex < items.length) {
        this.renderCrosshair(ctx, items[this.hoverIndex], this.hoverIndex, getX, getY, paddingLeft, paddingTop, chartWidth, chartHeight, mainColor);
      } else if (this.options.timeframe === '1D') {
        // Draw Groww Trademark Pulsing Tip Dot on latest point
        const lastIdx = items.length - 1;
        const lastX = getX(lastIdx);
        const lastY = getY(lastPrice);
        this.renderLivePulsingDot(ctx, lastX, lastY, mainColor);
      }
    }

    renderLine(ctx, items, getX, getY, paddingTop, chartHeight, mainColor, gradStart, gradEnd) {
      if (items.length < 2) return;

      // Area Fill Gradient
      const grad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight);
      grad.addColorStop(0, gradStart);
      grad.addColorStop(1, gradEnd);

      ctx.beginPath();
      ctx.moveTo(getX(0), getY(items[0].value));

      for (let i = 1; i < items.length; i++) {
        const prevX = getX(i - 1);
        const prevY = getY(items[i - 1].value);
        const curX = getX(i);
        const curY = getY(items[i].value);

        const midX = (prevX + curX) / 2;
        ctx.bezierCurveTo(midX, prevY, midX, curY, curX, curY);
      }

      // Close polygon for area fill
      ctx.lineTo(getX(items.length - 1), paddingTop + chartHeight);
      ctx.lineTo(getX(0), paddingTop + chartHeight);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke Spline Line
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(items[0].value));
      for (let i = 1; i < items.length; i++) {
        const prevX = getX(i - 1);
        const prevY = getY(items[i - 1].value);
        const curX = getX(i);
        const curY = getY(items[i].value);

        const midX = (prevX + curX) / 2;
        ctx.bezierCurveTo(midX, prevY, midX, curY, curX, curY);
      }
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    renderCandles(ctx, candles, getX, getY, chartWidth) {
      const candleWidth = Math.max(3, Math.min(14, (chartWidth / candles.length) * 0.7));

      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const x = getX(i);
        const isGreen = c.close >= c.open;
        const color = isGreen ? '#00d09c' : '#eb5b3c';

        const highY = getY(c.high);
        const lowY = getY(c.low);
        const openY = getY(c.open);
        const closeY = getY(c.close);

        // Draw Wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Draw Body
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));

        ctx.fillStyle = color;
        ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      }
    }

    renderLivePulsingDot(ctx, x, y, color) {
      ctx.save();
      // Outer subtle ring
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color === '#00d09c' ? 'rgba(0, 208, 156, 0.35)' : 'rgba(235, 91, 60, 0.35)';
      ctx.fill();

      // Inner solid dot
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // White center point
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }

    renderCrosshair(ctx, item, idx, getX, getY, padL, padT, cWidth, cHeight, mainColor) {
      const x = getX(idx);
      const val = item.close !== undefined ? item.close : item.value;
      const y = getY(val);

      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + cHeight);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + cWidth, y);
      ctx.stroke();
      ctx.restore();

      // Highlight point on curve
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = mainColor;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Floating Tooltip Badge at Top Center
      const priceStr = this.options.currencySym + val.toFixed(2);
      const changeFromRef = +(val - (this.prevClose || val)).toFixed(2);
      const changePct = this.prevClose ? +((changeFromRef / this.prevClose) * 100).toFixed(2) : 0;
      const changeStr = `${changeFromRef >= 0 ? '+' : ''}${changeFromRef.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct}%)`;

      const tooltipText = `${item.label}  •  ${priceStr}  •  ${changeStr}`;
      ctx.font = '600 12px Plus Jakarta Sans, sans-serif';
      const textWidth = ctx.measureText(tooltipText).width;
      const boxW = textWidth + 24;
      const boxH = 28;
      const boxX = Math.max(padL, Math.min(padL + cWidth - boxW, x - boxW / 2));
      const boxY = 4;

      ctx.save();
      ctx.fillStyle = 'rgba(15, 20, 28, 0.95)';
      ctx.strokeStyle = changeFromRef >= 0 ? '#00d09c' : '#eb5b3c';
      ctx.lineWidth = 1;
      this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(tooltipText, boxX + boxW / 2, boxY + 18);
      ctx.restore();
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width, y + height);
      ctx.lineTo(x + width - radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    // Technical Indicators
    renderSMA(ctx, items, getX, getY, period, color) {
      if (items.length < period) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      let started = false;
      for (let i = period - 1; i < items.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          const v = items[i - j].close !== undefined ? items[i - j].close : items[i - j].value;
          sum += v;
        }
        const sma = sum / period;
        const x = getX(i);
        const y = getY(sma);

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    renderEMA(ctx, items, getX, getY, period, color) {
      if (items.length < 5) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const k = 2 / (period + 1);
      let ema = items[0].close !== undefined ? items[0].close : items[0].value;
      ctx.moveTo(getX(0), getY(ema));

      for (let i = 1; i < items.length; i++) {
        const v = items[i].close !== undefined ? items[i].close : items[i].value;
        ema = v * k + ema * (1 - k);
        ctx.lineTo(getX(i), getY(ema));
      }
      ctx.stroke();
      ctx.restore();
    }

    renderBollinger(ctx, items, getX, getY, period, color) {
      if (items.length < period) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;

      const upperPoints = [];
      const lowerPoints = [];

      for (let i = period - 1; i < items.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += items[i - j].close !== undefined ? items[i - j].close : items[i - j].value;
        }
        const mean = sum / period;
        let variance = 0;
        for (let j = 0; j < period; j++) {
          const v = items[i - j].close !== undefined ? items[i - j].close : items[i - j].value;
          variance += Math.pow(v - mean, 2);
        }
        const std = Math.sqrt(variance / period);
        upperPoints.push({ x: getX(i), y: getY(mean + std * 2) });
        lowerPoints.push({ x: getX(i), y: getY(mean - std * 2) });
      }

      // Draw Upper Band
      ctx.beginPath();
      upperPoints.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      // Draw Lower Band
      ctx.beginPath();
      lowerPoints.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  // ==========================================
  // 4. Groww Performance Range Sliders Widget
  // ==========================================
  const GrowwPerformance = {
    update(price, low, high, w52Low, w52High, currencySym = '$') {
      // 1. Today's Range
      const todaySpan = high - low || 1;
      const todayPos = Math.max(0, Math.min(100, ((price - low) / todaySpan) * 100));

      const todayNeedle = document.getElementById('growwTodayNeedle');
      const todayLowEl = document.getElementById('growwTodayLow');
      const todayHighEl = document.getElementById('growwTodayHigh');

      if (todayNeedle) todayNeedle.style.left = todayPos + '%';
      if (todayLowEl) todayLowEl.textContent = currencySym + low.toFixed(2);
      if (todayHighEl) todayHighEl.textContent = currencySym + high.toFixed(2);

      // 2. 52-Week Range
      const effective52Low = w52Low || +(low * 0.72).toFixed(2);
      const effective52High = w52High || +(high * 1.25).toFixed(2);
      const span52 = effective52High - effective52Low || 1;
      const pos52 = Math.max(0, Math.min(100, ((price - effective52Low) / span52) * 100));

      const needle52 = document.getElementById('groww52WNeedle');
      const low52El = document.getElementById('groww52WLow');
      const high52El = document.getElementById('groww52WHigh');

      if (needle52) needle52.style.left = pos52 + '%';
      if (low52El) low52El.textContent = currencySym + effective52Low.toFixed(2);
      if (high52El) high52El.textContent = currencySym + effective52High.toFixed(2);
    }
  };

  // ==========================================
  // 5. Groww Level 2 Market Depth (Order Book)
  // ==========================================
  const GrowwMarketDepth = {
    bids: [],
    asks: [],
    sessionBuyersBase: 12450,
    sessionSellersBase: 8920,

    init(price) {
      this.sessionBuyersBase = Math.floor(10000 + Math.random() * 8000);
      this.sessionSellersBase = Math.floor(7000 + Math.random() * 7000);
      this.generate(price);
    },

    generate(price) {
      this.bids = [];
      this.asks = [];

      for (let i = 1; i <= 5; i++) {
        const bidPrice = +(price - i * (price * 0.0006)).toFixed(2);
        const bidQty = Math.floor(350 + Math.random() * 1850);
        const buyers = Math.max(15, Math.floor(bidQty * (0.12 + Math.random() * 0.08) + Math.random() * 25));
        this.bids.push({ price: bidPrice, qty: bidQty, buyers: buyers });

        const askPrice = +(price + i * (price * 0.0006)).toFixed(2);
        const askQty = Math.floor(350 + Math.random() * 1850);
        const sellers = Math.max(12, Math.floor(askQty * (0.12 + Math.random() * 0.08) + Math.random() * 25));
        this.asks.push({ price: askPrice, qty: askQty, sellers: sellers });
      }
      this.render();
    },

    update(price) {
      // Micro shift quantities and people counts
      this.bids.forEach((b, i) => {
        b.price = +(price - (i + 1) * (price * 0.0005)).toFixed(2);
        const dQty = Math.floor((Math.random() - 0.48) * 65);
        b.qty = Math.max(50, b.qty + dQty);
        b.buyers = Math.max(10, Math.floor(b.qty * (0.12 + Math.random() * 0.08) + Math.random() * 15));
      });
      this.asks.forEach((a, i) => {
        a.price = +(price + (i + 1) * (price * 0.0005)).toFixed(2);
        const dQty = Math.floor((Math.random() - 0.48) * 65);
        a.qty = Math.max(50, a.qty + dQty);
        a.sellers = Math.max(8, Math.floor(a.qty * (0.12 + Math.random() * 0.08) + Math.random() * 15));
      });

      // Shift session pool
      this.sessionBuyersBase = Math.max(1000, this.sessionBuyersBase + Math.floor((Math.random() - 0.48) * 20));
      this.sessionSellersBase = Math.max(1000, this.sessionSellersBase + Math.floor((Math.random() - 0.48) * 20));

      this.render();
    },

    render() {
      const tbody = document.getElementById('growwDepthBody');
      if (!tbody) return;

      const totalBidQty = this.bids.reduce((a, b) => a + b.qty, 0);
      const totalAskQty = this.asks.reduce((a, b) => a + b.qty, 0);
      const l2Buyers = this.bids.reduce((a, b) => a + b.buyers, 0);
      const l2Sellers = this.asks.reduce((a, b) => a + b.sellers, 0);

      // Total session market participants (L2 depth + broader queue)
      const totalSessionBuyers = this.sessionBuyersBase + l2Buyers;
      const totalSessionSellers = this.sessionSellersBase + l2Sellers;
      const totalPeople = totalSessionBuyers + totalSessionSellers || 1;
      const buyPct = Math.round((totalSessionBuyers / totalPeople) * 100);
      const sellPct = 100 - buyPct;

      const maxBid = Math.max(...this.bids.map(b => b.qty)) || 1;
      const maxAsk = Math.max(...this.asks.map(a => a.qty)) || 1;

      let html = '';
      for (let i = 0; i < 5; i++) {
        const b = this.bids[i] || { price: 0, qty: 0, buyers: 0 };
        const a = this.asks[i] || { price: 0, qty: 0, sellers: 0 };
        const bPct = Math.min(100, Math.round((b.qty / maxBid) * 100));
        const aPct = Math.min(100, Math.round((a.qty / maxAsk) * 100));

        html += `
          <tr>
            <td style="padding: 0.45rem 0.65rem; color: #00d09c; font-weight: 700; font-family: var(--font-mono); text-align: left;">
              <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                <i class="fa-solid fa-user" style="font-size: 0.72rem; opacity: 0.75;"></i>
                ${b.buyers.toLocaleString()}
              </span>
            </td>
            <td style="position: relative; padding: 0.45rem 0.65rem; color: #00d09c; font-weight: 600; font-family: var(--font-mono); text-align: left;">
              <div class="depth-bar-green" style="width: ${bPct}%;"></div>
              <span style="position: relative; z-index: 1;">${b.qty.toLocaleString()}</span>
            </td>
            <td style="padding: 0.45rem 0.65rem; color: #fff; font-family: var(--font-mono); font-weight: 600;">${b.price.toFixed(2)}</td>
            <td style="padding: 0.45rem 0.65rem; color: #fff; font-family: var(--font-mono); font-weight: 600; text-align: right;">${a.price.toFixed(2)}</td>
            <td style="position: relative; padding: 0.45rem 0.65rem; color: #eb5b3c; font-weight: 600; font-family: var(--font-mono); text-align: right;">
              <div class="depth-bar-red" style="width: ${aPct}%;"></div>
              <span style="position: relative; z-index: 1;">${a.qty.toLocaleString()}</span>
            </td>
            <td style="padding: 0.45rem 0.65rem; color: #eb5b3c; font-weight: 700; font-family: var(--font-mono); text-align: right;">
              <span style="display: inline-flex; align-items: center; gap: 0.35rem; justify-content: flex-end;">
                ${a.sellers.toLocaleString()}
                <i class="fa-solid fa-user" style="font-size: 0.72rem; opacity: 0.75;"></i>
              </span>
            </td>
          </tr>
        `;
      }
      tbody.innerHTML = html;

      // Update Participant Cards & Summary Stats
      const totalBuyersEl = document.getElementById('growwTotalBuyersCount');
      const buyersShareEl = document.getElementById('growwBuyersSharePct');
      const totalSellersEl = document.getElementById('growwTotalSellersCount');
      const sellersShareEl = document.getElementById('growwSellersSharePct');
      const netFlowEl = document.getElementById('growwNetBuyerSellerFlow');
      const ratioEl = document.getElementById('growwPeopleRatio');

      if (totalBuyersEl) totalBuyersEl.textContent = `${totalSessionBuyers.toLocaleString()} People`;
      if (buyersShareEl) buyersShareEl.textContent = `${buyPct}% of order book participants`;
      if (totalSellersEl) totalSellersEl.textContent = `${totalSessionSellers.toLocaleString()} People`;
      if (sellersShareEl) sellersShareEl.textContent = `${sellPct}% of order book participants`;

      const diff = totalSessionBuyers - totalSessionSellers;
      if (netFlowEl) {
        if (diff >= 0) {
          netFlowEl.innerHTML = `<span class="groww-text-green">+${diff.toLocaleString()} More Buyers</span>`;
        } else {
          netFlowEl.innerHTML = `<span class="groww-text-red">+${Math.abs(diff).toLocaleString()} More Sellers</span>`;
        }
      }
      if (ratioEl) {
        const r = (totalSessionBuyers / (totalSessionSellers || 1)).toFixed(2);
        ratioEl.textContent = `${r} Buyers per Seller`;
      }

      // Update Sentiment Meter Bar
      const buyBar = document.getElementById('growwSentimentBuy');
      const sellBar = document.getElementById('growwSentimentSell');
      const buyText = document.getElementById('growwBuyPctText');
      const sellText = document.getElementById('growwSellPctText');

      if (buyBar) buyBar.style.width = buyPct + '%';
      if (sellBar) sellBar.style.width = sellPct + '%';
      if (buyText) buyText.textContent = `${buyPct}% Buyers (${totalSessionBuyers.toLocaleString()} People)`;
      if (sellText) sellText.textContent = `${sellPct}% Sellers (${totalSessionSellers.toLocaleString()} People)`;
    }
  };

  // ==========================================
  // 6. Groww Instant Buy / Sell Order Pad & Virtual Portfolio
  // ==========================================
  const GrowwOrderPad = {
    symbol: '',
    price: 0,
    action: 'BUY',     // 'BUY' or 'SELL'
    orderType: 'DELIVERY', // 'DELIVERY' or 'INTRADAY'
    priceMode: 'MARKET',   // 'MARKET' or 'LIMIT'
    quantity: 1,
    limitPrice: 0,
    currencySym: '$',

    init(symbol, price, currencySym = '$') {
      this.symbol = symbol;
      this.price = price;
      this.limitPrice = price;
      this.currencySym = currencySym;
      this.updateCalculations();
      this.renderPortfolio();
    },

    setPrice(newPrice) {
      this.price = newPrice;
      if (this.priceMode === 'MARKET') {
        this.limitPrice = newPrice;
      }
      this.updateCalculations();
      this.updatePortfolioLivePrices(newPrice);
    },

    setAction(action) {
      this.action = action;
      const buyTab = document.getElementById('orderTabBuy');
      const sellTab = document.getElementById('orderTabSell');
      const submitBtn = document.getElementById('orderSubmitBtn');

      if (action === 'BUY') {
        if (buyTab) buyTab.classList.add('active');
        if (sellTab) sellTab.classList.remove('active');
        if (submitBtn) {
          submitBtn.className = 'btn-groww-buy';
          submitBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Instant BUY ${this.symbol}`;
        }
      } else {
        if (buyTab) buyTab.classList.remove('active');
        if (sellTab) sellTab.classList.add('active');
        if (submitBtn) {
          submitBtn.className = 'btn-groww-sell';
          submitBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Instant SELL ${this.symbol}`;
        }
      }
      this.updateCalculations();
    },

    setProduct(product) {
      this.orderType = product; // 'DELIVERY' or 'INTRADAY'
      const delivPill = document.getElementById('pillDelivery');
      const intraPill = document.getElementById('pillIntraday');

      if (product === 'DELIVERY') {
        if (delivPill) delivPill.classList.add('active');
        if (intraPill) intraPill.classList.remove('active');
      } else {
        if (delivPill) delivPill.classList.remove('active');
        if (intraPill) intraPill.classList.add('active');
      }
      this.updateCalculations();
    },

    setQuantity(qty) {
      this.quantity = Math.max(1, parseInt(qty, 10) || 1);
      const qtyInput = document.getElementById('orderQtyInput');
      if (qtyInput) qtyInput.value = this.quantity;
      this.updateCalculations();
    },

    addQty(delta) {
      this.setQuantity(this.quantity + delta);
    },

    updateCalculations() {
      const execPrice = this.priceMode === 'MARKET' ? this.price : (this.limitPrice || this.price);
      const totalAmount = this.quantity * execPrice;
      const marginReq = this.orderType === 'INTRADAY' ? totalAmount * 0.20 : totalAmount; // 5x leverage for intraday

      const marginEl = document.getElementById('orderMarginVal');
      const chargesEl = document.getElementById('orderChargesVal');

      if (marginEl) marginEl.textContent = `${this.currencySym}${marginReq.toFixed(2)}`;
      if (chargesEl) chargesEl.textContent = `${this.currencySym}0.00 (Zero Brokerage)`;
    },

    executeOrder() {
      const execPrice = this.priceMode === 'MARKET' ? this.price : (this.limitPrice || this.price);
      const totalVal = +(this.quantity * execPrice).toFixed(2);

      const portfolio = this.getPortfolio();

      if (this.action === 'BUY') {
        // Add or update holding
        const existing = portfolio.find(p => p.symbol === this.symbol && p.product === this.orderType);
        if (existing) {
          const totalSpent = (existing.qty * existing.avgPrice) + totalVal;
          existing.qty += this.quantity;
          existing.avgPrice = +(totalSpent / existing.qty).toFixed(2);
        } else {
          portfolio.push({
            symbol: this.symbol,
            product: this.orderType,
            qty: this.quantity,
            avgPrice: execPrice,
            currency: this.currencySym,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        // SELL
        const existingIndex = portfolio.findIndex(p => p.symbol === this.symbol && p.product === this.orderType);
        if (existingIndex >= 0) {
          const existing = portfolio[existingIndex];
          if (existing.qty <= this.quantity) {
            portfolio.splice(existingIndex, 1);
          } else {
            existing.qty -= this.quantity;
          }
        } else {
          alert(`You do not hold any shares of ${this.symbol} (${this.orderType}) to sell.`);
          return;
        }
      }

      this.savePortfolio(portfolio);
      GrowwAudio.playOrderSuccess();
      this.showToast(`${this.action} Order Placed: ${this.quantity} shares of ${this.symbol} @ ${this.currencySym}${execPrice.toFixed(2)}`);
      this.renderPortfolio();
    },

    getPortfolio() {
      try {
        const stored = localStorage.getItem('groww_virtual_portfolio');
        return stored ? JSON.parse(stored) : [];
      } catch (e) {
        return [];
      }
    },

    savePortfolio(data) {
      try {
        localStorage.setItem('groww_virtual_portfolio', JSON.stringify(data));
      } catch (e) {}
    },

    renderPortfolio() {
      const container = document.getElementById('growwPortfolioHoldings');
      const totalInvestedEl = document.getElementById('portfolioTotalInvested');
      const currentValueEl = document.getElementById('portfolioCurrentVal');
      const totalPnlEl = document.getElementById('portfolioTotalPnl');
      if (!container) return;

      const portfolio = this.getPortfolio();
      if (portfolio.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2rem 1rem; color: #64748b;">
            <i class="fa-solid fa-wallet" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.4;"></i>
            <p style="font-size: 0.88rem;">No open positions yet. Use the Buy order pad to start paper trading with zero risk!</p>
          </div>
        `;
        if (totalInvestedEl) totalInvestedEl.textContent = `${this.currencySym}0.00`;
        if (currentValueEl) currentValueEl.textContent = `${this.currencySym}0.00`;
        if (totalPnlEl) {
          totalPnlEl.textContent = `${this.currencySym}0.00 (0.00%)`;
          totalPnlEl.className = 'stat-value';
        }
        return;
      }

      let totalInvested = 0;
      let totalCurrent = 0;

      let html = '';
      portfolio.forEach((p, index) => {
        const curPrice = p.symbol === this.symbol ? this.price : p.avgPrice; // live if currently viewed
        const invested = p.qty * p.avgPrice;
        const current = p.qty * curPrice;
        const pnl = current - invested;
        const pnlPct = (pnl / invested) * 100;

        totalInvested += invested;
        totalCurrent += current;

        const isGain = pnl >= 0;
        const pnlClass = isGain ? 'groww-text-green' : 'groww-text-red';

        html += `
          <div class="portfolio-holding-card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.4rem;">
              <div>
                <strong style="font-family: var(--font-mono); color: #fff; font-size: 1rem;">${p.symbol}</strong>
                <span class="badge-sub" style="font-size: 0.7rem; background: rgba(255,255,255,0.06); color: #94a3b8;">${p.product}</span>
              </div>
              <div style="text-align: right;">
                <span class="${pnlClass}" style="font-weight: 700; font-family: var(--font-mono);">
                  ${pnl >= 0 ? '+' : ''}${this.currencySym}${pnl.toFixed(2)}
                </span>
                <span style="display: block; font-size: 0.72rem; color: ${isGain ? '#00d09c' : '#eb5b3c'};">
                  (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)
                </span>
              </div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: #94a3b8;">
              <span>${p.qty} Shares • Avg ${this.currencySym}${p.avgPrice.toFixed(2)}</span>
              <span>LTP ${this.currencySym}${curPrice.toFixed(2)}</span>
            </div>
            <button onclick="window.GrowwOrderPad.squareOff(${index})" class="btn-square-off" style="margin-top: 0.5rem; width: 100%; padding: 0.35rem; font-size: 0.78rem; border-radius: 6px; background: rgba(235, 91, 60, 0.15); color: #eb5b3c; border: 1px solid rgba(235, 91, 60, 0.3); cursor: pointer;">
              Square Off / Exit
            </button>
          </div>
        `;
      });

      container.innerHTML = html;

      const overallPnl = totalCurrent - totalInvested;
      const overallPnlPct = totalInvested > 0 ? (overallPnl / totalInvested) * 100 : 0;

      if (totalInvestedEl) totalInvestedEl.textContent = `${this.currencySym}${totalInvested.toFixed(2)}`;
      if (currentValueEl) currentValueEl.textContent = `${this.currencySym}${totalCurrent.toFixed(2)}`;
      if (totalPnlEl) {
        totalPnlEl.textContent = `${overallPnl >= 0 ? '+' : ''}${this.currencySym}${overallPnl.toFixed(2)} (${overallPnlPct >= 0 ? '+' : ''}${overallPnlPct.toFixed(2)}%)`;
        totalPnlEl.style.color = overallPnl >= 0 ? '#00d09c' : '#eb5b3c';
      }
    },

    updatePortfolioLivePrices(newPrice) {
      // Re-render portfolio with live tick price for matching symbol
      this.renderPortfolio();
    },

    squareOff(index) {
      const portfolio = this.getPortfolio();
      if (portfolio[index]) {
        const item = portfolio[index];
        portfolio.splice(index, 1);
        this.savePortfolio(portfolio);
        this.showToast(`Position squared off: ${item.symbol}`);
        this.renderPortfolio();
      }
    },

    showToast(msg) {
      let toast = document.getElementById('growwToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'growwToast';
        toast.className = 'groww-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3500);
    }
  };

  // Export to global window namespace
  window.GrowwAudio = GrowwAudio;
  window.GrowwFeed = GrowwFeed;
  window.GrowwChart = GrowwChart;
  window.GrowwPerformance = GrowwPerformance;
  window.GrowwMarketDepth = GrowwMarketDepth;
  window.GrowwOrderPad = GrowwOrderPad;

})(window);
