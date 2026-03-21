import type {
  GeminiAnalyticsCounters,
  GeminiAnalyticsDay,
  GeminiAnalyticsEvent,
  GeminiAnalyticsOverview
} from './geminiAnalyticsStore.js';

export function renderGeminiBackofficeHtml(overview: GeminiAnalyticsOverview): string {
  const today = overview.today;
  const actorRows = Object.entries(today.actors)
    .sort((left, right) => compareCounters(right[1], left[1]))
    .slice(0, 12);
  const modelRows = Object.entries(today.models)
    .sort((left, right) => compareCounters(right[1], left[1]))
    .slice(0, 12);
  const recentEvents = overview.recentDays
    .flatMap((day) => day.recentRequests)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 40);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gemini Usage Backoffice</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --panel: #fffdf7;
        --ink: #1f2937;
        --muted: #6b7280;
        --line: #d6d0c4;
        --accent: #0f766e;
        --warn: #b45309;
        --error: #b91c1c;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #faf7f2 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        max-width: 1200px;
        margin: 0 auto;
        padding: 24px;
      }
      h1, h2 { margin: 0 0 12px; }
      p { margin: 0; color: var(--muted); }
      .header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-end;
        margin-bottom: 24px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
        margin-bottom: 20px;
      }
      .card, .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px 18px;
        box-shadow: 0 12px 30px rgba(31, 41, 55, 0.06);
      }
      .metric {
        font-size: 30px;
        font-weight: 700;
        margin-top: 8px;
      }
      .metric.warn { color: var(--warn); }
      .metric.error { color: var(--error); }
      .two-col {
        display: grid;
        grid-template-columns: 1.1fr 1fr;
        gap: 16px;
        margin-bottom: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th, td {
        text-align: left;
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      .pill {
        display: inline-block;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 12px;
        background: rgba(15, 118, 110, 0.09);
        color: var(--accent);
      }
      .blocked {
        color: var(--error);
        font-weight: 700;
      }
      @media (max-width: 900px) {
        .two-col { grid-template-columns: 1fr; }
        .header { flex-direction: column; align-items: flex-start; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="header">
        <div>
          <h1>Gemini Usage Backoffice</h1>
          <p>Server-side daily accounting and hard-limit monitoring for proxied Gemini requests.</p>
        </div>
        <span class="pill">Today: ${escapeHtml(today.day)}</span>
      </div>

      <section class="grid">
        ${renderMetricCard('Today calls', formatNumber(today.totals.calls), `${formatNumber(overview.limits.dailyMaxCalls)} max/day`, ratioClass(today.totals.calls, overview.limits.dailyMaxCalls))}
        ${renderMetricCard('Today tokens', formatNumber(today.totals.totalTokens), `${formatNumber(overview.limits.dailyMaxTotalTokens)} max/day`, ratioClass(today.totals.totalTokens, overview.limits.dailyMaxTotalTokens))}
        ${renderMetricCard('Input tokens', formatNumber(today.totals.inputTokens), 'Prompt-side usage', '')}
        ${renderMetricCard('Output tokens', formatNumber(today.totals.outputTokens), 'Response-side usage', '')}
        ${renderMetricCard('Blocked', formatNumber(today.totals.blockedRequests), 'Requests blocked by hard limits', today.totals.blockedRequests > 0 ? 'error' : '')}
        ${renderMetricCard('Errors', formatNumber(today.totals.errorCalls), 'Gemini calls with status >= 400', today.totals.errorCalls > 0 ? 'warn' : '')}
      </section>

      <section class="two-col">
        <div class="panel">
          <h2>Recent Days</h2>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Calls</th>
                <th>Tokens</th>
                <th>Blocked</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              ${overview.recentDays.map((day) => `
                <tr>
                  <td>${escapeHtml(day.day)}</td>
                  <td>${formatNumber(day.totals.calls)}</td>
                  <td>${formatNumber(day.totals.totalTokens)}</td>
                  <td>${formatNumber(day.totals.blockedRequests)}</td>
                  <td>${formatNumber(day.totals.errorCalls)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h2>Top Actors Today</h2>
          <table>
            <thead>
              <tr>
                <th>Actor</th>
                <th>Calls</th>
                <th>Tokens</th>
                <th>Blocked</th>
              </tr>
            </thead>
            <tbody>
              ${actorRows.length > 0 ? actorRows.map(([actor, counters]) => `
                <tr>
                  <td>${escapeHtml(actor)}</td>
                  <td>${formatNumber(counters.calls)}</td>
                  <td>${formatNumber(counters.totalTokens)}</td>
                  <td>${formatNumber(counters.blockedRequests)}</td>
                </tr>
              `).join('') : '<tr><td colspan="4">No Gemini usage recorded today.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="two-col">
        <div class="panel">
          <h2>Top Models Today</h2>
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Calls</th>
                <th>Tokens</th>
                <th>Blocked</th>
              </tr>
            </thead>
            <tbody>
              ${modelRows.length > 0 ? modelRows.map(([model, counters]) => `
                <tr>
                  <td class="mono">${escapeHtml(model)}</td>
                  <td>${formatNumber(counters.calls)}</td>
                  <td>${formatNumber(counters.totalTokens)}</td>
                  <td>${formatNumber(counters.blockedRequests)}</td>
                </tr>
              `).join('') : '<tr><td colspan="4">No Gemini usage recorded today.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h2>Recent Requests</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Model</th>
                <th>Kind</th>
                <th>Tokens</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${recentEvents.length > 0 ? recentEvents.map((event) => renderRecentRequestRow(event)).join('') : '<tr><td colspan="6">No Gemini usage recorded yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderMetricCard(label: string, value: string, detail: string, extraClass: string): string {
  return `<div class="card">
    <div>${escapeHtml(label)}</div>
    <div class="metric${extraClass ? ` ${extraClass}` : ''}">${escapeHtml(value)}</div>
    <p>${escapeHtml(detail)}</p>
  </div>`;
}

function renderRecentRequestRow(event: GeminiAnalyticsEvent): string {
  return `<tr>
    <td class="mono">${escapeHtml(event.timestamp.replace('T', ' ').replace('Z', ''))}</td>
    <td>${escapeHtml(event.actor)}</td>
    <td class="mono">${escapeHtml(event.model)}</td>
    <td>${escapeHtml(event.requestKind)}</td>
    <td>${escapeHtml(formatNumber(event.totalTokens))}</td>
    <td>${event.blocked ? '<span class="blocked">Blocked</span>' : escapeHtml(String(event.status))}</td>
  </tr>`;
}

function compareCounters(left: GeminiAnalyticsCounters, right: GeminiAnalyticsCounters): number {
  return (
    left.totalTokens - right.totalTokens ||
    left.calls - right.calls ||
    left.blockedRequests - right.blockedRequests
  );
}

function ratioClass(value: number, limit: number): string {
  if (limit <= 0) {
    return '';
  }
  const ratio = value / limit;
  if (ratio >= 1) {
    return 'error';
  }
  if (ratio >= 0.8) {
    return 'warn';
  }
  return '';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
