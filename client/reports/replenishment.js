// ─── client/reports/replenishment.js ─────────────────────────────────────────

window.REPORTS['replenishment'] = {
  title:       'Replenishment Planner',
  description: 'Calculate how much of each SKU to order so you never run out of stock.',

  render(container) {
    container.innerHTML = `
      <div class="config-panel">
        <div class="panel-label">▸ Settings</div>
        <div class="fields-row">
          <div class="field">
            <label>Velocity Window (days)</label>
            <input type="number" id="rpl-days" value="30" min="1" max="365" style="width:100px">
          </div>
          <div class="field">
            <label>Coverage Target (days)</label>
            <input type="number" id="rpl-coverage" value="60" min="1" max="365" style="width:100px">
          </div>
          <div class="field">
            <label>Lead Time (days)</label>
            <input type="number" id="rpl-leadtime" value="14" min="0" max="365" style="width:100px">
          </div>
          <div class="field">
            <label>Search SKU / Name</label>
            <div class="search-wrap">
              <span class="search-icon">⌕</span>
              <input type="text" id="rpl-search" placeholder="Filter…" oninput="window.REPORTS['replenishment'].filter()">
            </div>
          </div>
          <button class="run-btn" id="rpl-btn" onclick="window.REPORTS['replenishment'].run()">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Report
          </button>
        </div>
      </div>
      <div id="rpl-results"></div>`;

    this._results = [];
    this._coverage = 60;
  },

  async run() {
    if (!window.validateConfig()) return;
    const days     = parseInt(document.getElementById('rpl-days').value);
    const coverage = parseInt(document.getElementById('rpl-coverage').value);
    const leadTime = parseInt(document.getElementById('rpl-leadtime').value);
    this._coverage = coverage;

    const btn = document.getElementById('rpl-btn');
    btn.disabled = true;

    const url = window.buildReportURL('replenishment', { days, coverageDays: coverage, leadTime });

    try {
      const data = await window.fetchReportSSE(url, (p) => window.setStatus(p.message));
      this._results = data.rows;
      this.renderResults(data);
      window.setStatus(`Done — ${data.rows.length} SKUs analysed.`, 'success');
    } catch (err) {
      window.setStatus(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  filter() {
    if (this._results.length) this.renderTable(this._results);
  },

  renderResults(data) {
    const needsOrder = data.rows.filter(r => r.orderQty > 0).length;
    const critical   = data.rows.filter(r => r.daysLeft !== null && r.daysLeft <= r.leadTime).length;
    const total      = data.rows.reduce((s, r) => s + r.orderQty, 0);

    const resultsEl = document.getElementById('rpl-results');
    resultsEl.innerHTML = window.buildStats([
      { label: 'SKUs Analysed',       value: data.rows.length,         color: '' },
      { label: 'Need Ordering',        value: needsOrder,               color: needsOrder > 0 ? 'warning' : 'success' },
      { label: 'Critical (≤ lead time)', value: critical,              color: critical > 0 ? 'danger' : 'success' },
      { label: 'Total Units to Order', value: total.toLocaleString(),   color: '' },
    ]);

    resultsEl.innerHTML += `
      <div class="results-header">
        <div class="results-label">▸ Results</div>
        <div style="display:flex;gap:8px">
          <div class="results-meta">${data.rows.length} SKUs · ${new Date().toLocaleString('en-GB')}</div>
          <button class="export-btn" onclick="window.REPORTS['replenishment'].export()">↓ Export CSV</button>
        </div>
      </div>
      <div id="rpl-table"></div>`;

    this.renderTable(data.rows);
  },

  renderTable(rows) {
    const search  = (document.getElementById('rpl-search')?.value || '').toLowerCase();
    const filtered = search ? rows.filter(r =>
      r.sku.toLowerCase().includes(search) || r.name.toLowerCase().includes(search)
    ) : rows;

    const coverage = this._coverage;

    const columns = [
      { key: 'sku',       label: 'SKU' },
      { key: 'name',      label: 'Product Name', render: r => `<span class="muted" title="${r.name}">${r.name || '—'}</span>` },
      { key: 'stock',     label: 'Stock',      align: 'right', render: r => r.stock.toLocaleString() },
      { key: 'totalSold', label: 'Units Sold', align: 'right', render: r => `<span style="color:var(--accent2);font-weight:500">${r.totalSold.toLocaleString()}</span>` },
      { key: 'dailyVel',  label: 'Daily Vel.', align: 'right' },
      { key: 'daysLeft',  label: 'Days Remaining', render: r => {
        const pct   = r.daysLeft === null ? 100 : Math.min(100, (r.daysLeft / coverage) * 100);
        const color = r.daysLeft !== null && r.daysLeft <= r.leadTime ? 'var(--danger)' : r.daysLeft !== null && r.daysLeft < coverage / 2 ? 'var(--warning)' : 'var(--accent)';
        return `<div class="bar-wrap">
          <div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span style="font-size:11px;color:var(--text-muted);min-width:36px;text-align:right">${r.daysLeft === null ? '∞' : r.daysLeft + 'd'}</span>
        </div>`;
      }},
      { key: 'leadTime',  label: 'Lead Time', align: 'right', render: r => r.leadTime + 'd' },
      { key: 'orderQty',  label: 'Order Qty', align: 'right', render: r =>
        r.orderQty > 0
          ? `<span class="bold" style="color:var(--accent)">${r.orderQty.toLocaleString()}</span>`
          : `<span style="color:var(--text-dim)">—</span>`
      },
      { key: 'status', label: 'Status', render: r => {
        if (r.orderQty === 0) return window.badge('Sufficient', 'muted');
        if (r.daysLeft !== null && r.daysLeft <= r.leadTime) return window.badge('Critical', 'danger');
        if (r.daysLeft !== null && r.daysLeft < coverage / 2) return window.badge('Low Stock', 'warning');
        return window.badge('Order Soon', 'accent');
      }},
    ];

    window.buildTable(document.getElementById('rpl-table'), { columns, rows: filtered });
  },

  export() {
    window.exportCSV('replenishment.csv', [
      { key: 'sku',       label: 'SKU' },
      { key: 'name',      label: 'Product Name' },
      { key: 'stock',     label: 'Stock' },
      { key: 'totalSold', label: 'Units Sold' },
      { key: 'dailyVel',  label: 'Daily Velocity' },
      { key: 'daysLeft',  label: 'Days Remaining', csvValue: r => r.daysLeft ?? 'N/A' },
      { key: 'leadTime',  label: 'Lead Time (days)' },
      { key: 'orderQty',  label: 'Order Qty' },
    ], this._results);
  }
};
