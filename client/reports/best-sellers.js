// ─── client/reports/best-sellers.js ──────────────────────────────────────────

window.REPORTS['best-sellers'] = {
  title:       'Best & Worst Sellers',
  description: 'See which SKUs are driving your business and which are underperforming.',

  render(container) {
    container.innerHTML = `
      <div class="config-panel">
        <div class="panel-label">▸ Settings</div>
        <div class="fields-row">
          <div class="field">
            <label>Period (days)</label>
            <input type="number" id="bs-days" value="30" min="1" max="365" style="width:100px">
          </div>
          <div class="field">
            <label>Show top / bottom N</label>
            <input type="number" id="bs-limit" value="20" min="5" max="100" style="width:80px">
          </div>
          <div class="field">
            <label>View</label>
            <select id="bs-view" style="width:140px">
              <option value="top">Top Sellers</option>
              <option value="worst">Worst Sellers</option>
              <option value="all">All SKUs</option>
            </select>
          </div>
          <button class="run-btn" id="bs-btn" onclick="window.REPORTS['best-sellers'].run()">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Report
          </button>
        </div>
      </div>
      <div id="bs-results"></div>`;
    this._data = null;
  },

  async run() {
    if (!window.validateConfig()) return;
    const days  = parseInt(document.getElementById('bs-days').value);
    const limit = parseInt(document.getElementById('bs-limit').value);
    const btn   = document.getElementById('bs-btn');
    btn.disabled = true;

    const url = window.buildReportURL('best-sellers', { days, limit });

    try {
      const data = await window.fetchReportSSE(url, p => window.setStatus(p.message));
      this._data = data;
      this.renderResults(data);
      window.setStatus(`Done — ${data.meta.totalSkus} SKUs analysed.`, 'success');
    } catch(err) {
      window.setStatus(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  renderResults(data) {
    const el = document.getElementById('bs-results');
    el.innerHTML = window.buildStats([
      { label: 'Total Orders',  value: data.meta.totalOrders.toLocaleString() },
      { label: 'Total SKUs',    value: data.meta.totalSkus.toLocaleString()  },
      { label: 'Top SKU',       value: data.topSellers[0]?.sku || '—'        },
      { label: 'Top SKU Units', value: data.topSellers[0]?.totalSold.toLocaleString() || '—' },
    ]);

    el.innerHTML += `
      <div class="results-header">
        <div class="results-label" id="bs-label">▸ Top Sellers</div>
        <button class="export-btn" onclick="window.REPORTS['best-sellers'].export()">↓ Export CSV</button>
      </div>
      <div id="bs-table"></div>`;

    document.getElementById('bs-view').addEventListener('change', () => {
      if (this._data) this.renderTable(this._data);
    });

    this.renderTable(data);
  },

  renderTable(data) {
    const view  = document.getElementById('bs-view')?.value || 'top';
    const rows  = view === 'top' ? data.topSellers : view === 'worst' ? data.worstSellers : data.all;
    const label = view === 'top' ? 'Top Sellers' : view === 'worst' ? 'Worst Sellers' : 'All SKUs';
    const labelEl = document.getElementById('bs-label');
    if (labelEl) labelEl.textContent = `▸ ${label}`;

    const maxSold = Math.max(...rows.map(r => r.totalSold), 1);

    const columns = [
      { key: 'rank',       label: '#', render: r => `<span style="color:var(--text-muted);font-size:11px">${r.rank}</span>` },
      { key: 'sku',        label: 'SKU' },
      { key: 'name',       label: 'Product Name', render: r => `<span class="muted">${r.name || '—'}</span>` },
      { key: 'totalSold',  label: 'Units Sold', render: r => {
        const pct = (r.totalSold / maxSold) * 100;
        return `<div class="bar-wrap">
          <div class="bar"><div class="bar-fill" style="width:${pct}%;background:var(--accent)"></div></div>
          <span style="min-width:48px;text-align:right;font-weight:600">${r.totalSold.toLocaleString()}</span>
        </div>`;
      }},
      { key: 'orderCount', label: 'Orders',      align: 'right' },
      { key: 'activeDays', label: 'Active Days',  align: 'right' },
    ];

    window.buildTable(document.getElementById('bs-table'), { columns, rows, emptyMessage: 'No sales data found.' });
  },

  export() {
    if (!this._data) return;
    const view = document.getElementById('bs-view')?.value || 'top';
    const rows = view === 'top' ? this._data.topSellers : view === 'worst' ? this._data.worstSellers : this._data.all;
    window.exportCSV('best-sellers.csv', [
      { key: 'rank',       label: 'Rank' },
      { key: 'sku',        label: 'SKU' },
      { key: 'name',       label: 'Product Name' },
      { key: 'totalSold',  label: 'Units Sold' },
      { key: 'orderCount', label: 'Order Count' },
      { key: 'activeDays', label: 'Active Days' },
    ], rows);
  }
};
