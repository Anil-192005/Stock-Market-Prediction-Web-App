/**
 * StockPulse AI - Client side interactive script
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Navigation scroll state
  const nav = document.querySelector('.site-nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 20) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    });
  }

  // 2. Ticker Search & Autocomplete
  const searchInput = document.querySelector('.stock-search-input');
  const dropdown = document.querySelector('.autocomplete-dropdown');
  const predictForm = document.querySelector('.stock-predict-form');
  const loadingModal = document.querySelector('.predict-loading-modal');

  let debounceTimer = null;

  if (searchInput && dropdown) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(debounceTimer);

      if (query.length < 1) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data && data.length > 0) {
            dropdown.innerHTML = data.map(item => `
              <div class="autocomplete-item" data-ticker="${item.Ticker}">
                <div>
                  <span class="autocomplete-ticker">${item.Ticker}</span>
                  <span class="autocomplete-name">${item.Name || ''}</span>
                </div>
                <span class="autocomplete-badge">${item.Exchange || item.Country || 'STOCK'}</span>
              </div>
            `).join('');
            dropdown.style.display = 'block';

            // Add click listeners to items
            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
              item.addEventListener('click', () => {
                const ticker = item.getAttribute('data-ticker');
                searchInput.value = ticker;
                dropdown.style.display = 'none';
                searchInput.focus();
              });
            });
          } else {
            dropdown.style.display = 'none';
          }
        } catch (err) {
          console.error('Search error:', err);
        }
      }, 150);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== searchInput) {
        dropdown.style.display = 'none';
      }
    });
  }

  // 3. Quick Chips click
  document.querySelectorAll('.ticker-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const ticker = chip.getAttribute('data-ticker');
      if (searchInput && ticker) {
        searchInput.value = ticker;
        if (dropdown) dropdown.style.display = 'none';
        searchInput.focus();
      }
    });
  });

  // 4. Form Submit & Multi-Step Progress Modal
  if (predictForm && loadingModal) {
    predictForm.addEventListener('submit', (e) => {
      const tickerVal = searchInput ? searchInput.value.trim() : '';
      if (!tickerVal) {
        e.preventDefault();
        searchInput.focus();
        return;
      }
      loadingModal.style.display = 'flex';

      const stepText = loadingModal.querySelector('.loading-step-text');
      const subText = loadingModal.querySelector('.loading-subtext');
      const tickerName = loadingModal.querySelector('.loading-ticker-target');
      if (tickerName) tickerName.textContent = tickerVal.toUpperCase();

      const steps = [
        { text: 'Fetching Historical Market Data', sub: 'Streaming daily pricing & volume bars via Yahoo Finance...' },
        { text: 'Optimizing ARIMA Time Series', sub: 'Calibrating order (6, 1, 0) parameters & stationary variance...' },
        { text: 'Training Deep LSTM Neural Network', sub: 'Processing 4-layer recurrent sequence memory with Dropout...' },
        { text: 'Running Linear Regression Forecast', sub: 'Evaluating trendline coefficient and 7-day projection...' },
        { text: 'Compiling Final Recommendation', sub: 'Generating ensemble score and visual charts...' }
      ];

      let stepIndex = 0;
      const interval = setInterval(() => {
        stepIndex++;
        if (stepIndex < steps.length) {
          if (stepText) stepText.textContent = steps[stepIndex].text;
          if (subText) subText.textContent = steps[stepIndex].sub;
        } else {
          clearInterval(interval);
        }
      }, 2500);
    });
  }
});
