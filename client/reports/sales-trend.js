// ─── client/reports/sales-trend.js ───────────────────────────────────────────

window.REPORTS['sales-trend'] = {
  title:       'Sales Trend Report',
  description: 'Compare recent sales vs the prior period to spot growing SKUs, declining lines, and sudden changes.',

  render(container) {
    container.innerHTML = `
      <div class="config-panel">
        <div class="panel-label">▸ Settings</div>
        <div class="fields-row">
          <div class="field">
            <label>Period to compare (days)</label>
            <input type="number" id="st-days" value="30" min="7" max="180" style="width:110px">
            <span style="font-size:10px;font-family:var(--mono);color:var(--text-muted);margin-top:2px">vs prior same period</span>
          </div>
          <div class="field">
            <label>Filter by trend</label>
            <select id="st-filter" style="width:140px" onchange="window.REPORTS['sales-trend'].filter()">
              <option value="all">All SKUs</option>
              <option value="growing">Growing</option>
              <option value="declining">Declining</option>
              <option value="new">New</option>
              <option value="stopped">Stopped</option>
              <option value="stable">Stable</option>
            </select>
          </div>
          <button class="run-btn" id="st-btn" onclick="window.REPORTS['sales-trend'].run()">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Report
          </button>
        </div>
      </div>
      <div id="st-results"></div>`;
    this._results = [];
    this._reportMeta = null;
  },

  async run() {
    if (!window.validateConfig()) return;
    const days = parseInt(document.getElementById('st-days').value);
    const btn  = document.getElementById('st-btn');
    btn.disabled = true;

    // Sales trend needs double the window — pass days, server handles both periods
    const url = window.buildReportURL('sales-trend', { days });

    try {
      const data = await window.fetchReportSSE(url, p => window.setStatus(p.message));
      this._results = data.rows;
      this._reportMeta = data.meta;
      this.renderResults(data);
      window.setStatus(`Done — ${data.rows.length} SKUs compared.`, 'success');
    } catch(err) {
      window.setStatus(`Error: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  filter() { if (this._results.length) this.renderTable(this._results); },

  renderResults(data) {
    const el = document.getElementById('st-results');
    el.innerHTML = window.buildStats([
      { label: 'Growing SKUs',   value: data.meta.growing,   color: 'success' },
      { label: 'Declining SKUs', value: data.meta.declining, color: data.meta.declining > 0 ? 'danger' : '' },
      { label: 'New SKUs',       value: data.meta.new,       color: data.meta.new > 0 ? 'accent' : '' },
      { label: 'Total SKUs',     value: data.meta.totalSkus  },
    ]);

    el.innerHTML += `
      <div class="results-header">
        <div>
          <div class="results-label">▸ Trend Comparison</div>
          <div class="results-meta" style="margin-top:4px">
            Recent: <strong>${data.meta.recentPeriod}</strong> &nbsp;vs&nbsp; Prior: <strong>${data.meta.priorPeriod}</strong>
          </div>
        </div>
        <button class="export-btn" onclick="window.REPORTS['sales-trend'].export()">↓ Export CSV</button>
      </div>
      <div id="st-table"></div>`;

    this.renderTable(data.rows);
  },

  renderTable(rows) {
    const filter   = document.getElementById('st-filter')?.value || 'all';
    const filtered = filter === 'all' ? rows : rows.filter(r => r.trend === filter);

    const trendBadge = (trend) => {
      const map = {
        growing:  ['success',  '↑ Growing'],
        declining:['danger',   '↓ Declining'],
        new:      ['accent',   '★ New'],
        stopped:  ['warning',  '⊘ Stopped'],
        stable:   ['muted',    '→ Stable'],
      };
      const [type, label] = map[trend] || ['muted', trend];
      return window.badge(label, type);
    };

    const columns = [
      { key: 'sku',         label: 'SKU' },
      { key: 'name',        label: 'Product Name', render: r => `<span class="muted">${r.name || '—'}</span>` },
      { key: 'recentUnits', label: 'Recent Units',  align: 'right', render: r => `<span style="font-weight:600">${r.recentUnits.toLocaleString()}</span>` },
      { key: 'priorUnits',  label: 'Prior Units',   align: 'right', render: r => r.priorUnits.toLocaleString() },
      { key: 'changePct',   label: 'Change',        align: 'right', render: r => {
        if (r.changePct === null) return `<span style="color:var(--text-dim)">—</span>`;
        const color = r.changePct > 0 ? 'var(--success)' : r.changePct < 0 ? 'var(--danger)' : 'var(--text-muted)';
        const sign  = r.changePct > 0 ? '+' : '';
        return `<span style="color:${color};font-weight:600">${sign}${r.changePct}%</span>`;
      }},
      { key: 'trend', label: 'Trend', render: r => trendBadge(r.trend) },
    ];

    window.buildTable(document.getElementById('st-table'), {
      columns, rows: filtered, emptyMessage: 'No SKUs match this filter.'
    });
  },

  export() {
    window.exportCSV('sales-trend.csv', [
      { key: 'sku',         label: 'SKU' },
      { key: 'name',        label: 'Product Name' },
      { key: 'recentUnits', label: 'Recent Units' },
      { key: 'priorUnits',  label: 'Prior Units' },
      { key: 'changePct',   label: 'Change %', csvValue: r => r.changePct ?? 'N/A' },
      { key: 'trend',       label: 'Trend' },
    ], this._results);
  }
};
