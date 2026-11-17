import { Kpi } from '@/components/ui';
import type { UsageWeek } from '@/server/services/usage';

/**
 * Settings › Usage: this week's API requests, rows stored, credits used and AI tokens, from runs, saved rows
 * and the AI meter, with a row per day. The KPI tiles and the table are the app's own parts.
 */
const n = (v: number) => v.toLocaleString('en');

function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function UsageView({ usage }: { usage: UsageWeek }) {
  const { totals, days, ai } = usage;
  return (
    <>
      <div className="kpis">
        <Kpi label="Requests" value={n(totals.requests)} sub={`${n(totals.runs)} runs this week`} />
        <Kpi label="Rows stored" value={n(totals.rows)} sub="Added to your datasets" />
        <Kpi label="Credits used" value={n(totals.credits)} sub="Across every API" />
        <Kpi
          label="AI tokens"
          value={n(totals.aiTokens)}
          sub={`${n(totals.setups)} setups, ${n(ai.test)} for key tests`}
        />
      </div>
      <section className="panel" aria-labelledby="h-days">
        <div className="panel-head">
          <h2 className="panel-title grow" id="h-days">
            The last 7 days
          </h2>
          <span className="chip is-soft">Your time zone</span>
        </div>
        <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
          <table className="tbl num">
            <thead>
              <tr>
                <th>Day</th>
                <th style={{ textAlign: 'right' }}>Requests</th>
                <th style={{ textAlign: 'right' }}>Rows stored</th>
                <th style={{ textAlign: 'right' }}>Credits</th>
                <th style={{ textAlign: 'right' }}>AI tokens</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{dayLabel(d.date)}</td>
                  <td style={{ textAlign: 'right' }}>{n(d.requests)}</td>
                  <td style={{ textAlign: 'right' }}>{n(d.rows)}</td>
                  <td style={{ textAlign: 'right' }}>{n(d.credits)}</td>
                  <td style={{ textAlign: 'right' }}>{n(d.aiTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Your AI provider and each API bill you directly; these are the counts Dialed saw.</p>
      </section>
    </>
  );
}
