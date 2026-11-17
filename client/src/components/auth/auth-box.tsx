import { Check } from 'lucide-react';
import { SparkleIcon } from './icons';

/**
 * The dark box beside the account forms, with the narrative mini-UI: a doc line becomes a fader, then data,
 * then Ready. It lives in the (auth) layout, so it plays once and keeps its final state while people move
 * between sign up, log in and the rest. Under reduced motion the final state shows at once.
 */
export function AuthBox() {
  return (
    <section className="auth-box on-dark" aria-label="How Dialed works">
      <div>
        <span className="micro">Open source · bring your own AI</span>
        <h2 style={{ marginTop: 14 }}>Your AI reads the docs. You get the dials.</h2>
        <p>
          Paste an API key and say what you need in plain words. Dialed turns the API into sliders, switches and lists
          you set by hand, then keeps the data.
        </p>
      </div>

      <div className="story">
        <div className="story-card">
          <span className="micro">From the docs</span>
          <p className="story-doc">
            <span className="k">employees_count_gte</span> integer{'\n'}Minimum number of employees.{'\n'}
            <span className="k">employees_count_lte</span> integer{'\n'}Maximum number of employees.
          </p>
        </div>
        <div className="story-card is-key">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="micro">Your control</span>
            <span className="chip is-ai" style={{ height: 24, fontSize: 12 }}>
              <SparkleIcon />
              Made by AI
            </span>
          </div>
          <div className="fader">
            <div className="fader-top">
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Employees</span>
              <output className="readout">50 to 200</output>
            </div>
            <div className="track is-static">
              <div className="zone">
                <div className="fill" style={{ left: '42.5%', width: '15%' }} />
              </div>
              <span className="knob" style={{ left: 'calc(11px + (100% - 22px) * 0.425)' }} />
              <span className="knob" style={{ left: 'calc(11px + (100% - 22px) * 0.575)' }} />
            </div>
            <div className="scale" />
            <div className="ticks">
              <span style={{ left: '0%' }}>1</span>
              <span style={{ left: '50%' }}>100</span>
              <span style={{ left: '100%' }}>10k</span>
            </div>
          </div>
        </div>
        <div className="story-card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="micro">Your data</span>
            <span className="readout" style={{ fontSize: 12 }}>
              3,412 found
            </span>
          </div>
          <div className="mini-rows">
            <div className="mini-row">
              <span className="co-tile">KL</span>
              <span>Kestrel Labs</span>
              <span className="num">142</span>
            </div>
            <div className="mini-row">
              <span className="co-tile">TA</span>
              <span>Tidepool Analytics</span>
              <span className="num">88</span>
            </div>
            <div className="mini-row">
              <span className="co-tile">IS</span>
              <span>Ironbark Systems</span>
              <span className="num">176</span>
            </div>
          </div>
          <span className="chip is-on ready-chip">
            <Check className="i" aria-hidden="true" />
            Ready
          </span>
        </div>
      </div>

      <div className="facts">
        <span>
          <Check className="i i-sm" aria-hidden="true" />
          Works with any API that has docs
        </span>
        <span>
          <Check className="i i-sm" aria-hidden="true" />
          Keys encrypted at rest
        </span>
        <span>
          <Check className="i i-sm" aria-hidden="true" />
          CSV, Excel or JSON
        </span>
      </div>
    </section>
  );
}
