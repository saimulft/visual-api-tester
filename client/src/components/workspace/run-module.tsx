'use client';

import NumberFlow from '@number-flow/react';
import { Play } from 'lucide-react';
import { allControls, type ApiSpec, type Values } from '@/contracts/spec';
import type { RunPreviewDetail } from '@/contracts/workspace';

/**
 * The dark Run module: the live match count (Number Flow, free searches only), the take line, the cost
 * line (costShort on a phone) and Run with its running state.
 */
export function RunModule({
  spec,
  values,
  preview,
  countFailed = false,
  running,
  onRun,
}: {
  spec: ApiSpec;
  values: Values;
  preview: RunPreviewDetail | null;
  /** The last live count was refused: say so instead of "Counting". */
  countFailed?: boolean;
  running: boolean;
  onRun: () => void;
}) {
  const collect = spec.run.mode === 'searchThenCollect';
  const takeControl = allControls(spec).find((c) => c.id === spec.run.takeControlId);
  const wanted = takeControl && typeof values[takeControl.id] === 'number' ? (values[takeControl.id] as number) : null;
  const take = preview?.take ?? wanted ?? 0;
  // Until the first preview lands, the cost comes from the spec: take times what a record costs.
  const paid = spec.endpoints.find(
    (e) => e.id === (spec.run.mode === 'searchThenCollect' ? spec.run.collectId : spec.run.endpointId),
  );
  const unit = preview?.unit ?? paid?.cost.unit ?? 'credits';
  const credits = preview?.credits ?? (paid && !paid.free ? take * (paid.cost.perRecord + paid.cost.perCall) : 0);
  const fmt = (n: number) => n.toLocaleString('en-US');

  const takeLine = collect
    ? `${fmt(take)} records`
    : takeControl
      ? `${fmt(take)} ${takeControl.unit ?? 'records'}`
      : preview?.matches != null
        ? `${fmt(preview.matches)} records`
        : 'Every record';
  const costLine =
    credits === 0
      ? 'Free'
      : preview?.creditsLeft != null
        ? `${fmt(credits)} of ${fmt(preview.creditsLeft)} ${unit}`
        : `${fmt(credits)} ${unit}`;
  const costShort = credits === 0 ? 'free' : `${fmt(credits)} ${unit}`;
  const free = preview ? preview.matches !== null : false;

  return (
    <div className="run on-dark">
      <div className="run-sum">
        <div className="run-line">
          <span className="micro">{collect ? 'Search' : 'Matches'}</span>
          <strong className="num">
            {preview?.matches != null ? (
              <>
                <NumberFlow value={preview.matches} format={{ useGrouping: true }} /> matches
              </>
            ) : preview?.needsKey ? (
              'Add a key'
            ) : preview || countFailed ? (
              'No live count'
            ) : (
              'Counting'
            )}
          </strong>
          {free && <span className="run-free">FREE</span>}
        </div>
        <div className="run-line">
          <span className="micro">{collect ? 'Collect' : 'Take'}</span>
          <strong className="num">{takeLine}</strong>
          <span className="num hide-phone">{costLine}</span>
          <span className="num only-phone">{costShort}</span>
        </div>
      </div>
      <button
        className="btn btn-primary btn-run has-tile"
        type="button"
        onClick={onRun}
        disabled={running}
        aria-busy={running || undefined}
        aria-keyshortcuts="Meta+Enter Control+Enter"
      >
        <span className="tile">
          {running ? <span className="spin" aria-hidden="true" /> : <Play className="i i-fill" aria-hidden="true" />}
        </span>
        {running ? 'Running' : 'Run'}
      </button>
    </div>
  );
}
