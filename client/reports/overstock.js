// ─── client/reports/overstock.js ─────────────────────────────────────────────

window.REPORTS['overstock'] = {
  title:       'Overstock Report',
  description: 'Find SKUs where you\'re holding more stock than needed — free up cash and storage.',

  render(container) {
    container.innerHTML = `
      <div class="config-panel">
        <div class="panel-label">▸ Settings</div>
        <div class="fields-row">
          <div class="field">
            <label>Velocity Window (days)</label>
            <input type="number" id="os-days" value="30" min="1" max="365" style="width:100px">
          </div>
          <div class="field">
            <label>Target Coverage (days)</label>
            <input type="number" id="os-coverage" value="60" min="1" max="365" style="width:100px">
          </div>
          <div class="field">
            <label>Flag if excess ≥ (%)</label>
            <input type="number" id="os-pct" value="50" min="1" max="1000" style="width:80px">
          </div>
          <button class="run-btn" id="os-btn" onclick="window.REPORTS['overstock'].run()">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Report
          </button>
        </div>
      </div>
      <div id="os-results"></div>`;
    this._results = [];
  },

  async run() {
    if (!window.validateConfig()) return;
    const days        = parseInt(document.getElementById('os-days').value);
    const coverageDays = parseInt(document.getElementById('os-coverage').value);
    const overstockPct = parseInt(document.getElementById('os-pct').value);
    const btn         = document.getElementById('os-btn');
    btn.disabled      = true;

    const url = window.buildReportURL('overstock', { days, coverageDays, overstockPct });

    try {
      const data = await window.fetchReportSSE(url, p => window.setStatus(p.message));
      this._results = data.rows;
      this.renderResults(data);
      window.setStatus(`Done — ${data.rows.length} overstocked SKUs found.`, 'success');
    } catch(err) {
      window.setStatus(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  renderResults(data) {
    const totalExcess = data.rows.reduce((s, r) => s + Math.max(0, r.excessUnits), 0);
    const maxExcess   = data.rows[0]?.excessPct || 0;

    const el = document.getElementById('os-results');
    el.innerHTML = window.buildStats([
      { label: 'Overstocked SKUs',    value: data.rows.length,            color: data.rows.length > 0 ? 'warning' : 'success' },
      { label: 'Total Excess Units',   value: totalExcess.toLocaleString(), color: totalExcess > 0 ? 'warning' : '' },
      { label: 'Highest Excess',       value: maxExcess !== null ? maxExcess + '%' : 'N/A', color: maxExcess > 200 ? 'danger' : '' },
    ]);

    el.innerHTML += `
      <div class="results-header">
        <div class="results-label">▸ Overstocked SKUs</div>
        <button class="export-btn" onclick="window.REPORTS['overstock'].export()">↓ Export CSV</button>
      </div>
      <div id="os-table"></div>`;

    const columns = [
      { key: 'sku',         label: 'SKU' },
      { key: 'name',        label: 'Product Name', render: r => `<span class="muted">${r.name || '—'}</span>` },
      { key: 'stock',       label: 'Current Stock',  align: 'right', render: r => r.stock.toLocaleString() },
      { key: 'targetStock', label: 'Target Stock',   align: 'right', render: r => r.targetStock.toLocaleString() },
      { key: 'excessUnits', label: 'Excess Units',   align: 'right', render: r => `<span class="bold" style="color:var(--warning)">${r.excessUnits.toLocaleString()}</span>` },
      { key: 'excessPct',   label: 'Excess %',       align: 'right', render: r =>
        r.excessPct === null
          ? `<span style="color:var(--danger)">∞ (no sales)</span>`
          : `<span style="color:${r.excessPct > 200 ? 'var(--danger)' : 'var(--warning)'}">${r.excessPct}%</span>`
      },
      { key: 'daysCover',   label: 'Days of Cover',  align: 'right', render: r =>
        r.daysCover === null
          ? `<span style="color:var(--text-dim)">∞</span>`
          : `${r.daysCover}d`
      },
      { key: 'dailyVel',    label: 'Daily Velocity', align: 'right' },
    ];

    window.buildTable(document.getElementById('os-table'), {
      columns, rows: data.rows,
      emptyMessage: '✅ No significant overstocking detected.'
    });
  },

  export() {
    window.exportCSV('overstock.csv', [
      { key: 'sku',         label: 'SKU' },
      { key: 'name',        label: 'Product Name' },
      { key: 'stock',       label: 'Current Stock' },
      { key: 'targetStock', label: 'Target Stock' },
      { key: 'excessUnits', label: 'Excess Units' },
      { key: 'excessPct',   label: 'Excess %',    csvValue: r => r.excessPct ?? 'N/A' },
      { key: 'daysCover',   label: 'Days of Cover', csvValue: r => r.daysCover ?? 'N/A' },
      { key: 'dailyVel',    label: 'Daily Velocity' },
    ], this._results);
  }
};
