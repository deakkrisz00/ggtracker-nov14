      (function() {
        const originalConsole = window.console;
        window.console = {
          log: (...args) => { originalConsole.log(...args); window.parent.postMessage({ type: 'console', message: args.join(' ') }, '*'); },
          error: (...args) => { originalConsole.error(...args); window.parent.postMessage({ type: 'console', message: 'Error: ' + args.join(' ') }, '*'); },
          warn: (...args) => { originalConsole.warn(...args); window.parent.postMessage({ type: 'console', message: 'Warning: ' + args.join(' ') }, '*'); }
        };
        let requestId = 0;
        let callbacksMap = new Map();
        let streamControllers = new Map();
        window.claude = { complete: (prompt) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'claudeComplete', id, prompt }, '*'); }) };
        window.storage = {
          get: (key, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageGet', id, key, shared }, '*'); }),
          set: (key, value, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageSet', id, key, value, shared }, '*'); }),
          delete: (key, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageDelete', id, key, shared }, '*'); }),
          list: (prefix, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageList', id, prefix, shared }, '*'); })
        };
        let pendingBlobs = new Map();
        URL.createObjectURL = (blob) => { const blobId = `blob-${Date.now()}-${Math.random()}`; pendingBlobs.set(blobId, blob); return `blob-request://${blobId}`; };
        URL.revokeObjectURL = (url) => { const blobId = url.replace("blob-request://", ""); pendingBlobs.delete(blobId); };
        const getBlobFromURL = (url) => { const blobId = url.replace("blob-request://", ""); return pendingBlobs.get(blobId); };
        window.fetch = (url, init = {}) => new Promise((resolve, reject) => {
          const id = requestId++;
          const channelId = `fetch-${id}-${Date.now()}`;
          callbacksMap.set(id, { resolve: (response) => {
            const stream = new ReadableStream({ start(controller) { streamControllers.set(channelId, controller); }, cancel() { streamControllers.delete(channelId); } });
            resolve(new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers }));
          }, reject, channelId });
          window.parent.postMessage({ type: 'proxyFetch', id, url, init, channelId }, '*');
        });
        window.addEventListener('message', async (event) => {
          if (event.data.type === 'takeScreenshot') {
            const rootElement = document.getElementById('artifacts-component-root-html');
            if (!rootElement) { window.parent.postMessage({ type: 'screenshotError', error: new Error('Root element not found') }, '*'); return; }
            try { const screenshot = await htmlToImage.toPng(rootElement, { imagePlaceholder: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjePDgwX8ACOQDoNsk0PMAAAAASUVORK5CYII=" }); window.parent.postMessage({ type: 'screenshotData', data: screenshot }, '*'); } catch (err) { window.parent.postMessage({ type: 'screenshotError', error: err instanceof Error ? err : new Error(String(err)) }, '*'); }
          } else if (event.data.type === 'claudeComplete') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.completion); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'proxyFetchResponse') { const cb = callbacksMap.get(event.data.id); if (event.data.error) { cb.reject(new Error(event.data.error)); callbacksMap.delete(event.data.id); } else { cb.resolve({ status: event.data.status, statusText: event.data.statusText, headers: event.data.headers }); if (!event.data.body) callbacksMap.delete(event.data.id); }
          } else if (event.data.type === 'proxyFetchStream') { const controller = streamControllers.get(event.data.channelId); if (controller) { if (event.data.error) { controller.error(new Error(event.data.error)); streamControllers.delete(event.data.channelId); } else if (event.data.done) { controller.close(); streamControllers.delete(event.data.channelId); const cb = Array.from(callbacksMap.entries()).find(([_, v]) => v.channelId === event.data.channelId); if (cb) callbacksMap.delete(cb[0]); } else if (event.data.chunk) controller.enqueue(new Uint8Array(event.data.chunk)); }
          } else if (event.data.type === 'storageGet') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'storageSet') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'storageDelete') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'storageList') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id); }
        });
        window.addEventListener('click', (event) => {
          const isEl = event.target instanceof HTMLElement; if (!isEl) return;
          const linkEl = event.target.closest("a"); if (!linkEl || !linkEl.href) return;
          event.preventDefault(); event.stopImmediatePropagation();
          if (linkEl.href.startsWith("blob-request:")) { const blob = getBlobFromURL(linkEl.href); if (!blob) return; void blob.arrayBuffer().then((data) => { window.parent.postMessage({ type: "downloadFile", filename: linkEl.download, data, mimeType: blob.type || "application/octet-stream" }); });
          } else if (linkEl.href.startsWith("data:")) { const [header, base64Data] = linkEl.href.split(","); const mimeMatch = header.match(/data:([^;]+)/); const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream"; const binaryString = atob(base64Data); const data = Uint8Array.from(binaryString, (c) => c.charCodeAt(0)).buffer; window.parent.postMessage({ type: "downloadFile", filename: linkEl.download, data, mimeType });
          } else { let linkUrl; try { linkUrl = new URL(linkEl.href); } catch (error) { return; } if (linkUrl.hostname === window.location.hostname) return; window.parent.postMessage({ type: 'openExternal', href: linkEl.href }, '*'); }
        });
        const originalOpen = window.open;
        window.open = function (url) { window.parent.postMessage({ type: "openExternal", href: url }, "*"); };
        window.addEventListener('error', (event) => { window.parent.postMessage({ type: 'console', message: 'Uncaught Error: ' + event.message }, '*'); });
      })();

    const PRESETS = {
      'mtt-freebuy-888':    { label:'MTT Freebuy (888) – $0',    name:'888 MTT Freebuy',   buyIn:'0',    players:'',  gameType:'MTT' },
      'freeroll-zilnic-888':{ label:'Freeroll Zilnic (888) – $0', name:'Freeroll Zilnic',   buyIn:'0',    players:'',  gameType:'MTT' },
      'sng010-3max':        { label:'SNG $0.10 – 3-max',          name:'SNG $0.10 – 3-max', buyIn:'0.10', players:'3', gameType:'SNG' },
      'sng025-3max':        { label:'SNG $0.25 – 3-max',          name:'SNG $0.25 – 3-max', buyIn:'0.25', players:'3', gameType:'SNG' },
        'sng050-3max':        { label:'SNG $0.50 – 3-max',          name:'SNG $0.50 – 3-max', buyIn:'0.50', players:'3', gameType:'SNG' },
      'sng025-6max':        { label:'SNG $0.25 – 6-max',          name:'SNG $0.25 – 6-max', buyIn:'0.25', players:'6', gameType:'SNG' },
      'sng1-3max':          { label:'SNG $1.00 – 3-max',          name:'SNG $1.00 – 3-max', buyIn:'1.00', players:'3', gameType:'SNG' },
      'sng1-6max':          { label:'SNG $1.00 – 6-max',          name:'SNG $1.00 – 6-max', buyIn:'1.00', players:'6', gameType:'SNG' },
      'mystery-freeroll-gg':{ label:'Mystery Freeroll (GG) – $0', name:'Mystery Freeroll',  buyIn:'0',    players:'18',gameType:'MTT' },
    };
    const ROOM_PRESET_KEYS = {
      '888': ['sng010-3max','sng050-3max','mtt-freebuy-888','freeroll-zilnic-888'],
      'gg':  ['sng025-3max','sng025-6max','sng1-3max','sng1-6max','mystery-freeroll-gg'],
    };
    function updateQuickPresetOptions(room) {
      const qp = document.getElementById('quick-preset');
      if (!qp) return;
      const allowed = ROOM_PRESET_KEYS[room] || [];
      Array.from(qp.options).forEach(opt => { if (opt.value !== '') opt.remove(); });
      allowed.forEach(key => {
        const p = PRESETS[key]; if (!p) return;
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = p.label; qp.appendChild(opt);
      });
      qp.value = '';
    }

    // =========================================================
    // SNG LOOKUP TABLE – Pontos kifizetési értékek
    // =========================================================
    const SNG_LOOKUP = {
      ggpoker: {
        'sng_0.25_3max': {
          name: 'SNG $0.25 – 3-max',
          buy_in: 0.25,
          players: 3,
          gameType: 'SNG',
          multipliers: {
            '2x':  { '1st': 0.50,  '2nd': 0.00, '3rd': 0.00 },
            '3x':  { '1st': 0.75,  '2nd': 0.00, '3rd': 0.00 },
            '4x':  { '1st': 1.00,  '2nd': 0.00, '3rd': 0.00 },
            '5x':  { '1st': 1.25,  '2nd': 0.00, '3rd': 0.00 },
            '10x': { '1st': 2.00,  '2nd': 0.50, '3rd': 0.00 },
            '50x': { '1st': 7.50,  '2nd': 3.75, '3rd': 1.25 },
            '100x':{ '1st': 15.00, '2nd': 7.50, '3rd': 2.50 },
          }
        },
        'sng_1.00_3max': {
          name: 'SNG $1.00 – 3-max',
          buy_in: 1.00,
          players: 3,
          gameType: 'SNG',
          multipliers: {
            '2x':  { '1st': 2.00,  '2nd': 0.00, '3rd': 0.00 },
            '3x':  { '1st': 3.00,  '2nd': 0.00, '3rd': 0.00 },
            '4x':  { '1st': 4.00,  '2nd': 0.00, '3rd': 0.00 },
            '5x':  { '1st': 5.00,  '2nd': 0.00, '3rd': 0.00 },
            '10x': { '1st': 8.00,  '2nd': 2.00, '3rd': 0.00 },
            '50x': { '1st': 30.00, '2nd': 15.00,'3rd': 5.00 },
            '100x':{ '1st': 60.00, '2nd': 30.00,'3rd': 10.00 },
          }
        },
        'sng_0.25_6max': {
          name: 'SNG $0.25 – 6-max',
          buy_in: 0.25,
          players: 6,
          gameType: 'SNG',
          multipliers: {
            '4x':  { '1st': 0.625, '2nd': 0.375,'3rd': 0.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '6x':  { '1st': 1.00,  '2nd': 0.50, '3rd': 0.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '8x':  { '1st': 1.25,  '2nd': 0.75, '3rd': 0.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '10x': { '1st': 1.25,  '2nd': 0.75, '3rd': 0.50, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '20x': { '1st': 2.50,  '2nd': 1.50, '3rd': 1.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '100x':{ '1st': 10.00, '2nd': 7.50, '3rd': 5.00, '4th': 2.50, '5th': 0.00, '6th': 0.00 },
            '200x':{ '1st': 20.00, '2nd': 15.00,'3rd': 10.00,'4th': 5.00, '5th': 0.00, '6th': 0.00 },
          }
        },
        'sng_1.00_6max': {
          name: 'SNG $1.00 – 6-max',
          buy_in: 1.00,
          players: 6,
          gameType: 'SNG',
          multipliers: {
            '4x':  { '1st': 2.50,  '2nd': 1.50, '3rd': 0.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '6x':  { '1st': 4.00,  '2nd': 2.00, '3rd': 0.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '8x':  { '1st': 5.00,  '2nd': 3.00, '3rd': 0.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '10x': { '1st': 5.00,  '2nd': 3.00, '3rd': 2.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '20x': { '1st': 10.00, '2nd': 6.00, '3rd': 4.00, '4th': 0.00, '5th': 0.00, '6th': 0.00 },
            '100x':{ '1st': 40.00, '2nd': 30.00,'3rd': 20.00,'4th': 10.00,'5th': 0.00, '6th': 0.00 },
            '200x':{ '1st': 80.00, '2nd': 60.00,'3rd': 40.00,'4th': 20.00,'5th': 0.00, '6th': 0.00 },
          }
        },
      },
      '888poker': {
        'sng_0.10_3max': {
          name: 'SNG $0.10 – 3-max',
          buy_in: 0.10,
          players: 3,
          gameType: 'SNG',
          multipliers: {
            '2x':  { '1st': 0.20, '2nd': 0.00, '3rd': 0.00 },
            '3x':  { '1st': 0.30, '2nd': 0.00, '3rd': 0.00 },
            '5x':  { '1st': 0.50, '2nd': 0.00, '3rd': 0.00 },
            '10x': { '1st': 0.80, '2nd': 0.20, '3rd': 0.00 },
            '25x': { '1st': 2.00, '2nd': 0.50, '3rd': 0.00 },
            '100x':{ '1st': 7.00, '2nd': 2.00, '3rd': 1.00 },
          }
        },
        'sng_0.50_3max': {
          name: 'SNG $0.50 – 3-max',
          buy_in: 0.50,
          players: 3,
          gameType: 'SNG',
          multipliers: {
            '2x':  { '1st': 1.00,  '2nd': 0.00, '3rd': 0.00 },
            '3x':  { '1st': 1.50,  '2nd': 0.00, '3rd': 0.00 },
            '5x':  { '1st': 2.50,  '2nd': 0.00, '3rd': 0.00 },
            '10x': { '1st': 4.00,  '2nd': 1.00, '3rd': 0.00 },
            '25x': { '1st': 10.00, '2nd': 2.50, '3rd': 0.00 },
            '100x':{ '1st': 35.00, '2nd': 10.00,'3rd': 5.00 },
          }
        },
      }
    };
    SNG_LOOKUP.gg = SNG_LOOKUP.ggpoker;
    SNG_LOOKUP['888'] = SNG_LOOKUP['888poker'];

    // =========================================================
    // SNG GYORS BEVITEL – Dropdown logika
    // =========================================================
    const POSITION_LABELS = { '1st':'🥇 1. hely','2nd':'🥈 2. hely','3rd':'🥉 3. hely','4th':'4. hely','5th':'5. hely','6th':'6. hely' };

    function sngGetPlatformKey() {
      const sel = document.getElementById('sng-platform');
      const val = sel ? sel.value : '';
      if (val === 'gg' || val === 'ggpoker') return 'ggpoker';
      if (val === '888' || val === '888poker') return '888poker';
      return state.room === 'gg' ? 'ggpoker' : '888poker';
    }
    function sngGetTournamentKey() {
      const sel = document.getElementById('sng-tournament');
      return sel ? sel.value : '';
    }
    function sngGetMultiplierKey() {
      const sel = document.getElementById('sng-multiplier');
      return sel ? sel.value : '';
    }

    // ---- Saját gyorsválasztó panel (iOS-en a natív select programból nem nyitható érintés nélkül) ----
    let quickSheetEl = null;
    let quickSheetOpenedAt = 0;

    function closeQuickSheet() {
      if (quickSheetEl) { quickSheetEl.remove(); quickSheetEl = null; }
    }

    function openPickerForSelect(sel) {
      if (!sel || sel.disabled) return;
      if (state.view !== '888' && state.view !== 'gg') return;
      const items = Array.from(sel.options).filter(o => o.value !== '');
      if (!items.length) return;
      closeQuickSheet();

      const isPosition = sel.id === 'sng-position';
      const selText = (id) => {
        const el = document.getElementById(id);
        return el && el.selectedIndex >= 0 && el.value ? el.options[el.selectedIndex].textContent : '';
      };
      const subtitle = [selText('sng-platform'), selText('sng-tournament'), isPosition ? selText('sng-multiplier') : '']
        .filter(Boolean).join(' · ');

      const backdrop = document.createElement('div');
      backdrop.className = 'qs-backdrop';
      const sheet = document.createElement('div');
      sheet.className = 'qs-sheet';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');

      const head = document.createElement('div');
      head.className = 'qs-head';
      const titleWrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'qs-title';
      title.textContent = isPosition ? '🏁 Helyezés' : '✖️ Szorzó';
      const sub = document.createElement('div');
      sub.className = 'qs-sub';
      sub.textContent = subtitle;
      titleWrap.appendChild(title); titleWrap.appendChild(sub);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'qs-close';
      closeBtn.textContent = 'Bezárás';
      closeBtn.addEventListener('click', closeQuickSheet);
      head.appendChild(titleWrap); head.appendChild(closeBtn);

      const grid = document.createElement('div');
      grid.className = isPosition ? 'qs-list' : 'qs-grid';
      items.forEach(o => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qs-item' + (o.value === sel.value ? ' qs-selected' : '');
        if (isPosition) {
          const parts = o.textContent.split(' → ');
          const l = document.createElement('span'); l.className = 'qs-item-main'; l.textContent = parts[0];
          const r = document.createElement('span');
          r.className = 'qs-item-extra' + (/\(\+/.test(parts[1] || '') ? ' qs-pos' : /\(-/.test(parts[1] || '') ? ' qs-neg' : '');
          r.textContent = parts[1] || '';
          btn.appendChild(l); btn.appendChild(r);
        } else {
          btn.textContent = o.textContent;
        }
        btn.addEventListener('click', () => {
          if (Date.now() - quickSheetOpenedAt < 250) return; // véletlen dupla érintés ellen
          const val = o.value;
          closeQuickSheet();
          sel.value = val;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        grid.appendChild(btn);
      });

      sheet.appendChild(head); sheet.appendChild(grid);
      backdrop.appendChild(sheet);
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeQuickSheet(); });
      document.body.appendChild(backdrop);
      quickSheetEl = backdrop;
      quickSheetOpenedAt = Date.now();
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeQuickSheet(); });

    function sngPopulateTournaments(autoOpen = true) {
      const platformKey = sngGetPlatformKey();
      const sel = document.getElementById('sng-tournament');
      if (!sel) return;
      sel.innerHTML = '<option value="">– Válassz versenyt –</option>';
      const tournaments = SNG_LOOKUP[platformKey] || {};
      // Sort by buy_in ascending (kis tét előbb), then by players ascending
      const sorted = Object.entries(tournaments).sort(([,a],[,b]) => a.buy_in - b.buy_in || a.players - b.players);
      sorted.forEach(([key, t]) => {
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = t.name; sel.appendChild(opt);
      });
      sel.disabled = false;
      // Auto-select platform default
      const defaults = {
        'ggpoker': 'sng_0.25_3max',
        'gg': 'sng_0.25_3max',
        '888poker': 'sng_0.50_3max',
        '888': 'sng_0.50_3max'
      };
      const defaultKey = defaults[platformKey];
      if (defaultKey && sel.querySelector(`option[value="${defaultKey}"]`)) {
        sel.value = defaultKey;
      }
      // reset downstream
      const mSel = document.getElementById('sng-multiplier');
      const pSel = document.getElementById('sng-position');
      if (mSel) { mSel.innerHTML = '<option value="">– Válassz szorzót –</option>'; mSel.disabled = true; }
      if (pSel) { pSel.innerHTML = '<option value="">– Válassz helyezést –</option>'; pSel.disabled = true; }
      sngUpdatePreview(null, null, null);
      // Auto-populate multipliers for the default selection
      if (sel.value) sngPopulateMultipliers(autoOpen);
    }

    function sngPopulateMultipliers(autoOpen = true) {
      const platformKey = sngGetPlatformKey();
      const tournamentKey = sngGetTournamentKey();
      if (!tournamentKey) return;
      const tournament = SNG_LOOKUP[platformKey]?.[tournamentKey];
      if (!tournament) return;
      const sel = document.getElementById('sng-multiplier');
      if (!sel) return;
      sel.innerHTML = '<option value="">– Válassz szorzót –</option>';
      Object.keys(tournament.multipliers).forEach(mult => {
        const opt = document.createElement('option');
        opt.value = mult; opt.textContent = mult; sel.appendChild(opt);
      });
      sel.disabled = false;
      // reset downstream
      const pSel = document.getElementById('sng-position');
      if (pSel) { pSel.innerHTML = '<option value="">– Válassz helyezést –</option>'; pSel.disabled = true; }
      sngUpdatePreview(null, null, null);
      if (autoOpen) {
        openPickerForSelect(sel);
      }
    }

    function sngPopulatePositions(autoOpen = true) {
      const platformKey = sngGetPlatformKey();
      const tournamentKey = sngGetTournamentKey();
      const multiplierKey = sngGetMultiplierKey();
      if (!tournamentKey || !multiplierKey) return;
      const payouts = SNG_LOOKUP[platformKey]?.[tournamentKey]?.multipliers?.[multiplierKey];
      if (!payouts) return;
      const sel = document.getElementById('sng-position');
      if (!sel) return;
      sel.innerHTML = '<option value="">– Válassz helyezést –</option>';
      Object.entries(payouts).forEach(([pos, payout]) => {
        const opt = document.createElement('option');
        opt.value = pos;
        // Only show medal emoji when position actually pays out
        const baseLabel = pos === '1st' ? '1. hely' : pos === '2nd' ? '2. hely' : pos === '3rd' ? '3. hely' : pos.replace('th',' hely');
        const medal = payout > 0 ? (pos === '1st' ? '🥇 ' : pos === '2nd' ? '🥈 ' : pos === '3rd' ? '🥉 ' : '') : '';
        const label = medal + baseLabel;
        const tournament = SNG_LOOKUP[platformKey][tournamentKey];
        const profitVal = payout - tournament.buy_in;
        const profitStr = profitVal > 0
          ? ` → $${payout.toFixed(2)} (+${profitVal.toFixed(2)}$)`
          : profitVal === 0
          ? ` → $${payout.toFixed(2)} (±0.00$)`
          : ` → $${payout.toFixed(2)} (${profitVal.toFixed(2)}$)`;
        opt.textContent = label + profitStr;
        sel.appendChild(opt);
      });
      sel.disabled = false;
      if (autoOpen) {
        openPickerForSelect(sel);
      }
    }

    function sngUpdatePreview(platformKey, tournamentKey, multiplierKey, positionKey) {
      const previewEl = document.getElementById('sng-preview');
      if (!previewEl) return;
      if (!platformKey || !tournamentKey || !multiplierKey || !positionKey) {
        previewEl.classList.add('hidden'); return;
      }
      const tournament = SNG_LOOKUP[platformKey]?.[tournamentKey];
      const payout = tournament?.multipliers?.[multiplierKey]?.[positionKey];
      if (payout === undefined || !tournament) { previewEl.classList.add('hidden'); return; }
      const profit = payout - tournament.buy_in;
      const posLabel = POSITION_LABELS[positionKey] || positionKey;
      document.getElementById('sng-preview-payout').innerHTML =
        `<span style="color:var(--muted);font-weight:400;">${tournament.name} · ${multiplierKey} · ${posLabel}</span> &nbsp;→&nbsp; Kifizetés: <strong>$${payout.toFixed(2)}</strong>`;
      const profitEl = document.getElementById('sng-preview-profit');
      profitEl.textContent = 'Profit: ' + (profit >= 0 ? '+' : '') + profit.toFixed(2) + '$';
      profitEl.className = profit > 0 ? 'sng-profit-pos' : profit < 0 ? 'sng-profit-neg' : 'sng-profit-even';
      previewEl.classList.remove('hidden');
    }

    let undoableQuickEntry = null;
    let undoQuickEntryTimer = null;

    function hideQuickUndo() {
      const undoBtn = document.getElementById('sng-undo-btn');
      if (undoBtn) undoBtn.classList.add('hidden');
      undoableQuickEntry = null;
      clearTimeout(undoQuickEntryTimer);
    }

    function showQuickSaveToast(entry, tournament, multiplierKey, payout, profit) {
      const toast = document.getElementById('sng-toast');
      const toastText = document.getElementById('sng-toast-text');
      const undoBtn = document.getElementById('sng-undo-btn');
      if (!toast || !toastText || !undoBtn) return;
      const profitStr = profit >= 0 ? '+' + profit.toFixed(2) : profit.toFixed(2);
      toastText.textContent = `✅ ${tournament.name} · ${multiplierKey} → $${payout.toFixed(2)} (${profitStr}$)`;
      undoableQuickEntry = { id:entry.id, room:entry.room, name:tournament.name };
      undoBtn.classList.remove('hidden');
      toast.classList.remove('hidden', 'sng-toast-out');
      toast.classList.add('sng-toast-in');
      clearTimeout(undoQuickEntryTimer);
      undoQuickEntryTimer = setTimeout(() => {
        hideQuickUndo();
        toast.classList.remove('sng-toast-in');
        toast.classList.add('sng-toast-out');
        setTimeout(() => { toast.classList.add('hidden'); toast.classList.remove('sng-toast-out'); }, 350);
      }, 10000);
    }

    function undoLastQuickEntry() {
      if (!undoableQuickEntry) return;
      const { id, room, name } = undoableQuickEntry;
      const games = state.games[room] || [];
      const index = games.findIndex(game => game.id === id);
      if (index === -1) { hideQuickUndo(); return; }
      games.splice(index, 1);
      saveState(state);
      hideQuickUndo();
      const toast = document.getElementById('sng-toast');
      const toastText = document.getElementById('sng-toast-text');
      if (toast && toastText) {
        toastText.textContent = `↩️ Visszavonva: ${name}`;
        toast.classList.remove('hidden', 'sng-toast-out');
        toast.classList.add('sng-toast-in');
        setTimeout(() => { toast.classList.remove('sng-toast-in'); toast.classList.add('sng-toast-out'); }, 1800);
        setTimeout(() => { toast.classList.add('hidden'); toast.classList.remove('sng-toast-out'); }, 2150);
      }
      render();
    }

    function sngAutoSave() {
      const platformKey = sngGetPlatformKey();
      const tournamentKey = sngGetTournamentKey();
      const multiplierKey = sngGetMultiplierKey();
      const pSel = document.getElementById('sng-position');
      const positionKey = pSel ? pSel.value : '';
      if (!tournamentKey || !multiplierKey || !positionKey) return;

      const tournament = SNG_LOOKUP[platformKey]?.[tournamentKey];
      if (!tournament) return;
      const payout = tournament.multipliers?.[multiplierKey]?.[positionKey];
      if (payout === undefined) return;

      const buyIn = tournament.buy_in;
      const profit = payout - buyIn;
      const posNum = { '1st':1,'2nd':2,'3rd':3,'4th':4,'5th':5,'6th':6 }[positionKey] || 1;
      const totalCost = buyIn;
      const itm = payout > 0;

      // Determine target room from platform
      const targetRoom = platformKey === 'ggpoker' ? 'gg' : '888';

      const entry = {
        id: Date.now()+'_'+Math.random().toString(36).slice(2),
        room: targetRoom,
        name: tournament.name,
        multiplier: multiplierKey,
        gameType: tournament.gameType || 'SNG',
        date: getLocalDateString(),
        buyIn,
        rebuys: 0,
        addon: 0,
        players: tournament.players,
        position: posNum,
        prize: payout,
        totalCost,
        profit: parseFloat(profit.toFixed(2)),
        itm,
        percentile: tournament.players > 1 ? ((posNum - 1) / (tournament.players - 1)) * 100 : 0,
        notes: '',
        createdAt: new Date().toISOString()
      };

      state.games[targetRoom].push(entry);
      saveState(state);

      // Flash success feedback on panel
      const panel = document.getElementById('sng-quick-panel');
      if (panel) {
        panel.classList.add('sng-flash');
        setTimeout(() => panel.classList.remove('sng-flash'), 600);
      }

      showQuickSaveToast(entry, tournament, multiplierKey, payout, profit);

      // Reset position and multiplier dropdowns, keep platform+tournament
      if (pSel) { pSel.innerHTML = '<option value="">– Válassz helyezést –</option>'; pSel.disabled = true; }
      const mSel = document.getElementById('sng-multiplier');
      if (mSel) { mSel.value = ''; }
      sngUpdatePreview(null, null, null);

      // Sync active room to the saved entry's room
      if (state.room !== targetRoom) { state.room = targetRoom; state.view = targetRoom; }
      render();

      // Következő bevitelhez azonnal újra a szorzó-választó
      setTimeout(() => { if (mSel) openPickerForSelect(mSel); }, 120);
    }

    function tryInitialPickerOpen() {
      if (state.view !== '888' && state.view !== 'gg') return;
      if (quickSheetEl) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      const sm = document.getElementById('session-modal-backdrop');
      if (sm && sm.classList.contains('open')) return;
      const mSel = document.getElementById('sng-multiplier');
      const pSel = document.getElementById('sng-position');
      if (mSel && !mSel.disabled && !mSel.value) openPickerForSelect(mSel);
      else if (pSel && !pSel.disabled && !pSel.value) openPickerForSelect(pSel);
    }

    // Az appba való (újra)belépéskor is jelenjen meg
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') setTimeout(tryInitialPickerOpen, 150);
    });
    window.addEventListener('pageshow', () => setTimeout(tryInitialPickerOpen, 150));

    let sngPanelInitialized = false;
    function initSngPanel() {
      if (sngPanelInitialized) return;
      const platformSel = document.getElementById('sng-platform');
      if (!platformSel) return;
      sngPanelInitialized = true;
      const tournamentSel = document.getElementById('sng-tournament');
      const multiplierSel = document.getElementById('sng-multiplier');
      const positionSel = document.getElementById('sng-position');

      const undoBtn = document.getElementById('sng-undo-btn');
      if (undoBtn) undoBtn.addEventListener('click', undoLastQuickEntry);

      // Sync platform dropdown with active room on init
      const roomToPlat = { 'gg': 'ggpoker', '888': '888poker' };
      platformSel.value = roomToPlat[state.room] || '888poker';
      sngPopulateTournaments(false);

      platformSel.addEventListener('change', () => {
        sngPopulateTournaments(true);
      });
      if (tournamentSel) {
        tournamentSel.addEventListener('change', () => {
          sngPopulateMultipliers(true);
        });
      }
      if (multiplierSel) {
        multiplierSel.addEventListener('change', () => {
          sngPopulatePositions(true);
          sngUpdatePreview(sngGetPlatformKey(), sngGetTournamentKey(), sngGetMultiplierKey(), null);
        });
      }
      if (positionSel) {
        positionSel.addEventListener('change', () => {
          const pos = positionSel.value;
          if (!pos) return;
          sngUpdatePreview(sngGetPlatformKey(), sngGetTournamentKey(), sngGetMultiplierKey(), pos);
          // Small delay so user sees the selection, then auto-save
          setTimeout(() => sngAutoSave(), 180);
        });
      }

      // A szorzó/helyezés mezőre érintve a saját panel nyílik (a natív select nem reagál)
      [multiplierSel, positionSel].forEach(el => {
        if (!el) return;
        const wrap = el.closest('.sng-field');
        if (wrap) wrap.addEventListener('click', () => openPickerForSelect(el));
      });

      // Quick panel click opens multiplier picker if idle
      const quickPanel = document.getElementById('sng-quick-panel');
      if (quickPanel) {
        quickPanel.addEventListener('click', (e) => {
          if (e.target === quickPanel || e.target.closest('.sng-panel-header') || e.target.classList.contains('sng-dropdown-row')) {
            const mSel = document.getElementById('sng-multiplier');
            if (mSel && !mSel.disabled) openPickerForSelect(mSel);
          }
        });
      }

      // Initial auto-open attempt
      setTimeout(tryInitialPickerOpen, 120);
    }
    document.addEventListener('DOMContentLoaded', () => {
      const qp = document.getElementById('quick-preset');
      if (qp) {
        qp.addEventListener('change', () => {
          const val = qp.value; if (!val) return;
          const p = PRESETS[val]; if (!p) return;
          document.getElementById('name').value = p.name;
          document.getElementById('buyIn').value = p.buyIn;
          document.getElementById('players').value = p.players;
          document.getElementById('gameType').value = p.gameType;
          document.getElementById('rebuys').value = '0';
          document.getElementById('addon').value = '0';
          qp.value = '';
          const pos = document.getElementById('position'); if (pos) pos.focus();
        });
      }
    });

    const STORAGE_KEY = 'poker-tracker-v1';
    const DEFAULT_BALANCE = { '888': 58.99, 'gg': 49.92 };

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { room:'888', view:'888', games:{'888':[],'gg':[]}, baseBalances:{'888':DEFAULT_BALANCE['888'],'gg':DEFAULT_BALANCE['gg']}, archive:[], sessionStartedAt:new Date().toISOString(), lastBackupAt:null };
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.archive)) parsed.archive = [];
        if (!parsed.games) parsed.games = {'888':[],'gg':[]};
        if (!parsed.games['888']) parsed.games['888'] = [];
        if (!parsed.games['gg']) parsed.games['gg'] = [];
        if (!parsed.room) parsed.room = '888';
        if (!parsed.view) parsed.view = parsed.room;
        if (!parsed.sessionStartedAt || isNaN(new Date(parsed.sessionStartedAt).getTime())) parsed.sessionStartedAt = new Date().toISOString();
        if (!parsed.baseBalances) {
          const p888 = parsed.games['888'].reduce((s,g)=>s+(Number(g.profit)||0),0);
          const pgg  = parsed.games['gg'].reduce((s,g)=>s+(Number(g.profit)||0),0);
          parsed.baseBalances = { '888':+(DEFAULT_BALANCE['888']-p888).toFixed(2), 'gg':+(DEFAULT_BALANCE['gg']-pgg).toFixed(2) };
        }
        return parsed;
      } catch(e) { return { room:'888', view:'888', games:{'888':[],'gg':[]}, baseBalances:{'888':DEFAULT_BALANCE['888'],'gg':DEFAULT_BALANCE['gg']}, archive:[], sessionStartedAt:new Date().toISOString(), lastBackupAt:null }; }
    }
    function saveState(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

    function validImportDate(value) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(value+'T00:00:00');
      return !isNaN(date.getTime()) && getLocalDateString(date) === value;
    }

    function importNumber(value, field, room, index, options) {
      const n = Number(value ?? 0);
      if (!Number.isFinite(n) || (options?.min !== undefined && n < options.min) || (options?.integer && !Number.isInteger(n))) {
        throw new Error(`${room} / ${index + 1}. rekord: hibás ${field}.`);
      }
      return n;
    }

    function normalizeImportedGame(raw, room, index) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${room} / ${index + 1}. rekord: nem érvényes objektum.`);
      if (!validImportDate(raw.date)) throw new Error(`${room} / ${index + 1}. rekord: hibás dátum.`);
      let players = importNumber(raw.players, 'résztvevőszám', room, index, { min:1, integer:true });
      let position = importNumber(raw.position, 'helyezés', room, index, { min:1, integer:true });
      if (position > players) {
        const tmp = players;
        players = position;
        position = tmp;
      }
      const buyIn = importNumber(raw.buyIn, 'buy-in', room, index, { min:0 });
      const rebuys = importNumber(raw.rebuys, 'rebuy', room, index, { min:0, integer:true });
      const addon = importNumber(raw.addon, 'add-on', room, index, { min:0 });
      const prize = importNumber(raw.prize, 'nyeremény', room, index, { min:0 });
      const totalCost = buyIn + rebuys * buyIn + addon;
      const safeName = String(raw.name ?? '').trim().slice(0, 160);
      const safeNotes = String(raw.notes ?? '').slice(0, 2000);
      const gameType = raw.gameType === 'SNG' ? 'SNG' : 'MTT';
      const percentile = players === 1 ? 0 : ((position - 1) / (players - 1)) * 100;
      return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 120) : `import_${Date.now()}_${room}_${index}_${Math.random().toString(36).slice(2)}`,
        room,
        name:safeName,
        multiplier:raw.multiplier ? String(raw.multiplier).slice(0, 20) : undefined,
        gameType,
        date:raw.date,
        buyIn,
        rebuys,
        addon,
        players,
        position,
        prize,
        totalCost,
        profit:prize - totalCost,
        itm:prize > 0,
        percentile,
        notes:safeNotes,
        createdAt:typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 80) : new Date().toISOString()
      };
    }

    function validateImportedState(parsed) {
      if (!parsed || typeof parsed !== 'object' || !parsed.games || typeof parsed.games !== 'object') throw new Error('Hibás JSON szerkezet: hiányzik a games rész.');
      const games = { '888':[], gg:[] };
      ['888','gg'].forEach(room => {
        const source = parsed.games[room] ?? [];
        if (!Array.isArray(source)) throw new Error(`Hibás JSON szerkezet: ${room} játéklista nem tömb.`);
        games[room] = source.map((game, index) => normalizeImportedGame(game, room, index));
      });
      const balances = parsed.baseBalances;
      let importedBalances = null;
      if (balances && typeof balances === 'object') {
        ['888','gg'].forEach(room => {
          if (balances[room] !== undefined && !Number.isFinite(Number(balances[room]))) throw new Error(`Hibás kezdő egyenleg: ${room}.`);
        });
        if (balances['888'] !== undefined || balances.gg !== undefined) {
          if (balances['888'] === undefined || balances.gg === undefined) throw new Error('Mindkét terem kezdő egyenlege szükséges.');
          importedBalances = { '888':Number(balances['888']), gg:Number(balances.gg) };
        }
      }
      const validViews = new Set(['888','gg','summary','charts','new-charts','analysis','archive']);
      const sessionStartedAt = typeof parsed.sessionStartedAt === 'string' && !isNaN(new Date(parsed.sessionStartedAt).getTime()) ? parsed.sessionStartedAt : new Date().toISOString();
      const lastBackupAt = typeof parsed.lastBackupAt === 'string' && !isNaN(new Date(parsed.lastBackupAt).getTime()) ? parsed.lastBackupAt : null;
      return {
        room:parsed.room === 'gg' ? 'gg' : '888',
        view:validViews.has(parsed.view) ? parsed.view : (parsed.room === 'gg' ? 'gg' : '888'),
        games,
        baseBalances:importedBalances,
        archive:Array.isArray(parsed.archive) ? parsed.archive : [],
        sessionStartedAt,
        lastBackupAt
      };
    }

    function createGameEntry(room, data) {
      const buyIn = Number(data.buyIn)||0, rebuys = Number(data.rebuys)||0, addon = Number(data.addon)||0;
      let players = Number(data.players)||0, position = Number(data.position)||0, prize = Number(data.prize)||0;
      if (players > 0 && position > 0 && position > players) {
        const tmp = players;
        players = position;
        position = tmp;
      }
      const totalCost = buyIn + rebuys*buyIn + addon, profit = prize - totalCost, itm = prize > 0;
      let percentile = null;
      if (players > 0 && position > 0 && position <= players)
        percentile = players === 1 ? 0 : ((position-1)/(players-1))*100;
      return { id: Date.now()+'_'+Math.random().toString(36).slice(2), room, name:data.name||'', gameType:data.gameType||'MTT', date:data.date||getLocalDateString(), buyIn, rebuys, addon, players, position, prize, totalCost, profit, itm, percentile, notes:data.notes||'', createdAt:new Date().toISOString() };
    }
    function formatMoney(val) { return (Number(val)||0).toFixed(2); }
    function formatPercent(val) { return (val===null||val===undefined||isNaN(val)) ? '-' : val.toFixed(1)+'%'; }

    function buildCumulativeData(games) {
      if (!games || games.length === 0) return [];
      const sorted = games.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      const firstDate = sorted[0].date||'';
      let startLabel = '';
      if (firstDate) { const d = new Date(firstDate+'T00:00:00'); if (!isNaN(d)) { d.setDate(d.getDate()-1); startLabel = getLocalDateString(d); } }
      const result = [{ date:startLabel, cum:0, name:'Start', profit:0, isStart:true }];
      let cum = 0;
      sorted.forEach(g => { cum += g.profit; result.push({ date:g.date||'?', cum:parseFloat(cum.toFixed(2)), name:g.name||'-', profit:g.profit }); });
      return result;
    }

    // FIX 2+4: drawChart – no dots, opts param, fixed tooltip formatting
    function drawChart(containerId, data, color, opts) {
      opts = opts || {};
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!data || data.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:12px;">Még nincs adat</div>';
        return;
      }
      const rect = el.getBoundingClientRect();
      const width = (rect.width && rect.width > 0 ? rect.width : (el.clientWidth || window.innerWidth-40 || 320));
      const height = el.clientHeight || 190;
      const pad = { top:14, right:12, bottom:26, left:46 };
      const W = width - pad.left - pad.right, H = height - pad.top - pad.bottom;
      const vals = data.map(d => d.cum);
      const minV = Math.min(0,...vals), maxV = Math.max(0,...vals), range = maxV-minV || 1;
      function xPos(i) { return data.length === 1 ? W/2 : (i/(data.length-1))*W; }
      function yPos(v) { return H - ((v-minV)/range)*H; }

      // FIX 4: format value with correct unit based on opts
      function fmtCumVal(v) {
        if (opts.percent) return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
        if (opts.intOnly) return v.toFixed(0) + ' db';
        return (v >= 0 ? '+' : '') + v.toFixed(2) + '$';
      }

      const pts = data.map((d,i) => xPos(i)+','+yPos(d.cum)).join(' ');
      const zeroY = yPos(0);
      const ticks = [{v:minV,y:yPos(minV)},{v:0,y:zeroY},{v:maxV,y:yPos(maxV)}];
      const xLabels = [];
      const step = Math.max(1, Math.floor(data.length/5));
      for (let i=1; i<data.length; i+=step) xLabels.push({i, date:data[i].date});
      if (xLabels.length === 0 || xLabels[xLabels.length-1].i !== data.length-1)
        xLabels.push({i:data.length-1, date:data[data.length-1].date});

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="overflow:visible;display:block;">
        <g transform="translate(${pad.left},${pad.top})">
          ${ticks.map(t => `<text x="-6" y="${t.y+3}" text-anchor="end" fill="#6b7280" font-size="10">${fmtCumVal(t.v)}</text>`).join('')}
          <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="4,3"/>
          <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          ${xLabels.map(l => `<text x="${xPos(l.i)}" y="${H+18}" text-anchor="middle" fill="#6b7280" font-size="10">${/^\d{4}-\d{2}-\d{2}/.test(l.date||'') ? (l.date||'').slice(5) : (l.date||'')}</text>`).join('')}
          <line x1="0" y1="0" x2="0" y2="${H}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
          <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
          <line class="hover-guide" x1="0" y1="0" x2="0" y2="${H}" stroke="${color}" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>
          <circle class="hover-dot" cx="0" cy="0" r="4" fill="${color}" stroke="#020617" stroke-width="1.5" opacity="0"/>
          <rect class="hover-area" x="0" y="0" width="${W}" height="${H}" fill="transparent" style="cursor:crosshair"/>
        </g>
      </svg>
      <div class="chart-tooltip"></div>`;
      el.innerHTML = svg;

      const svgEl = el.querySelector('svg');
      const tip = el.querySelector('.chart-tooltip');
      const guide = el.querySelector('.hover-guide');
      const dot = el.querySelector('.hover-dot');
      const area = el.querySelector('.hover-area');

      function showAt(clientX) {
        const r = svgEl.getBoundingClientRect();
        const localX = clientX - r.left - pad.left;
        let idx = 0;
        if (data.length > 1) idx = Math.round((localX/W)*(data.length-1));
        idx = Math.max(0, Math.min(data.length-1, idx));
        const d = data[idx];
        const cx = xPos(idx), cy = yPos(d.cum);
        guide.setAttribute('x1',cx); guide.setAttribute('x2',cx); guide.setAttribute('opacity','0.6');
        dot.setAttribute('cx',cx); dot.setAttribute('cy',cy); dot.setAttribute('opacity','1');
        const profitStr = d.isStart ? 'Kezdés' : `${d.profit>=0?'+':''}${d.profit.toFixed(2)}$`;
        const cumLabel = d.cumLabel || 'Kum';
        const valueStr = fmtCumVal(d.cum);
        const cumulativeValue = typeof d.cumulativeProfit === 'number' ? d.cumulativeProfit : d.cum;
        const cumulativeStr = `${cumulativeValue>=0?'+':''}${cumulativeValue.toFixed(2)}$`;
        if (d.isStart) {
          tip.innerHTML = `<strong>${d.date||'-'}</strong><div>Kezdés: +0.00$</div>`;
        } else if (d.showPeriodAndCumulative) {
          tip.innerHTML = `<strong>${escHtml(d.date||'-')}</strong>${d.name?`<div>${escHtml(d.name)}</div>`:''}<div>Időszaki profit: ${profitStr}</div><div>Kumulált profit: ${cumulativeStr}</div>`;
        } else {
          // FIX 4: metric first, no dollar on non-money, no duplicate count for 'games' metric
          const showCount = !opts.intOnly && d.name;
          tip.innerHTML = `<strong>${escHtml(d.date||'-')}</strong><div>${escHtml(cumLabel)}: ${valueStr}</div>${showCount?`<div>${escHtml(d.name)}</div>`:''}`;
        }
        tip.style.display = 'block';
        let left = pad.left + cx;
        const tipW = tip.offsetWidth;
        if (left - tipW/2 < 4) left = tipW/2 + 4;
        if (left + tipW/2 > width-4) left = width - tipW/2 - 4;
        tip.style.left = left + 'px';
        tip.style.top = (pad.top + cy - 8) + 'px';
      }
      function hide() { tip.style.display='none'; guide.setAttribute('opacity','0'); dot.setAttribute('opacity','0'); }
      area.addEventListener('mousemove', e => showAt(e.clientX));
      area.addEventListener('mouseleave', hide);
      area.addEventListener('touchstart', e => { if (e.touches[0]) showAt(e.touches[0].clientX); }, { passive:true });
      area.addEventListener('touchmove',  e => { if (e.touches[0]) showAt(e.touches[0].clientX); }, { passive:true });
      area.addEventListener('click', e => showAt(e.clientX));
    }

    let activePeriod = 'all';
    function filterByPeriod(games, period) {
      if (period === 'all') return games;
      const now = new Date(); let cutoff;
      if (period === 'day') cutoff = getLocalDateString(now);
      else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate()-7); cutoff = getLocalDateString(d); }
      else if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth()-1); cutoff = getLocalDateString(d); }
      return games.filter(g => (g.date||'') >= cutoff);
    }
    let activeChartMode = 'cumulative';
    let activeMAPeriod = 10;

    function buildMAData(games, period) {
      if (!games || games.length === 0) return [];
      const sorted = games.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      // Build cumulative profit series first
      const cumProfits = [];
      let cumProfit = 0;
      for (let i = 0; i < sorted.length; i++) {
        cumProfit += (sorted[i].profit || 0);
        cumProfits.push(cumProfit);
      }
      // Now compute moving average of cumulative profit
      const result = [];
      for (let i = 0; i < sorted.length; i++) {
        if (i < period - 1) continue;
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += cumProfits[j];
        const avg = sum / period;
        result.push({
          date: sorted[i].date || '?',
          cum: parseFloat(avg.toFixed(2)),
          name: sorted[i].name || '-',
          profit: sorted[i].profit || 0,
          isStart: false
        });
      }
      return result;
    }

    function renderCharts() {
      const f888 = filterByPeriod(state.games['888'], activePeriod);
      const fgg  = filterByPeriod(state.games['gg'],  activePeriod);
      const fall = filterByPeriod([...state.games['888'],...state.games['gg']], activePeriod);
      if (activeChartMode === 'ma') {
        const p = activeMAPeriod;
        drawChart('chart-888', buildMAData(f888, p), '#22c55e', { maLabel: p+' meccses átlag (profit)' });
        drawChart('chart-gg',  buildMAData(fgg,  p), '#eab308', { maLabel: p+' meccses átlag (profit)' });
        drawChart('chart-all', buildMAData(fall, p), '#a855f7', { maLabel: p+' meccses átlag (profit)' });
      } else {
        drawChart('chart-888', buildCumulativeData(f888), '#22c55e');
        drawChart('chart-gg',  buildCumulativeData(fgg),  '#eab308');
        drawChart('chart-all', buildCumulativeData(fall), '#a855f7');
      }
    }

    let newChartsPeriod = 'week';
    function isoWeekKey(date) {
      const d = new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
      const dayNum = d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      const weekNum = Math.ceil((((d-yearStart)/86400000)+1)/7);
      return d.getUTCFullYear()+'-W'+String(weekNum).padStart(2,'0');
    }
    function monthKey(date) { return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0'); }
    function dayKey(date) { return getLocalDateString(date); }
    function yearKey(date) { return String(date.getFullYear()); }

    function aggregateBy(games, grouping, metric) {
      const buckets = {};
      games.forEach(g => {
        if (!g.date) return;
        const d = new Date(g.date+'T00:00:00'); if (isNaN(d.getTime())) return;
        let key;
        if (grouping==='week') key = isoWeekKey(d);
        else if (grouping==='month') key = monthKey(d);
        else if (grouping==='year') key = yearKey(d);
        else key = dayKey(d);
        if (!buckets[key]) buckets[key] = {key, games:[]};
        buckets[key].games.push(g);
      });
      const arr = Object.values(buckets).sort((a,b) => a.key.localeCompare(b.key));
      let cumulativeProfit = 0;
      return arr.map(b => {
        const s = calcStats(b.games);
        const periodProfit = +s.totalProfit.toFixed(2);
        cumulativeProfit += periodProfit;
        let value = 0;
        if (metric==='profit') value = periodProfit;
        else if (metric==='cumprofit') value = cumulativeProfit;
        else if (metric==='roi') value = s.roi;
        else if (metric==='itm') value = s.itmRate;
        else if (metric==='games') value = s.games;
        else if (metric==='cost') value = s.totalCost;
        else if (metric==='prize') value = s.totalPrize;
        return { date:b.key, value:+value.toFixed(2), profit:periodProfit, cumulativeProfit:+cumulativeProfit.toFixed(2), n:s.games };
      });
    }

    function formatBucketLabel(key) {
      if (!key) return '';
      let m = key.match(/^(\d{4})-W(\d{2})$/); if (m) return 'W'+m[2]+" '"+m[1].slice(2);
      m = key.match(/^(\d{4})-(\d{2})$/); if (m) { const months=['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Sze','Okt','Nov','Dec']; return months[parseInt(m[2],10)-1]+" '"+m[1].slice(2); }
      if (/^\d{4}$/.test(key)) return key;
      m = key.match(/^\d{4}-(\d{2})-(\d{2})$/); if (m) return m[1]+'.'+m[2];
      return key;
    }

    // FIX 4: drawBarChart – correct fmt/fmtShort with units, fixed tooltip
    function drawBarChart(containerId, data, color, opts) {
      opts = opts || {};
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!data || data.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:12px;">Még nincs adat</div>';
        return;
      }
      const rect = el.getBoundingClientRect();
      const width = Math.max(280, (rect.width && rect.width > 0 ? rect.width : (el.clientWidth || el.offsetWidth || 320)));
      const height = Math.max(170, el.clientHeight || el.offsetHeight || 190);
      const pad = { top:18, right:14, bottom:34, left:48 };
      const W = width - pad.left - pad.right, H = height - pad.top - pad.bottom;
      const vals = data.map(d => d.value);
      const minV = Math.min(0,...vals), maxV = Math.max(0,...vals), range = (maxV-minV)||1;
      const zeroY = H - ((0-minV)/range)*H;
      const n = data.length, slot = W/n;
      const barW = Math.min(48, Math.max(6, slot*0.6));
      // FIX 4: fmt includes correct unit
      const fmt = (v) => {
        if (opts.percent) return v.toFixed(1)+'%';
        if (opts.intOnly) return v.toFixed(0)+' db';
        return (v>=0?'+':'')+v.toFixed(2)+'$';
      };
      const fmtShort = (v) => {
        if (opts.percent) return v.toFixed(0)+'%';
        if (opts.intOnly) return v.toFixed(0);
        const dec = Math.abs(v)>=100?0:Math.abs(v)>=10?1:2;
        return (v>=0?'+':'')+v.toFixed(dec);
      };
      const ticks = [{v:minV},{v:0},{v:maxV}].filter((t,i,a) => a.findIndex(x=>Math.abs(x.v-t.v)<0.001)===i);
      const stepLabel = Math.max(1, Math.ceil(n/Math.max(3,Math.floor(W/60))));
      const bars = data.map((d,i) => {
        const cx = i*slot + slot/2;
        const y = d.value>=0 ? H-((d.value-minV)/range)*H : zeroY;
        const h = Math.max(1, Math.abs((d.value/range)*H));
        const fill = d.value>=0 ? color : '#ef4444';
        const labelY = d.value>=0 ? y-4 : (y+h+11);
        const showLabel = barW >= 20;
        const valueLabel = showLabel ? `<text x="${cx}" y="${labelY}" text-anchor="middle" fill="#cbd5e1" font-size="10" font-weight="600">${fmtShort(d.value)}</text>` : '';
        return `<g><rect x="${cx-barW/2}" y="${y}" width="${barW}" height="${h}" fill="${fill}" rx="3" data-i="${i}"><title>${formatBucketLabel(d.date)}: ${fmt(d.value)} (${d.n} db)</title></rect>${valueLabel}</g>`;
      }).join('');
      const xlabels = data.map((d,i) => {
        if (i%stepLabel!==0 && i!==n-1) return '';
        return `<text x="${i*slot+slot/2}" y="${H+22}" text-anchor="middle" fill="#94a3b8" font-size="10">${formatBucketLabel(d.date)}</text>`;
      }).join('');
      const tickEls = ticks.map(t => {
        const y = H-((t.v-minV)/range)*H;
        return `<text x="-6" y="${y+3}" text-anchor="end" fill="#6b7280" font-size="10">${fmt(t.v)}</text>
                <line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
      }).join('');
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;display:block;">
        <g transform="translate(${pad.left},${pad.top})">
          ${tickEls}
          <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="rgba(255,255,255,0.30)" stroke-width="1"/>
          ${bars}
          ${xlabels}
        </g>
      </svg><div class="chart-tooltip"></div>`;
      const tip = el.querySelector('.chart-tooltip');
      const rects = el.querySelectorAll('rect[data-i]');
      function showBarTip(idx, clientX) {
        const d = data[idx];
        if (!d || !tip) return;
        const svgRect = el.querySelector('svg').getBoundingClientRect();
        const cx = (idx*slot + slot/2) + pad.left;
        const value = fmt(d.value);
        // FIX 4: show metric label (not generic "Érték"), correct unit already in fmt
        const metricLabel = opts.metricLabel || 'Érték';
        tip.innerHTML = `<strong>${formatBucketLabel(d.date)}</strong><div>${metricLabel}: ${value}</div><div>Verseny: ${d.n} db</div>`;
        tip.style.display = 'block';
        let left = clientX ? clientX - svgRect.left : cx;
        const tipW = tip.offsetWidth;
        if (left - tipW/2 < 4) left = tipW/2 + 4;
        if (left + tipW/2 > width-4) left = width - tipW/2 - 4;
        tip.style.left = left + 'px';
        tip.style.top = (pad.top + 8) + 'px';
      }
      function hideBarTip() { if (tip) tip.style.display='none'; }
      rects.forEach(rect => {
        const idx = Number(rect.getAttribute('data-i'));
        rect.addEventListener('mousemove', e => showBarTip(idx, e.clientX));
        rect.addEventListener('mouseleave', hideBarTip);
        rect.addEventListener('click', e => showBarTip(idx, e.clientX));
        rect.addEventListener('touchstart', e => { if (e.touches[0]) showBarTip(idx, e.touches[0].clientX); }, { passive:true });
        rect.addEventListener('touchmove',  e => { if (e.touches[0]) showBarTip(idx, e.touches[0].clientX); }, { passive:true });
      });
    }

    function aggregatedToLineDataV2(agg, options) {
      options = options || {};
      const plotCumulative = !!options.cumulative || !!options.plotCumulative;
      const includeStart = !!options.includeStart;
      const showPeriodAndCumulative = options.showPeriodAndCumulative !== false;
      const lineLabel = options.cumLabel || (plotCumulative ? 'Kumulált profit' : 'Profit');
      const arr = agg.map(d => ({
        date: formatBucketLabel(d.date),
        cum: +(plotCumulative ? d.cumulativeProfit : d.value).toFixed(2),
        profit: d.profit, cumulativeProfit: d.cumulativeProfit,
        name: d.n + ' verseny', cumLabel: lineLabel,
        showPeriodAndCumulative, isStart: false,
      }));
      if (arr.length === 0) return arr;
      return includeStart ? [{ date:'Start', cum:0, profit:0, cumulativeProfit:0, name:'', isStart:true, cumLabel:lineLabel }, ...arr] : arr;
    }

    function renderNewCharts() {
      const g = newChartsPeriod;
      const a888 = aggregateBy(state.games['888'], g, 'profit');
      const agg  = aggregateBy(state.games['gg'], g, 'profit');
      const aall = aggregateBy([...state.games['888'],...state.games['gg']], g, 'profit');
      const periodLineOptions = { plotCumulative:true, includeStart:true, showPeriodAndCumulative:true, cumLabel:'Kumulált profit' };
      drawChart('nchart-888', aggregatedToLineDataV2(a888, periodLineOptions), '#22c55e');
      drawChart('nchart-gg',  aggregatedToLineDataV2(agg,  periodLineOptions), '#eab308');
      drawChart('nchart-all', aggregatedToLineDataV2(aall, periodLineOptions), '#a855f7');
      renderCustomChart();
    }

    // FIX 4: renderCustomChart passes metricLabel and opts to chart functions
    function renderCustomChart() {
      const metric = document.getElementById('cc-metric')?.value || 'profit';
      const group  = document.getElementById('cc-group')?.value  || 'week';
      const room   = document.getElementById('cc-room')?.value   || 'all';
      const type   = document.getElementById('cc-type')?.value   || 'bar';
      const from   = document.getElementById('cc-from')?.value   || '';
      const to     = document.getElementById('cc-to')?.value     || '';
      let games = room === 'all' ? [...state.games['888'],...state.games['gg']] : state.games[room].slice();
      if (from) games = games.filter(g => (g.date||'') >= from);
      if (to)   games = games.filter(g => (g.date||'') <= to);
      const data = aggregateBy(games, group, metric);
      const metricLabels = { profit:'Profit', cumprofit:'Kumulált profit', roi:'ROI', itm:'ITM arány', games:'Versenyek száma', cost:'Befizetés', prize:'Visszakapott' };
      const groupLabels  = { day:'napi', week:'heti', month:'havi', year:'éves' };
      const roomLabels   = { all:'Összes', '888':'888poker', gg:'GGPoker' };
      const metricLabel  = metricLabels[metric];
      document.getElementById('cc-title').textContent = `${metricLabel} – ${groupLabels[group]} (${roomLabels[room]})`;
      const color = room === '888' ? '#22c55e' : room === 'gg' ? '#eab308' : '#a855f7';
      const isPct   = metric === 'roi' || metric === 'itm';
      const isInt   = metric === 'games';
      const chartOpts = { percent: isPct, intOnly: isInt, metricLabel };
      if (type === 'line') {
        const lineData = aggregatedToLineDataV2(data, {
          cumulative: metric === 'cumprofit',
          plotCumulative: metric === 'profit',
          includeStart: metric === 'profit' || metric === 'cumprofit',
          showPeriodAndCumulative: metric === 'profit' || metric === 'cumprofit',
          cumLabel: (metric === 'profit' || metric === 'cumprofit') ? 'Kumulált profit' : metricLabel
        });
        drawChart('cc-chart', lineData, color, chartOpts);
      } else {
        drawBarChart('cc-chart', data, color, chartOpts);
      }
    }

    function calcStats(games) {
      if (!games || games.length === 0)
        return { games:0,totalProfit:0,totalCost:0,totalPrize:0,itmCount:0,itmRate:0,avgPercentile:null,roi:0,paidGames:0,paidProfit:0,paidCost:0,freeGames:0,freeProfit:0 };
      let totalProfit=0,totalCost=0,totalPrize=0,itmCount=0,percSum=0,percCount=0,paidGames=0,paidProfit=0,paidCost=0,freeGames=0,freeProfit=0;
      for (const g of games) {
        totalProfit += g.profit; totalCost += g.totalCost; totalPrize += g.prize;
        if (g.itm) itmCount += 1;
        if (typeof g.percentile === 'number') { percSum += g.percentile; percCount += 1; }
        const isFree = (Number(g.buyIn)||0) === 0 && (Number(g.totalCost)||0) === 0;
        if (isFree) { freeGames += 1; freeProfit += g.profit; }
        else { paidGames += 1; paidProfit += g.profit; paidCost += g.totalCost; }
      }
      return { games:games.length, totalProfit, totalCost, totalPrize, itmCount, itmRate:games.length?(itmCount/games.length)*100:0, avgPercentile:percCount?percSum/percCount:null, roi:paidCost?(paidProfit/paidCost)*100:0, paidGames, paidProfit, paidCost, freeGames, freeProfit };
    }

    function sampleNote(stats) {
      if (stats.paidGames === 0) return 'ℹ️ ROI-hoz még nincs pénzes játék.';
      if (stats.paidGames < 20) return `⚠️ ROI: még kis minta (${stats.paidGames} pénzes játék).`;
      if (stats.paidGames < 50) return `ℹ️ ROI: alakuló minta (${stats.paidGames} pénzes játék).`;
      return `✓ ROI: ${stats.paidGames} pénzes játék alapján.`;
    }

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    function gameHistory(games) {
      return (games || []).slice().sort((a,b) => {
        const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
        return dateCompare || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    }

    function maxDrawdown(games) {
      let peak = 0, cumulative = 0, maxAmount = 0, peakDate = '', troughDate = '';
      gameHistory(games).forEach(game => {
        cumulative += Number(game.profit) || 0;
        if (cumulative > peak) { peak = cumulative; peakDate = game.date || ''; }
        const currentDrawdown = peak - cumulative;
        if (currentDrawdown > maxAmount) { maxAmount = currentDrawdown; troughDate = game.date || ''; }
      });
      return { amount:maxAmount, from:peakDate, to:troughDate };
    }

    function elapsedLabel(dateString) {
      const start = new Date(dateString);
      if (isNaN(start.getTime())) return '';
      const minutes = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
      if (minutes < 60) return `${minutes} perc`;
      const hours = Math.floor(minutes / 60), remainder = minutes % 60;
      return remainder ? `${hours} ó ${remainder} p` : `${hours} ó`;
    }

    function backupStatusLabel(dateString) {
      if (!dateString) return '💾 Még nincs kézi biztonsági mentés.';
      const when = new Date(dateString);
      if (isNaN(when.getTime())) return '💾 Még nincs kézi biztonsági mentés.';
      const hours = Math.floor((Date.now() - when.getTime()) / 3600000);
      if (hours < 1) return '💾 Biztonsági mentés: kevesebb mint egy órája.';
      if (hours < 24) return `💾 Biztonsági mentés: ${hours} órája.`;
      return `⚠️ Utolsó biztonsági mentés: ${Math.floor(hours / 24)} napja.`;
    }

    function applySparkline(el, needleEl, textEl, stats, label) {
      if (stats.games === 0 || stats.totalCost === 0) {
        needleEl.style.left='calc(50% - 2px)'; needleEl.style.background='#94a3b8'; needleEl.style.boxShadow='0 0 10px rgba(148,163,184,0.9)'; textEl.textContent='⏳ Még nincs elég adat'; return;
      }
      if (stats.paidGames < 20) {
        needleEl.style.left='calc(50% - 2px)'; needleEl.style.background='#fbbf24'; needleEl.style.boxShadow='0 0 10px rgba(251,191,36,0.8)'; textEl.textContent=`⚠️ ${stats.paidGames} pénzes játék — az ROI még nem stabil`; return;
      }
      // Poker-realistic ROI scale: -40% to +40%
      // In SnG/MTT micro-stakes:
      //   -40% or worse = terrible leak
      //   -15% to -5%   = losing player
      //   -5% to +5%    = breakeven zone
      //   +5% to +15%   = solid winning player
      //   +15% to +25%  = crushing it
      //   +25%+         = elite (very rare long-term)
      const roi = stats.roi;
      const maxROI = 40;
      const clamped = Math.max(-maxROI, Math.min(maxROI, roi));
      const pct = 50 + (clamped / maxROI) * 50;
      needleEl.style.left = 'calc('+pct+'% - 2px)';
      let r,g,b;
      if (pct<=50) { const t=pct/50; r=Math.round(239-(239-100)*t); g=Math.round(68+(116-68)*t); b=Math.round(68+(139-68)*t); }
      else { const t=(pct-50)/50; r=Math.round(100-(100-34)*t); g=Math.round(116+(197-116)*t); b=Math.round(139-(139-94)*t); }
      const col='rgb('+r+','+g+','+b+')';
      needleEl.style.background = col; needleEl.style.boxShadow = '0 0 14px '+col;
      // Poker-specific tiered feedback
      let emoji, desc;
      if (roi >= 25)       { emoji='🏆'; desc='Elképesztő forma! Elit szint'; }
      else if (roi >= 15)  { emoji='🔥'; desc='Nagyon erős, hosszú távon is kiváló'; }
      else if (roi >= 5)   { emoji='💪'; desc='Nyerő játékos, szép munka'; }
      else if (roi >= 1)   { emoji='📈'; desc='Enyhén pluszban, jó irány'; }
      else if (roi >= -1)  { emoji='⚖️'; desc='Breakeven zóna'; }
      else if (roi >= -5)  { emoji='📉'; desc='Enyhén mínuszban'; }
      else if (roi >= -15) { emoji='😰'; desc='Veszteséges, érdemes elemezni'; }
      else                 { emoji='🚨'; desc='Komoly leak, változtatni kell'; }
      textEl.textContent = emoji + ' ' + desc + ' ' + label + ' (' + formatPercent(roi) + ' ROI)';
    }

    // === FIX 3: Mentett szűrők (localStorage) ===
    const SAVED_FILTERS_KEY = 'poker-tracker-saved-filters-v1';
    function loadSavedFilters() {
      try { const raw = localStorage.getItem(SAVED_FILTERS_KEY); return raw ? JSON.parse(raw) : []; }
      catch { return []; }
    }
    function storeSavedFilters(filters) { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters)); }
    function renderSavedFilterDropdown() {
      const sel = document.getElementById('saved-filter-select');
      if (!sel) return;
      const current = sel.value;
      const saved = loadSavedFilters();
      sel.innerHTML = '<option value="">Válassz mentett szűrőt...</option>';
      saved.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id; opt.textContent = f.name; sel.appendChild(opt);
      });
      if (current && saved.find(f=>f.id===current)) sel.value = current;
    }
    function applySavedFilter(id) {
      const saved = loadSavedFilters();
      const f = saved.find(x => x.id === id); if (!f) return;
      Object.assign(roomFilters, f.filters);
      syncRoomFilterInputs();
      renderRoomTable();
    }
    function saveCurrentFilter(name) {
      if (!name || !name.trim()) return false;
      const saved = loadSavedFilters();
      saved.push({ id: Date.now()+'_'+Math.random().toString(36).slice(2), name:name.trim(), filters: { search:roomFilters.search, costMode:roomFilters.costMode, exact:roomFilters.exact, min:roomFilters.min, max:roomFilters.max, gameType:roomFilters.gameType, preset:roomFilters.preset||'' } });
      storeSavedFilters(saved);
      renderSavedFilterDropdown();
      return true;
    }
    function deleteSavedFilter(id) {
      storeSavedFilters(loadSavedFilters().filter(f=>f.id!==id));
      renderSavedFilterDropdown();
    }

    let state = loadState();
    let editId = null;
    const roomFilters = { search:'', costMode:'all', exact:'', min:'', max:'', gameType:'all', preset:'' };

    const noteBackdrop = document.getElementById('note-viewer-backdrop');
    const noteBody = document.getElementById('note-viewer-body');
    const tableBody = document.getElementById('table-body');
    const roomLayout = document.getElementById('room-layout');
    const summaryLayout = document.getElementById('summary-layout');
    const roomLabel = document.getElementById('room-label');
    const roomText = document.getElementById('room-text');

    function installEdgeSwipeGuard() {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
      const isStandalone = window.navigator.standalone===true||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
      const isEmbeddedPreview = window.parent && window.parent !== window;
      if (!isIOS||(isEmbeddedPreview&&!isStandalone)) return;
      let startX=0,startY=0,edgeSwipe=false;
      const edgeSize=32;
      document.addEventListener('touchstart',(e)=>{ const t=e.touches&&e.touches[0]; if(!t)return; startX=t.clientX; startY=t.clientY; edgeSwipe=startX<=edgeSize||startX>=window.innerWidth-edgeSize; },{passive:true});
      document.addEventListener('touchmove',(e)=>{ if(!edgeSwipe)return; const t=e.touches&&e.touches[0]; if(!t)return; const dx=t.clientX-startX,dy=t.clientY-startY; const horizontal=Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>8; const leavingRight=startX>=window.innerWidth-edgeSize&&dx<0; const leavingLeft=startX<=edgeSize&&dx>0; if(horizontal&&(leavingRight||leavingLeft)){e.preventDefault();e.stopPropagation();} },{passive:false});
    }
    function openNoteViewer(text) { if (!text) return; noteBody.textContent=text; noteBackdrop.style.display='flex'; }
    function closeNoteViewer() { noteBackdrop.style.display='none'; noteBody.textContent=''; }
    noteBackdrop.addEventListener('click', e => { if(e.target===noteBackdrop) closeNoteViewer(); });
    document.getElementById('note-viewer-close-top').addEventListener('click', closeNoteViewer);
    document.getElementById('note-viewer-close-bottom').addEventListener('click', closeNoteViewer);

    function setEditMode(game) {
      document.getElementById('name').value=game.name||''; document.getElementById('buyIn').value=game.buyIn||'';
      document.getElementById('rebuys').value=game.rebuys||0; document.getElementById('addon').value=game.addon||0;
      document.getElementById('players').value=game.players||''; document.getElementById('position').value=game.position||'';
      document.getElementById('prize').value=game.prize||''; document.getElementById('gameType').value=game.gameType||'MTT';
      document.getElementById('notes').value=game.notes||'';
      const d=document.getElementById('date'); if(d) d.value=game.date||getLocalDateString();
      editId=game.id;
      document.getElementById('submit-btn').textContent='Mentés';
      document.getElementById('btn-cancel-edit').classList.remove('hidden');
      document.getElementById('editing-indicator').classList.remove('hidden');
      // Auto-expand manual form if hidden
      const formWrapper=document.getElementById('manual-form-wrapper');
      const formArrow=document.getElementById('manual-form-arrow');
      if(formWrapper&&formWrapper.classList.contains('hidden')){
        formWrapper.classList.remove('hidden');
        if(formArrow)formArrow.textContent='▼';
      }
      document.getElementById('tournament-form').scrollIntoView({behavior:'smooth',block:'start'});
    }
    function clearEditMode() {
      document.getElementById('tournament-form').reset();
      document.getElementById('rebuys').value='0'; document.getElementById('addon').value='0';
      const d=document.getElementById('date'); if(d) d.value=getLocalDateString();
      editId=null;
      document.getElementById('submit-btn').textContent='+ Verseny hozzáadása';
      document.getElementById('btn-cancel-edit').classList.add('hidden');
      document.getElementById('editing-indicator').classList.add('hidden');
    }
    function deleteGameEntry(id) {
      if (!confirm('Biztosan törölni szeretnéd ezt a versenyt?')) return;
      const idx = state.games[state.room].findIndex(x=>x.id===id);
      if (idx !== -1) { state.games[state.room].splice(idx,1); saveState(state); render(); }
    }
    function normalizeFilterText(value) { return String(value||'').trim().toLowerCase(); }
    function parseFilterMoney(value) { const n=parseFloat(String(value||'').replace(',','.')); return isNaN(n)?null:n; }
    function getGameBuyIn(g) { return Number(g.buyIn)||0; }
    function hasActiveRoomFilters() {
      return !!(roomFilters.search||roomFilters.costMode!=='all'||roomFilters.exact||roomFilters.min||roomFilters.max||roomFilters.gameType!=='all'||roomFilters.preset);
    }
    function gameMatchesRoomFilters(g) {
      const search = normalizeFilterText(roomFilters.search);
      if (search) { const hay=normalizeFilterText([g.name,g.notes,g.gameType,g.date].join(' ')); if(!hay.includes(search))return false; }
      if (roomFilters.gameType!=='all'&&(g.gameType||'').toUpperCase()!==roomFilters.gameType)return false;
      const buyIn=getGameBuyIn(g),exact=parseFilterMoney(roomFilters.exact),min=parseFilterMoney(roomFilters.min),max=parseFilterMoney(roomFilters.max);
      const isFree=buyIn===0&&(Number(g.totalCost)||0)===0;
      if (roomFilters.costMode==='free'&&!isFree)return false;
      if (roomFilters.costMode==='paid'&&isFree)return false;
      if (roomFilters.costMode==='exact'&&(exact===null||Math.abs(buyIn-exact)>0.001))return false;
      if (roomFilters.costMode==='gte'&&(min===null||buyIn<min))return false;
      if (roomFilters.costMode==='lte'&&(max===null||buyIn>max))return false;
      if (roomFilters.costMode==='range'){if(min!==null&&buyIn<min)return false;if(max!==null&&buyIn>max)return false;}
      if (roomFilters.preset==='sng6max025'){const name=normalizeFilterText(g.name);const players=Number(g.players)||0;const looks6Max=players===6||name.includes('6-max')||name.includes('6 max');if((g.gameType||'').toUpperCase()!=='SNG'||Math.abs(buyIn-0.25)>0.001||!looks6Max)return false;}
      return true;
    }
    function filteredRoomGames() { return state.games[state.room].filter(gameMatchesRoomFilters); }
    function syncRoomFilterInputs() {
      const map={'rf-search':'search','rf-cost-mode':'costMode','rf-buyin-exact':'exact','rf-buyin-min':'min','rf-buyin-max':'max','rf-game-type':'gameType'};
      Object.entries(map).forEach(([id,key])=>{ const el=document.getElementById(id); if(el) el.value=roomFilters[key]; });
    }
    function activeRoomFilterLabel() {
      const parts=[];
      if(roomFilters.search)parts.push('kereses: "'+roomFilters.search+'"');
      if(roomFilters.gameType!=='all')parts.push(roomFilters.gameType);
      if(roomFilters.costMode==='free')parts.push('freebuy');
      if(roomFilters.costMode==='paid')parts.push('pénzes');
      if(roomFilters.costMode==='exact'&&roomFilters.exact)parts.push('$'+formatMoney(parseFilterMoney(roomFilters.exact)));
      if(roomFilters.costMode==='gte'&&roomFilters.min)parts.push('$'+formatMoney(parseFilterMoney(roomFilters.min))+'+');
      if(roomFilters.costMode==='lte'&&roomFilters.max)parts.push('max $'+formatMoney(parseFilterMoney(roomFilters.max)));
      if(roomFilters.costMode==='range')parts.push('$'+(roomFilters.min||'0')+' - $'+(roomFilters.max||''));
      if(roomFilters.preset==='sng6max025')parts.push('SNG 6-max $0.25');
      return parts.length ? parts.join(' - ') : 'Szűrt versenyek';
    }
    function updateRoomFilterSummary(filtered) {
      const box = document.getElementById('room-filter-summary');
      if (!box) return;
      const active = hasActiveRoomFilters();
      box.classList.toggle('hidden', !active);
      // FIX 3: update active indicator on toggle button
      const indicator = document.getElementById('filter-active-indicator');
      if (indicator) indicator.classList.toggle('hidden', !active);
      if (!active) return;
      const s = calcStats(filtered);
      const positions = filtered.map(g=>Number(g.position)).filter(n=>!isNaN(n)&&n>0);
      const avgPos = positions.length ? positions.reduce((a,b)=>a+b,0)/positions.length : null;
      document.getElementById('room-filter-summary-title').textContent = (state.room==='gg'?'GGPoker':'888poker')+' - '+activeRoomFilterLabel();
      document.getElementById('room-filter-summary-stats').innerHTML =
        '<span>Db: '+s.games+'</span><span>Profit: '+formatMoney(s.totalProfit)+' $</span>'+
        '<span>ROI: '+formatPercent(s.roi)+'</span><span>Átlag hely: '+(avgPos===null?'-':avgPos.toFixed(1))+'</span>'+
        '<span>ITM: '+formatPercent(s.itmRate)+'</span><span>Költség: '+formatMoney(s.totalCost)+' $</span>';
    }

    function renderRoomTable() {
      tableBody.innerHTML = '';
      const filteredGames = filteredRoomGames();
      updateRoomFilterSummary(filteredGames);
      const sortedGames = filteredGames.slice().sort((a,b)=>{ const da=a.date||'',db=b.date||''; const dc=db.localeCompare(da); return dc!==0?dc:(b.createdAt||'').localeCompare(a.createdAt||''); });
      sortedGames.forEach(g => {
        const row = document.createElement('div');
        row.className = 'table-row';
        const profitSpanClass = g.profit>0?'badge-profit-positive':g.profit<0?'badge-profit-negative':'badge-profit-even';
        const profitText = g.profit>0?'+'+formatMoney(g.profit):g.profit<0?formatMoney(g.profit):'0.00';
        function addCell(text,cls){ const d=document.createElement('div'); if(cls) d.className=cls; d.textContent=text; row.appendChild(d); return d; }
        addCell(g.name||'-',''); addCell(g.date||'-','cell-center'); addCell(formatMoney(g.totalCost),'cell-right'); addCell(formatMoney(g.prize),'cell-right');
        const profitCell=document.createElement('div'); profitCell.className='cell-right'; const profitSpan=document.createElement('span'); profitSpan.className=profitSpanClass; profitSpan.textContent=profitText; profitCell.appendChild(profitSpan); row.appendChild(profitCell);
        const itmCell=document.createElement('div'); itmCell.className='cell-center'; const itmSpan=document.createElement('span'); itmSpan.className=g.itm?'badge-itm-yes':'badge-itm-no'; itmSpan.textContent=g.itm?'Pénzben':'Nem'; itmCell.appendChild(itmSpan); row.appendChild(itmCell);
        addCell(g.gameType||'-','cell-center');
        const percCell=document.createElement('div'); percCell.className='cell-center'; const percSpan=document.createElement('span'); percSpan.className='badge-percentile'; percSpan.textContent=typeof g.percentile==='number'?formatPercent(g.percentile):'-'; percCell.appendChild(percSpan); row.appendChild(percCell);
        addCell(g.players||'-','cell-center'); addCell(g.position||'-','cell-center');
        const notesCell=document.createElement('div');
        if (g.notes&&g.notes.trim()!=='') { notesCell.className='cell-notes'; notesCell.textContent=g.notes; notesCell.title='Kattints a teljes megjegyzéshez'; notesCell.addEventListener('click',e=>{e.stopPropagation();openNoteViewer(g.notes);}); }
        else { notesCell.className='cell-notes cell-notes-empty'; notesCell.textContent='-'; }
        row.appendChild(notesCell);
        const actionCell=document.createElement('div'); actionCell.className='cell-center';
        const editBtn=document.createElement('button'); editBtn.className='action-btn edit'; editBtn.textContent='✏️'; editBtn.title='Szerkesztés'; editBtn.addEventListener('click',e=>{e.stopPropagation();setEditMode(g);}); 
        const delBtn=document.createElement('button'); delBtn.className='action-btn delete'; delBtn.textContent='🗑️'; delBtn.title='Törlés'; delBtn.addEventListener('click',e=>{e.stopPropagation();deleteGameEntry(g.id);});
        actionCell.appendChild(editBtn); actionCell.appendChild(delBtn); row.appendChild(actionCell);
        tableBody.appendChild(row);
      });
    }

    let activeSummaryPeriod = 'all';
    function filterByPeriodGeneric(games, period) {
      if (period === 'all') return games;
      const now = new Date(); let cutoff;
      if (period === 'day') cutoff = getLocalDateString(now);
      else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate()-7); cutoff = getLocalDateString(d); }
      else if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth()-1); cutoff = getLocalDateString(d); }
      else if (period === 'year') { const d = new Date(now); d.setFullYear(d.getFullYear()-1); cutoff = getLocalDateString(d); }
      return games.filter(g => (g.date||'') >= cutoff);
    }
    function tourneyTypeKey(g) {
      const room=g.room==='gg'?'GG':'888', gt=g.gameType||'MTT', bi=Number(g.buyIn)||0;
      const nameRaw=(g.name||'').trim(), nameKey=nameRaw.toLowerCase().replace(/\s+/g,' ');
      const biLabel=bi===0?'Freebuy':'$'+formatMoney(bi);
      const label=nameRaw?(room+' · '+nameRaw+' · '+biLabel):(room+' · '+gt+' · '+biLabel);
      const key=nameKey?(room+'|'+nameKey):(room+'|'+gt+'|bi:'+bi.toFixed(2));
      return {key,label,room,gt,bi};
    }

    document.addEventListener('DOMContentLoaded', () => {
      // Summary period filter buttons
      document.querySelectorAll('#summary-period-filter .period-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          document.querySelectorAll('#summary-period-filter .period-btn').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          activeSummaryPeriod = btn.getAttribute('data-speriod');
          render();
        });
      });
      // Chart mode toggle (kumulált / mozgóátlag)
      document.querySelectorAll('#chart-mode-filter .period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#chart-mode-filter .period-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeChartMode = btn.getAttribute('data-chartmode');
          const maCtrl = document.getElementById('ma-controls');
          if (maCtrl) maCtrl.style.display = activeChartMode === 'ma' ? 'flex' : 'none';
          renderCharts();
        });
      });
      // MA period selector
      document.querySelectorAll('#ma-period-filter .period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#ma-period-filter .period-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeMAPeriod = parseInt(btn.getAttribute('data-ma'), 10);
          renderCharts();
        });
      });
      // Chart time filter
      document.querySelectorAll('#chart-time-filter .period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#chart-time-filter .period-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activePeriod = btn.getAttribute('data-period');
          renderCharts();
        });
      });
      // Analysis room filter
      document.querySelectorAll('#mult-room-filter .period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#mult-room-filter .period-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderAnalysis(btn.getAttribute('data-multroom'));
        });
      });
    });

    function renderAnalysis(multRoomFilter) {
      multRoomFilter = multRoomFilter || document.querySelector('#mult-room-filter .period-btn.active')?.getAttribute('data-multroom') || 'all';
      const all888 = state.games['888'].filter(g => g.multiplier);
      const allGg  = state.games['gg'].filter(g => g.multiplier);
      const gamesForMult = multRoomFilter === '888' ? all888 : multRoomFilter === 'gg' ? allGg : [...all888, ...allGg];
      // Multiplier stats
      const multBuckets = {};
      gamesForMult.forEach(g => {
        const m = g.multiplier;
        if (!multBuckets[m]) multBuckets[m] = [];
        multBuckets[m].push(g);
      });
      const multTable = document.getElementById('multiplier-stats-table');
      if (multTable) {
        const tbody = multTable.querySelector('tbody');
        tbody.innerHTML = '<tr><th>Szorz\u00f3</th><th>Db</th><th>Arány</th><th>1. hely</th><th>ITM%</th><th>Profit</th><th>ROI</th></tr>';
        const sortedKeys = Object.keys(multBuckets).sort((a,b) => parseFloat(a)-parseFloat(b));
        if (sortedKeys.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="7" style="text-align:center;color:#6b7280;">M\u00e9g nincs szorz\u00f3val r\u00f6gz\u00edtett j\u00e1t\u00e9k ebben a sz\u0171r\u0151ben</td>';
          tbody.appendChild(tr);
        } else {
          sortedKeys.forEach(m => {
            const s = calcStats(multBuckets[m]);
            const pc = s.totalProfit>0?'color:#22c55e;':s.totalProfit<0?'color:#ef4444;':'';
            const wins = multBuckets[m].filter(game => Number(game.position) === 1).length;
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${escHtml(m)}</strong></td><td>${s.games}</td><td>${formatPercent((s.games / gamesForMult.length) * 100)}</td><td>${formatPercent((wins / s.games) * 100)}</td><td>${formatPercent(s.itmRate)}</td><td style="${pc}">${formatMoney(s.totalProfit)} $</td><td>${formatPercent(s.roi)}</td>`;
            tbody.appendChild(tr);
          });
        }
      }
      // Versenytípusok az elemzésben
      renderAnalysisTourneyTypes();
      renderAnalysisStakes();
      renderRecentForm();
    }

    function renderAnalysisTourneyTypes() {
      const allGames=[...state.games['888'],...state.games['gg']];
      const groups={};
      allGames.forEach(g=>{ const t=tourneyTypeKey(g); if(!groups[t.key])groups[t.key]={label:t.label,bi:t.bi,games:[]}; groups[t.key].games.push(g); });
      const arr=Object.values(groups).sort((a,b)=>b.games.length-a.games.length||a.bi-b.bi);
      const table=document.getElementById('analysis-tourney-type-table');
      if(!table)return;
      table.innerHTML='<tr><th>Típus</th><th>Db</th><th>Profit</th><th>ROI</th><th>ITM%</th></tr>';
      if(arr.length===0){table.innerHTML+='<tr><td colspan="5" style="color:var(--muted);text-align:center;">Még nincs adat</td></tr>';return;}
      arr.forEach(grp=>{
        const s=calcStats(grp.games);
        const pc=s.totalProfit>0?'color:#22c55e;':s.totalProfit<0?'color:#ef4444;':'';
        const tr=document.createElement('tr');
        tr.innerHTML='<td>'+escHtml(grp.label)+'</td><td>'+s.games+'</td><td style="'+pc+'">'+formatMoney(s.totalProfit)+' $</td><td>'+formatPercent(s.roi)+'</td><td>'+formatPercent(s.itmRate)+'</td>';
        table.appendChild(tr);
      });
    }

    function renderAnalysisStakes() {
      const games = [...state.games['888'],...state.games['gg']];
      const groups = {};
      games.forEach(game => {
        const room = game.room === 'gg' ? 'GG' : '888';
        const type = game.gameType === 'SNG' ? 'SnG' : 'MTT';
        const buyIn = Number(game.buyIn) || 0;
        const players = Number(game.players) || 0;
        const key = `${room}|${type}|${buyIn.toFixed(2)}|${players}`;
        const field = players ? ` · ${players}-max` : '';
        if (!groups[key]) groups[key] = { label:`${room} · ${type} · ${buyIn === 0 ? 'Freebuy' : '$'+formatMoney(buyIn)}${field}`, buyIn, games:[] };
        groups[key].games.push(game);
      });
      const table = document.getElementById('analysis-stakes-table');
      if (!table) return;
      const rows = Object.values(groups).sort((a,b) => b.games.length-a.games.length || a.buyIn-b.buyIn);
      table.innerHTML = '<tr><th>Formátum</th><th>Db</th><th>Profit</th><th>ROI</th><th>ITM%</th></tr>';
      if (!rows.length) { table.innerHTML += '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Még nincs adat</td></tr>'; return; }
      rows.forEach(group => {
        const s = calcStats(group.games);
        const color = s.totalProfit > 0 ? '#22c55e' : s.totalProfit < 0 ? '#ef4444' : 'var(--muted)';
        table.innerHTML += `<tr><td>${escHtml(group.label)}</td><td>${s.games}</td><td style="color:${color};">${formatMoney(s.totalProfit)} $</td><td>${formatPercent(s.roi)}</td><td>${formatPercent(s.itmRate)}</td></tr>`;
      });
    }

    function renderRecentForm() {
      const table = document.getElementById('recent-form-table');
      if (!table) return;
      const newestFirst = gameHistory([...state.games['888'],...state.games['gg']]).reverse();
      table.innerHTML = '<tr><th>Minta</th><th>Db</th><th>Profit</th><th>ROI</th><th>ITM%</th></tr>';
      if (!newestFirst.length) { table.innerHTML += '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Még nincs adat</td></tr>'; return; }
      const shownCounts = new Set();
      [20,50,100].forEach(limit => {
        const subset = newestFirst.slice(0, limit);
        if (!subset.length || shownCounts.has(subset.length)) return;
        shownCounts.add(subset.length);
        const s = calcStats(subset);
        const color = s.totalProfit > 0 ? '#22c55e' : s.totalProfit < 0 ? '#ef4444' : 'var(--muted)';
        table.innerHTML += `<tr><td>Utóbbi ${subset.length}${subset.length < limit ? ` / ${limit}` : ''}</td><td>${s.games}</td><td style="color:${color};">${formatMoney(s.totalProfit)} $</td><td>${formatPercent(s.roi)}</td><td>${formatPercent(s.itmRate)}</td></tr>`;
      });
    }

    function render() {
      const isSummary=state.view==='summary';
      // Apply summary period filter
      const all888Filtered=filterByPeriodGeneric(state.games['888'], activeSummaryPeriod);
      const allGgFiltered=filterByPeriodGeneric(state.games['gg'], activeSummaryPeriod);
      const statsAll=calcStats([...all888Filtered,...allGgFiltered]);
      const statsRoom=calcStats(state.games[state.room]);
      const sum888=calcStats(all888Filtered), sumGg=calcStats(allGgFiltered);
      const activeSessionGames=[...state.games['888'],...state.games['gg']];
      const activeSessionStats=calcStats(activeSessionGames);
      const active888Stats=calcStats(state.games['888']);
      const activeGgStats=calcStats(state.games['gg']);
      const sessionDrawdown=maxDrawdown(activeSessionGames);
      const today=getLocalDateString();
      const todayStats=calcStats(activeSessionGames.filter(game => game.date===today));
      const roomName=state.room==='888'?'888poker':'GGPoker';
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      const activeTab=document.querySelector('.tab[data-tab="'+state.view+'"]');
      if(activeTab)activeTab.classList.add('active');
      const isCharts=state.view==='charts', isNewCharts=state.view==='new-charts', isAnalysis=state.view==='analysis';
      const isRoom=state.view==='888'||state.view==='gg';
      roomLayout.classList.toggle('hidden',!isRoom);
      summaryLayout.classList.toggle('hidden',!isSummary);
      const chartsLayout=document.getElementById('charts-layout');
      if(chartsLayout){chartsLayout.classList.remove('hidden');chartsLayout.style.display=isCharts?'block':'none';}
      const newChartsLayout=document.getElementById('new-charts-layout');
      if(newChartsLayout){newChartsLayout.classList.remove('hidden');newChartsLayout.style.display=isNewCharts?'block':'none';}
      const analysisLayout=document.getElementById('analysis-layout');
      if(analysisLayout){analysisLayout.style.display=isAnalysis?'block':'none';}
      const archiveLayout=document.getElementById('archive-layout');
      if(archiveLayout){archiveLayout.style.display=state.view==='archive'?'block':'none';}
      if(state.view==='archive')renderArchive();
      if(isCharts)requestAnimationFrame(()=>renderCharts());
      if(isNewCharts)requestAnimationFrame(()=>renderNewCharts());
      if(isAnalysis)requestAnimationFrame(()=>renderAnalysis());

      updateQuickPresetOptions(state.room);
      // Sync SNG panel platform dropdown with active room (view update only)
      const sngPlatSel = document.getElementById('sng-platform');
      if (sngPlatSel && isRoom) {
        const roomToPlat = { 'gg': 'ggpoker', '888': '888poker' };
        sngPlatSel.value = roomToPlat[state.room] || '888poker';
      }

      roomText.textContent=roomName;
      document.getElementById('summary-room-label').textContent=roomName;
      roomLabel.classList.toggle('room-888',state.room==='888');
      roomLabel.classList.toggle('room-gg',state.room==='gg');
      const gt=document.getElementById('gameType'); if(gt&&!editId)gt.value=state.room==='gg'?'SNG':'MTT';
      renderRoomTable();
      document.getElementById('room-profit').textContent=formatMoney(statsRoom.totalProfit)+' $';
      document.getElementById('room-profit-nofree').textContent=formatMoney(statsRoom.paidProfit)+' $';
      document.getElementById('room-games').textContent=statsRoom.games;
      document.getElementById('room-itm-rate').textContent=formatPercent(statsRoom.itmRate);
      document.getElementById('room-cost').textContent=formatMoney(statsRoom.totalCost)+' $';
      document.getElementById('room-prize').textContent=formatMoney(statsRoom.totalPrize)+' $';
      document.getElementById('room-itm-count').textContent=statsRoom.itmCount+'x';
      document.getElementById('room-roi-chip').textContent='ROI: '+formatPercent(statsRoom.roi);
      document.getElementById('room-avg-percentile-chip').textContent='Átlagos mezőny%: '+(statsRoom.avgPercentile===null?'-':formatPercent(statsRoom.avgPercentile));
      setText('room-sample-note',sampleNote(statsRoom));
      const balance=(state.baseBalances?.[state.room]??0)+statsRoom.totalProfit;
      const balEl=document.getElementById('room-balance');
      if(balEl){balEl.textContent=formatMoney(balance)+' $';balEl.style.color=balance>=0?'#22c55e':'#ef4444';}
      document.getElementById('all-profit').textContent=formatMoney(statsAll.totalProfit)+' $';
      document.getElementById('all-profit-nofree').textContent=formatMoney(statsAll.paidProfit)+' $';
      document.getElementById('all-games').textContent=statsAll.games;
      document.getElementById('all-itm-rate').textContent=formatPercent(statsAll.itmRate);
      document.getElementById('all-cost').textContent=formatMoney(statsAll.totalCost)+' $';
      document.getElementById('all-prize').textContent=formatMoney(statsAll.totalPrize)+' $';
      document.getElementById('all-itm-count').textContent=statsAll.itmCount+'x';
      document.getElementById('all-roi-chip').textContent='ROI: '+formatPercent(statsAll.roi);
      const allRoiStatEl=document.getElementById('all-roi-stat'); if(allRoiStatEl) allRoiStatEl.textContent=formatPercent(statsAll.roi);
      document.getElementById('all-avg-percentile-chip').textContent='Átlag mezőny%: '+(statsAll.avgPercentile===null?'-':formatPercent(statsAll.avgPercentile));
      setText('all-sample-note',sampleNote(statsAll));
      const totalBalance=(Number(state.baseBalances?.['888'])||0)+active888Stats.totalProfit+(Number(state.baseBalances?.gg)||0)+activeGgStats.totalProfit;
      setText('today-profit',formatMoney(todayStats.totalProfit)+' $');
      setText('today-meta',todayStats.games+' játék · ROI '+formatPercent(todayStats.roi));
      setText('session-profit',formatMoney(activeSessionStats.totalProfit)+' $');
      setText('session-meta',activeSessionStats.games+' játék · '+(elapsedLabel(state.sessionStartedAt) || 'új session'));
      setText('total-balance',formatMoney(totalBalance)+' $');
      setText('session-drawdown','-'+formatMoney(sessionDrawdown.amount)+' $');
      setText('session-drawdown-meta',sessionDrawdown.amount ? `${sessionDrawdown.from || '?'} → ${sessionDrawdown.to || '?'}` : 'Még nincs visszaesés');
      setText('backup-status',backupStatusLabel(state.lastBackupAt));
      // Per-room overview cards
      [['888', sum888], ['gg', sumGg]].forEach(([key, s]) => {
        const pfx = key === '888' ? 'r888' : 'rgg';
        const el = (id) => document.getElementById(id);
        const set = (id, v) => { const e = el(id); if(e) e.textContent = v; };
        set(pfx+'-profit', formatMoney(s.totalProfit)+' $');
        set(pfx+'-profit-nofree', formatMoney(s.paidProfit)+' $');
        set(pfx+'-cost', formatMoney(s.totalCost)+' $');
        set(pfx+'-prize', formatMoney(s.totalPrize)+' $');
        set(pfx+'-games', s.games);
        set(pfx+'-itm-count', s.itmCount+'x');
        set(pfx+'-itm-rate', formatPercent(s.itmRate));
        set(pfx+'-roi-chip', 'ROI: '+formatPercent(s.roi));
        set(pfx+'-roi-stat', formatPercent(s.roi));
        set(pfx+'-avg-chip', 'Átlag mezőny%: '+(s.avgPercentile===null?'-':formatPercent(s.avgPercentile)));
        // Color the profit value
        const profEl = el(pfx+'-profit');
        if(profEl) profEl.style.color = s.totalProfit >= 0 ? '#22c55e' : '#ef4444';
      });


      applySparkline(document.getElementById('sparkline-room'),document.getElementById('sparkline-room-needle'),document.getElementById('sparkline-room-text'),statsRoom,'ebben a teremben');
      // 3-csúszka összehasonlító a Összesített nézetben
      applySparkline(document.getElementById('sparkline-888'),document.getElementById('sparkline-888-needle'),document.getElementById('sparkline-888-text'),sum888,'(888poker)');
      applySparkline(document.getElementById('sparkline-gg'),document.getElementById('sparkline-gg-needle'),document.getElementById('sparkline-gg-text'),sumGg,'(GGPoker)');
      applySparkline(document.getElementById('sparkline-all'),document.getElementById('sparkline-all-needle'),document.getElementById('sparkline-all-text'),statsAll,'összesen');
    }

    document.querySelectorAll('.tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        const t=tab.getAttribute('data-tab'); state.view=t;
        closeQuickSheet();
        if(t==='888'||t==='gg'){state.room=t;const gt=document.getElementById('gameType');if(gt&&!editId)gt.value=t==='gg'?'SNG':'MTT';}
        saveState(state); render();
        if(t==='888'||t==='gg'){
          const sngPlatSel = document.getElementById('sng-platform');
          if (sngPlatSel) {
            const roomToPlat = { 'gg': 'ggpoker', '888': '888poker' };
            sngPlatSel.value = roomToPlat[t] || '888poker';
          }
          sngPopulateTournaments(true);
        }
      });
    });

    document.getElementById('import-json-input').addEventListener('change',(e)=>{
      const file=e.target.files&&e.target.files[0]; if(!file)return;
      const reader=new FileReader();
      reader.onload=(ev)=>{
        try {
          const parsed=JSON.parse(ev.target.result);
          const imported=validateImportedState(parsed);
          const replace=confirm('OK = Lecserélés a fájlban lévő adatokra\nMégse = Egyesítés a meglévő adatokkal');
          if(replace){
            state={room:imported.room,view:imported.view,games:imported.games,baseBalances:imported.baseBalances,archive:imported.archive};
          } else {
            const ids=new Set([...state.games['888'].map(x=>x.id),...state.games['gg'].map(x=>x.id)]);
            ['888','gg'].forEach(r=>{imported.games[r].forEach(g=>{if(!ids.has(g.id))state.games[r].push(g);});});
            if(!Array.isArray(state.archive))state.archive=[];
            const archIds=new Set(state.archive.map(x=>x&&x.id));
            imported.archive.forEach(a=>{if(a&&a.id&&!archIds.has(a.id))state.archive.push(a);});
          }
          if(!state.baseBalances){const p888=state.games['888'].reduce((s,g)=>s+(Number(g.profit)||0),0);const pgg=state.games['gg'].reduce((s,g)=>s+(Number(g.profit)||0),0);state.baseBalances={'888':+(DEFAULT_BALANCE['888']-p888).toFixed(2),'gg':+(DEFAULT_BALANCE['gg']-pgg).toFixed(2)};}
          saveState(state); render(); alert('Sikeres betöltés!');
        } catch(err){alert('Hiba a JSON betöltésekor: '+err.message);}
        finally{e.target.value='';}
      };
      reader.readAsText(file);
    });

    document.getElementById('tournament-form').addEventListener('submit',(e)=>{
      e.preventDefault(); document.getElementById('form-error').textContent='';
      const data=Object.fromEntries(new FormData(e.target).entries());
      if(!data.players||!data.position){document.getElementById('form-error').textContent='Kötelező a résztvevők száma és a saját helyezés.';return;}
      if(editId){
        const idx=state.games[state.room].findIndex(x=>x.id===editId);
        if(idx!==-1){const orig=state.games[state.room][idx];const updated=createGameEntry(state.room,data);updated.id=orig.id;updated.createdAt=orig.createdAt;state.games[state.room][idx]=updated;saveState(state);clearEditMode();render();return;}
      }
      state.games[state.room].push(createGameEntry(state.room,data)); saveState(state); clearEditMode(); render();
    });

    // Okos fájlmentés: iframe (Claude) → postMessage, PWA/standalone → Web Share API, fallback → data URI
    function saveFileToDevice(filename, blob) {
      const isEmbedded = window.parent && window.parent !== window;
      if (isEmbedded) {
        blob.arrayBuffer().then(data => {
          window.parent.postMessage({ type:'downloadFile', filename, data, mimeType: blob.type || 'application/octet-stream' });
        });
        return;
      }
      // PWA / Safari standalone – Web Share API (fájlmegosztás)
      if (typeof navigator.share === 'function') {
        const file = new File([blob], filename, { type: blob.type });
        const canShare = typeof navigator.canShare === 'function' ? navigator.canShare({ files:[file] }) : true;
        if (canShare) {
          navigator.share({ files:[file], title: filename }).catch(() => fallbackSave(filename, blob));
          return;
        }
      }
      fallbackSave(filename, blob);
    }
    function fallbackSave(filename, blob) {
      const reader = new FileReader();
      reader.onload = () => {
        const a = document.createElement('a');
        a.href = reader.result; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      };
      reader.readAsDataURL(blob);
    }

    document.querySelectorAll('.btn-export-json').forEach(button => button.addEventListener('click',()=>{
      state.lastBackupAt = new Date().toISOString();
      saveState(state);
      saveFileToDevice('poker-tracker-backup.json', new Blob([JSON.stringify(state,null,2)], {type:'application/json'}));
      render();
    }));



    document.getElementById('btn-cancel-edit').addEventListener('click', clearEditMode);

    document.addEventListener('DOMContentLoaded',()=>{
      installEdgeSwipeGuard();
      initSngPanel();
      // Charts period filters
      document.querySelectorAll('.period-btn[data-period]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          document.querySelectorAll('.period-btn[data-period]').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active'); activePeriod=btn.getAttribute('data-period');
          if(state.view==='charts')renderCharts();
        });
      });
      document.querySelectorAll('.period-btn[data-nperiod]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          document.querySelectorAll('.period-btn[data-nperiod]').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active'); newChartsPeriod=btn.getAttribute('data-nperiod');
          if(state.view==='new-charts')renderNewCharts();
        });
      });
      ['cc-metric','cc-group','cc-room','cc-type','cc-from','cc-to'].forEach(id=>{
        const el=document.getElementById(id);
        if(el)el.addEventListener('change',()=>{if(state.view==='new-charts')renderCustomChart();});
      });
      // Room filter inputs
      const filterMap={'rf-search':'search','rf-cost-mode':'costMode','rf-buyin-exact':'exact','rf-buyin-min':'min','rf-buyin-max':'max','rf-game-type':'gameType'};
      Object.entries(filterMap).forEach(([id,key])=>{
        const el=document.getElementById(id); if(!el)return;
        el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>{roomFilters[key]=el.value;roomFilters.preset='';renderRoomTable();});
      });
      document.querySelectorAll('[data-filter-preset]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const preset=btn.getAttribute('data-filter-preset');
          Object.assign(roomFilters,{search:'',costMode:'all',exact:'',min:'',max:'',gameType:'all',preset});
          if(preset==='free')roomFilters.costMode='free';
          if(preset==='paid')roomFilters.costMode='paid';
          if(preset==='buyin025')Object.assign(roomFilters,{costMode:'exact',exact:'0.25'});
          if(preset==='buyin1plus')Object.assign(roomFilters,{costMode:'gte',min:'1'});
          if(preset==='sng6max025')Object.assign(roomFilters,{costMode:'exact',exact:'0.25',gameType:'SNG'});
          syncRoomFilterInputs(); renderRoomTable();
        });
      });
      const clearFilters=document.getElementById('rf-clear');
      if(clearFilters)clearFilters.addEventListener('click',()=>{Object.assign(roomFilters,{search:'',costMode:'all',exact:'',min:'',max:'',gameType:'all',preset:''});syncRoomFilterInputs();renderRoomTable();});
      const editBalBtn=document.getElementById('btn-edit-balance');
      if(editBalBtn)editBalBtn.addEventListener('click',()=>{
        const statsRoom=calcStats(state.games[state.room]);
        const current=((state.baseBalances?.[state.room]??0)+statsRoom.totalProfit);
        const input=prompt('Jelenlegi egyenleg ('+(state.room==='888'?'888poker':'GGPoker')+'):',current.toFixed(2));
        if(input===null)return;
        const v=parseFloat(input.replace(',','.'));
        if(isNaN(v)){alert('Érvénytelen szám');return;}
        if(!state.baseBalances)state.baseBalances={'888':0,'gg':0};
        state.baseBalances[state.room]=+(v-statsRoom.totalProfit).toFixed(2);
        saveState(state); render();
      });
      window.addEventListener('resize',()=>{if(state.view==='charts')renderCharts();if(state.view==='new-charts')renderNewCharts();});
      document.querySelectorAll('.table-wrapper').forEach(wrap=>{
        wrap.addEventListener('wheel',e=>{const canScrollX=wrap.scrollWidth>wrap.clientWidth;if(!canScrollX)return;if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){wrap.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
      });

      // FIX 3: Filter toggle button
      const btnToggleFilters=document.getElementById('btn-toggle-filters');
      if(btnToggleFilters){
        btnToggleFilters.addEventListener('click',()=>{
          const panel=document.getElementById('room-filter-panel');
          const arrow=document.getElementById('filter-toggle-arrow');
          const isHidden=panel.classList.contains('hidden');
          panel.classList.toggle('hidden',!isHidden);
          if(arrow) arrow.textContent=isHidden?'▼':'▶';
        });
      }

      // Manual form toggle button
      const btnToggleManualForm=document.getElementById('btn-toggle-manual-form');
      if(btnToggleManualForm){
        btnToggleManualForm.addEventListener('click',()=>{
          const wrapper=document.getElementById('manual-form-wrapper');
          const arrow=document.getElementById('manual-form-arrow');
          const isHidden=wrapper.classList.contains('hidden');
          wrapper.classList.toggle('hidden',!isHidden);
          if(arrow) arrow.textContent=isHidden?'▼':'▶';
        });
      }

      // FIX 3: Saved filters event listeners
      renderSavedFilterDropdown();
      const savedFilterSel=document.getElementById('saved-filter-select');
      if(savedFilterSel){
        savedFilterSel.addEventListener('change',()=>{
          if(savedFilterSel.value) applySavedFilter(savedFilterSel.value);
        });
      }
      const btnSaveFilter=document.getElementById('btn-save-filter');
      if(btnSaveFilter){
        btnSaveFilter.addEventListener('click',()=>{
          const nameEl=document.getElementById('save-filter-name');
          const name=(nameEl?.value||'').trim();
          if(!name){if(nameEl)nameEl.focus();return;}
          if(saveCurrentFilter(name)){
            if(nameEl)nameEl.value='';
            const orig=btnSaveFilter.textContent;
            btnSaveFilter.textContent='✓ Elmentve!';
            setTimeout(()=>btnSaveFilter.textContent=orig,1500);
          }
        });
      }
      const btnDeleteSaved=document.getElementById('btn-delete-saved-filter');
      if(btnDeleteSaved){
        btnDeleteSaved.addEventListener('click',()=>{
          const sel=document.getElementById('saved-filter-select');
          if(!sel?.value)return;
          if(confirm('Törlöd a "'+sel.options[sel.selectedIndex]?.text+'" szűrőt?')){
            deleteSavedFilter(sel.value); sel.value='';
          }
        });
      }
    });

    // =========================================================
    // ARHIVÁLÁS ÉS MENTÉS – session archiválása + új session indítása
    // =========================================================
    const ROOM_NAMES = { '888': '888poker', 'gg': 'GGPoker' };

    function escHtml(v) {
      return String(v === null || v === undefined ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function signedMoney(v) { const n = Number(v)||0; return (n >= 0 ? '+' : '') + n.toFixed(2) + ' $'; }
    function profitColor(v) { const n = Number(v)||0; return n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : 'var(--muted)'; }
    function parseMoneyInput(v) {
      const n = parseFloat(String(v === null || v === undefined ? '' : v).trim().replace(/\s/g,'').replace(',','.'));
      return isNaN(n) ? null : n;
    }
    function showAppToast(html) {
      const toast = document.getElementById('sng-toast');
      const toastText = document.getElementById('sng-toast-text');
      if (!toast || !toastText) return;
      hideQuickUndo();
      toastText.innerHTML = html;
      toast.classList.remove('hidden','sng-toast-out');
      toast.classList.add('sng-toast-in');
      clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => {
        toast.classList.remove('sng-toast-in');
        toast.classList.add('sng-toast-out');
        setTimeout(() => { toast.classList.add('hidden'); toast.classList.remove('sng-toast-out'); }, 350);
      }, 2800);
    }

    function currentSessionSummary() {
      const out = { total: 0, totalProfit: 0, rooms: {}, firstDate: '', lastDate: '' };
      const dates = [];
      ['888','gg'].forEach(r => {
        const games = state.games[r] || [];
        const st = calcStats(games);
        const base = Number(state.baseBalances?.[r]) || 0;
        out.rooms[r] = { games: games.length, profit: st.totalProfit, start: base, end: base + st.totalProfit };
        out.total += games.length;
        out.totalProfit += st.totalProfit;
        games.forEach(g => { if (g.date) dates.push(g.date); });
      });
      dates.sort();
      out.firstDate = dates[0] || '';
      out.lastDate = dates[dates.length-1] || '';
      return out;
    }

    function openSessionModal() {
      const sum = currentSessionSummary();
      if (sum.total === 0) { alert('Nincs rögzített verseny az aktuális sessionben, így nincs mit archiválni.'); return; }
      const rows = ['gg','888'].map(r => {
        const x = sum.rooms[r];
        return '<div class="sm-row"><span>' + (r === 'gg' ? '🃏 ' : '🎰 ') + ROOM_NAMES[r] + ' · ' + x.games + ' verseny</span>'
          + '<span><span style="color:' + profitColor(x.profit) + ';font-weight:600;">' + signedMoney(x.profit) + '</span>'
          + ' · egyenleg: ' + x.start.toFixed(2) + ' → <strong>' + x.end.toFixed(2) + ' $</strong></span></div>';
      }).join('');
      const range = sum.firstDate ? (sum.firstDate === sum.lastDate ? sum.firstDate : sum.firstDate + ' → ' + sum.lastDate) : '';
      document.getElementById('session-modal-summary').innerHTML =
        '<div class="sm-row"><strong>Archiválásra kerül: ' + sum.total + ' verseny</strong><span>' + escHtml(range) + '</span></div>'
        + rows
        + '<div class="sm-row"><span>Session összprofit</span><strong style="color:' + profitColor(sum.totalProfit) + ';">' + signedMoney(sum.totalProfit) + '</strong></div>';
      document.getElementById('session-name').value = '';
      document.getElementById('session-new-gg').value = '';
      document.getElementById('session-new-888').value = '';
      document.getElementById('session-modal-error').textContent = '';
      document.getElementById('session-modal-backdrop').classList.add('open');
      setTimeout(() => { const el = document.getElementById('session-new-gg'); if (el) el.focus(); }, 60);
    }
    function closeSessionModal() {
      document.getElementById('session-modal-backdrop').classList.remove('open');
    }

    function confirmSessionArchive() {
      const errEl = document.getElementById('session-modal-error');
      errEl.textContent = '';
      const newGg = parseMoneyInput(document.getElementById('session-new-gg').value);
      const new888 = parseMoneyInput(document.getElementById('session-new-888').value);
      if (newGg === null || new888 === null) { errEl.textContent = 'Add meg mindkét kezdő egyenleget (GGPoker és 888poker).'; return; }
      if (newGg < 0 || new888 < 0) { errEl.textContent = 'Az egyenleg nem lehet negatív.'; return; }

      const sum = currentSessionSummary();
      if (sum.total === 0) { errEl.textContent = 'Nincs mit archiválni.'; return; }

      const name = document.getElementById('session-name').value.trim();
      const session = {
        id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: name,
        savedAt: new Date().toISOString(),
        startDate: sum.firstDate,
        endDate: sum.lastDate,
        startBalances: { '888': +sum.rooms['888'].start.toFixed(2), 'gg': +sum.rooms['gg'].start.toFixed(2) },
        endBalances:   { '888': +sum.rooms['888'].end.toFixed(2),   'gg': +sum.rooms['gg'].end.toFixed(2) },
        games: {
          '888': JSON.parse(JSON.stringify(state.games['888'] || [])),
          'gg':  JSON.parse(JSON.stringify(state.games['gg'] || []))
        }
      };

      // Egyetlen írással: archívum + kiürített aktív állapot + új kezdő egyenlegek.
      // Ha a mentés nem sikerül, az aktív adatok érintetlenek maradnak.
      const next = {
        room: state.room,
        view: state.view,
        games: { '888': [], 'gg': [] },
        baseBalances: { '888': +new888.toFixed(2), 'gg': +newGg.toFixed(2) },
        archive: [session].concat(Array.isArray(state.archive) ? state.archive : []),
        sessionStartedAt: new Date().toISOString(),
        lastBackupAt: state.lastBackupAt || null
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        const check = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!check || !Array.isArray(check.archive) || check.archive.length !== next.archive.length) throw new Error('Az ellenőrző visszaolvasás nem sikerült');
      } catch (e) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e2) {}
        errEl.textContent = 'Az archiválás nem sikerült, az aktuális adatok nem változtak: ' + e.message;
        return;
      }
      state = next;

      // Aktív követési állapot teljes törlése (szerkesztés, szűrők)
      clearEditMode();
      Object.assign(roomFilters, { search:'', costMode:'all', exact:'', min:'', max:'', gameType:'all', preset:'' });
      syncRoomFilterInputs();

      closeSessionModal();
      render();
      showAppToast('✅ <strong>Session archiválva</strong> · ' + sum.total + ' verseny · ' + signedMoney(sum.totalProfit));
    }

    function renderArchiveGamesTable(session) {
      const rows = [];
      ['gg','888'].forEach(r => (session.games?.[r] || []).forEach(g => rows.push({ r, g })));
      rows.sort((a, b) => (a.g.date || '').localeCompare(b.g.date || '') || (a.g.createdAt || '').localeCompare(b.g.createdAt || ''));
      if (!rows.length) return '<div class="summary-note">Nincs verseny ebben a sessionben.</div>';
      const body = rows.map(({ r, g }) =>
        '<tr><td>' + escHtml(g.date || '-') + '</td><td>' + (r === 'gg' ? 'GG' : '888') + '</td><td>' + escHtml(g.name || '-') + '</td>'
        + '<td class="num">' + (g.position || '-') + '</td>'
        + '<td class="num">' + formatMoney(g.totalCost) + '</td><td class="num">' + formatMoney(g.prize) + '</td>'
        + '<td class="num" style="color:' + profitColor(g.profit) + ';">' + signedMoney(g.profit) + '</td></tr>').join('');
      return '<div class="archive-games"><table class="stats-table"><tbody>'
        + '<tr><th>Dátum</th><th>Terem</th><th>Verseny</th><th>Hely.</th><th>Költség</th><th>Nyerem.</th><th>Profit</th></tr>'
        + body + '</tbody></table></div>';
    }

    function renderArchive() {
      const list = document.getElementById('archive-list');
      const note = document.getElementById('archive-total-note');
      if (!list) return;
      const archive = Array.isArray(state.archive) ? state.archive : [];
      if (!archive.length) {
        if (note) note.textContent = '';
        list.innerHTML = '<div class="archive-empty">Még nincs archivált session. A „Session mentése” gombbal archiválhatod az aktuális sessiont.</div>';
        return;
      }
      let totalProfit = 0, totalGames = 0;
      const cards = archive.map(sess => {
        const s888 = calcStats(sess.games?.['888'] || []);
        const sgg = calcStats(sess.games?.['gg'] || []);
        const profit = s888.totalProfit + sgg.totalProfit;
        const gamesN = s888.games + sgg.games;
        totalProfit += profit; totalGames += gamesN;
        const range = sess.startDate ? (sess.startDate === sess.endDate ? sess.startDate : sess.startDate + ' → ' + sess.endDate) : '–';
        const savedAt = sess.savedAt ? new Date(sess.savedAt) : null;
        const savedLabel = savedAt && !isNaN(savedAt) ? getLocalDateString(savedAt) + ' ' + String(savedAt.getHours()).padStart(2,'0') + ':' + String(savedAt.getMinutes()).padStart(2,'0') : '';
        const roomBox = (key, st, icon) => {
          const sb = Number(sess.startBalances?.[key]) || 0, eb = Number(sess.endBalances?.[key]) || 0;
          return '<div class="archive-room">'
            + '<div class="archive-room-name"><span>' + icon + ' ' + ROOM_NAMES[key] + '</span><span style="color:' + profitColor(st.totalProfit) + ';">' + signedMoney(st.totalProfit) + '</span></div>'
            + '<div class="ar-line"><span>Egyenleg</span><span>' + sb.toFixed(2) + ' → ' + eb.toFixed(2) + ' $</span></div>'
            + '<div class="ar-line"><span>Versenyek</span><span>' + st.games + '</span></div>'
            + '<div class="ar-line"><span>ITM / ROI</span><span>' + formatPercent(st.itmRate) + ' / ' + formatPercent(st.roi) + '</span></div>'
            + '</div>';
        };
        return '<div class="archive-card" data-sid="' + escHtml(sess.id) + '">'
          + '<div class="archive-card-head"><div>'
          + '<div class="archive-card-title">' + (sess.name ? escHtml(sess.name) + ' · ' : '') + escHtml(range) + '</div>'
          + '<div class="archive-card-sub">' + gamesN + ' verseny' + (savedLabel ? ' · archiválva: ' + escHtml(savedLabel) : '') + '</div>'
          + '</div><div class="archive-profit" style="color:' + profitColor(profit) + ';">' + signedMoney(profit) + '</div></div>'
          + '<div class="archive-rooms">' + roomBox('gg', sgg, '🃏') + roomBox('888', s888, '🎰') + '</div>'
          + '<div class="archive-actions">'
          + '<button class="secondary" type="button" data-archive-toggle="' + escHtml(sess.id) + '">▶ Versenyek megtekintése</button>'
          + '<button class="danger" type="button" data-archive-delete="' + escHtml(sess.id) + '">✕ Törlés</button>'
          + '</div>'
          + '<div class="archive-games-holder hidden"></div>'
          + '</div>';
      }).join('');
      if (note) note.innerHTML = archive.length + ' archivált session · ' + totalGames + ' verseny · összprofit: <strong style="color:' + profitColor(totalProfit) + ';">' + signedMoney(totalProfit) + '</strong>';
      list.innerHTML = cards;
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.btn-save-session').forEach(b => b.addEventListener('click', openSessionModal));
      const ids = [['session-modal-close', closeSessionModal], ['session-modal-cancel', closeSessionModal], ['session-modal-confirm', confirmSessionArchive]];
      ids.forEach(([id, fn]) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); });
      const backdrop = document.getElementById('session-modal-backdrop');
      if (backdrop) backdrop.addEventListener('click', e => { if (e.target === backdrop) closeSessionModal(); });
      ['session-new-gg', 'session-new-888', 'session-name'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirmSessionArchive(); } });
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && backdrop && backdrop.classList.contains('open')) closeSessionModal();
      });

      const list = document.getElementById('archive-list');
      if (list) list.addEventListener('click', e => {
        const tgl = e.target.closest('[data-archive-toggle]');
        const del = e.target.closest('[data-archive-delete]');
        if (tgl) {
          const sid = tgl.getAttribute('data-archive-toggle');
          const card = tgl.closest('.archive-card');
          const holder = card.querySelector('.archive-games-holder');
          const opening = holder.classList.contains('hidden');
          if (opening && !holder.innerHTML) {
            const sess = (state.archive || []).find(x => x.id === sid);
            holder.innerHTML = sess ? renderArchiveGamesTable(sess) : '';
          }
          holder.classList.toggle('hidden', !opening);
          tgl.textContent = (opening ? '▼ ' : '▶ ') + 'Versenyek megtekintése';
        } else if (del) {
          const sid = del.getAttribute('data-archive-delete');
          if (!confirm('Biztosan törlöd ezt az archivált sessiont? Ez nem vonható vissza.')) return;
          state.archive = (state.archive || []).filter(x => x.id !== sid);
          saveState(state);
          renderArchive();
        }
      });
    });

    function getLocalDateString(date=new Date()){
      const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
      return `${year}-${month}-${day}`;
    }
    function setTodayDate(){ const d=document.getElementById('date'); if(d)d.value=getLocalDateString(); }
    setTodayDate();
    initSngPanel();
    render();
