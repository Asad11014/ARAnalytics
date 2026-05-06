// ─── client/reports/shared.js ────────────────────────────────────────────────
// Utilities shared across all report UI modules.
// Exposes: window.REPORTS registry, SSE streaming, table builder, CSV export.

window.REPORTS = {};

// ── SSE fetch — streams progress and resolves with final data ────────────────
window.fetchReportSSE = (url, onProgress) => {
  return new Promise((resolve, reject) => {
    fetch(url).then(res => {
      if (!res.ok) { reject(new Error(`HTTP ${res.status}`)); return; }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg.type === 'progress') { onProgress(msg); }
              else if (msg.type === 'done')  { resolve(msg);  return; }
              else if (msg.type === 'error') { reject(new Error(msg.message)); return; }
            } catch(e) {}
          }
          read();
        }).catch(reject);
      }
      read();
    }).catch(reject);
  });
};

// ── Build URL for a report with current config ────────────────────────────────
window.buildReportURL = (reportId, extraParams = {}) => {
  const { warehouseId, clientId } = window.getConfig();
  const days  = 30; // default, overridden per-report
  const today = new Date();
  const from  = new Date(today); from.setDate(today.getDate() - (extraParams.days || days));
  const fmt   = d => d.toISOString().split('T')[0];

  const params = new URLSearchParams({
    warehouseId,
    clientId:  clientId || '',
    dateFrom:  fmt(from),
    dateTo:    fmt(today),
    ...extraParams
  });
  return `/api/report/${reportId}?${params}`;
};

// ── Simple sortable table builder ─────────────────────────────────────────────
window.buildTable = (container, { columns, rows, emptyMessage = 'No data found.' }) => {
  if (!rows.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div>${emptyMessage}</div>`;
    return;
  }

  let sortKey = null, sortDir = 1;

  const render = () => {
    const sorted = [...rows].sort((a, b) => {
      if (!sortKey) return 0;
      const av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });

    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${columns.map(c => `
              <th class="${c.key === sortKey ? 'sorted' : ''} ${c.align === 'right' ? '' : ''}"
                  onclick="handleSort('${c.key}')"
                  style="${c.align === 'right' ? 'text-align:right' : ''}">
                ${c.label}
                <span class="sort-icon" style="opacity:${c.key === sortKey ? 1 : 0.4}">
                  ${c.key === sortKey ? (sortDir > 0 ? '↑' : '↓') : '↕'}
                </span>
              </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${sorted.map(row => `<tr>${columns.map(c => {
              const val = c.render ? c.render(row) : (row[c.key] ?? '—');
              return `<td style="${c.align === 'right' ? 'text-align:right' : ''}">${val}</td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    container._handleSort = (key) => {
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
      render();
    };
  };

  window.handleSort = (key) => container._handleSort?.(key);
  render();
};

// ── CSV export ────────────────────────────────────────────────────────────────
window.exportCSV = (filename, columns, rows) => {
  const headers = columns.map(c => `"${c.label}"`).join(',');
  const body    = rows.map(row =>
    columns.map(c => {
      const v = c.csvValue ? c.csvValue(row) : (row[c.key] ?? '');
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');

  const blob = new Blob([headers + '\n' + body], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
};

// ── Stats row builder ─────────────────────────────────────────────────────────
window.buildStats = (stats) => {
  return `<div class="stats-row">${stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value ${s.color || ''}">${s.value}</div>
    </div>`).join('')}
  </div>`;
};

// ── Badge helpers ─────────────────────────────────────────────────────────────
window.badge = (label, type = 'muted') => `<span class="badge badge-${type}"><span class="dot"></span>${label}</span>`;
