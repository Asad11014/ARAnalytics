// ─── client/reports/dead-stock.js ────────────────────────────────────────────

window.REPORTS['dead-stock'] = {
  title:       'Dead Stock Report',
  description: 'Identify SKUs that haven\'t sold — freeing up warehouse space and tied-up capital.',

  render(container) {
    container.innerHTML = `
      <div class="config-panel">
        <div class="panel-label">▸ Settings</div>
        <div class="fields-row">
          <div class="field">
            <label>Lookback Period (days)</label>
            <input type="number" id="ds-days" value="90" min="1" max="365" style="width:110px">
          </div>
          <div class="field">
            <label>Dead = sold fewer than</label>
            <input type="number" id="ds-threshold" value="1" min="0" max="100" style="width:80px">
            <span style="font-size:11px;font-family:var(--mono);color:var(--text-muted);margin-top:2px">units</span>
          </div>
          <button class="run-btn" id="ds-btn" onclick="window.REPORTS['dead-stock'].run()">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Report
          </button>
        </div>
      </div>
      <div id="ds-results"></div>`;
    this._results = [];
  },

  async run() {
    if (!window.validateConfig()) return;
    const days      = parseInt(document.getElementById('ds-days').value);
    const threshold = parseInt(document.getElementById('ds-threshold').value);
    const btn       = document.getElementById('ds-btn');
    btn.disabled    = true;

    const url = window.buildReportURL('dead-stock', { days, threshold });

    try {
      const data = await window.fetchReportSSE(url, p => window.setStatus(p.message));
      this._results = data.rows;
      this.renderResults(data);
      window.setStatus(`Done — ${data.rows.length} dead stock SKUs found.`, 'success');
    } catch(err) {
      window.setStatus(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  renderResults(data) {
    const high   = data.rows.filter(r => r.severity === 'high').length;
    const medium = data.rows.filter(r => r.severity === 'medium').length;
    const total  = data.rows.reduce((s, r) => s + r.stock, 0);

    const el = document.getElementById('ds-results');
    el.innerHTML = window.buildStats([
      { label: 'Dead SKUs Found',   value: data.rows.length,        color: data.rows.length > 0 ? 'warning' : 'success' },
      { label: 'High Priority',      value: high,                   color: high > 0 ? 'danger' : 'success' },
      { label: 'Medium Priority',    value: medium,                 color: medium > 0 ? 'warning' : '' },
      { label: 'Total Units Sitting', value: total.toLocaleString(), color: '' },
    ]);

    el.innerHTML += `
      <div class="results-header">
        <div class="results-label">▸ Dead Stock SKUs</div>
        <button class="export-btn" onclick="window.REPORTS['dead-stock'].export()">↓ Export CSV</button>
      </div>
      <div id="ds-table"></div>`;

    const columns = [
      { key: 'sku',      label: 'SKU' },
      { key: 'name',     label: 'Product Name', render: r => `<span class="muted">${r.name || '—'}</span>` },
      { key: 'stock',    label: 'Units in Stock', align: 'right', render: r => `<span class="bold">${r.stock.toLocaleString()}</span>` },
      { key: 'totalSold', label: 'Units Sold (Period)', align: 'right', render: r => r.totalSold === 0
        ? `<span style="color:var(--text-dim)">0</span>`
        : r.totalSold.toLocaleString()
      },
      { key: 'severity', label: 'Priority', render: r => {
        const map = { high: ['danger','High'], medium: ['warning','Medium'], low: ['muted','Low'] };
        const [type, label] = map[r.severity] || ['muted', r.severity];
        return window.badge(label, type);
      }},
      { key: 'action', label: 'Suggested Action', render: r => {
        if (r.severity === 'high')   return `<span style="font-size:11px;color:var(--danger)">Consider discounting or returning to supplier</span>`;
        if (r.severity === 'medium') return `<span style="font-size:11px;color:var(--warning)">Review — possible slow mover or seasonal</span>`;
        return `<span style="font-size:11px;color:var(--text-muted)">Monitor for next period</span>`;
      }},
    ];

    window.buildTable(document.getElementById('ds-table'), {
      columns,
      rows: data.rows,
      emptyMessage: '🎉 No dead stock found in this period.'
    });
  },

  export() {
    window.exportCSV('dead-stock.csv', [
      { key: 'sku',       label: 'SKU' },
      { key: 'name',      label: 'Product Name' },
      { key: 'stock',     label: 'Units in Stock' },
      { key: 'totalSold', label: 'Units Sold (Period)' },
      { key: 'severity',  label: 'Priority' },
    ], this._results);
  }
};
