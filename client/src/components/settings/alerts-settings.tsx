'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, Field, Input, Switch, toast } from '@/components/ui';
import type { Me } from '@/contracts/auth';

/**
 * Settings › Alerts: where alerts go (the account email unless another is set) and mute all. Chat B's schedules
 * read these: a failed scheduled run, and the CSV a schedule sends.
 */
export function AlertSettings({ me, schedules }: { me: Me; schedules: { emailOnFail: number; emailCsv: number } }) {
  const router = useRouter();
  const [alertEmail, setAlertEmail] = useState(me.alertEmail ?? '');
  const [muted, setMuted] = useState(me.alertsMuted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: { alertEmail?: string | null; alertsMuted?: boolean }) => {
    setBusy(true);
    setError(null);
    const res = await api('/api/settings/profile', patch, { method: 'PATCH' });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.problems?.[0]?.message ?? res.error.message);
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <div className="set-cols">
      <div className="set-col">
        <section className="panel" aria-labelledby="h-where">
          <div className="panel-head">
            <h2 className="panel-title grow" id="h-where">
              Where alerts go
            </h2>
            <span className={muted ? 'chip is-warn' : 'chip is-on'}>{muted ? 'Muted' : 'On'}</span>
          </div>
          <Field label="Alert email" hint={`Leave it empty to use your account email, ${me.email}.`} error={error}>
            {({ id, invalid, describedBy }) => (
              <Input
                id={id}
                type="email"
                value={alertEmail}
                invalid={invalid}
                aria-describedby={describedBy}
                placeholder={me.email}
                onChange={(e) => setAlertEmail(e.target.value)}
              />
            )}
          </Field>
          <div className="row">
            <Button
              variant="primary"
              busy={busy}
              onClick={async () => {
                if (await save({ alertEmail: alertEmail.trim() || null })) toast.success('Saved.');
              }}
            >
              Save
            </Button>
          </div>
          <Switch
            checked={muted}
            onChange={async (next) => {
              setMuted(next);
              if (await save({ alertsMuted: next })) toast.success(next ? 'All alerts are muted.' : 'Alerts are on.');
              else setMuted(!next);
            }}
            label="Mute all alerts"
            text="Mute all alerts. Schedules keep running; nothing is emailed."
          />
        </section>
      </div>
      <div className="set-col">
        <section className="panel" aria-labelledby="h-what">
          <div className="panel-head">
            <h2 className="panel-title grow" id="h-what">
              What we send
            </h2>
          </div>
          <div className="krows">
            <div className="krow">
              <span className={schedules.emailOnFail && !muted ? 'led' : 'led is-off'} />
              <div className="grow">
                <div className="krow-title">A scheduled run fails</div>
                <p className="krow-sub">
                  On for {schedules.emailOnFail} schedule{schedules.emailOnFail === 1 ? '' : 's'}, with the reason in
                  plain words
                </p>
              </div>
            </div>
            <div className="krow">
              <span className={schedules.emailCsv && !muted ? 'led' : 'led is-off'} />
              <div className="grow">
                <div className="krow-title">A schedule’s CSV</div>
                <p className="krow-sub">
                  On for {schedules.emailCsv} schedule{schedules.emailCsv === 1 ? '' : 's'}, after each run
                </p>
              </div>
            </div>
          </div>
          <p className="hint">Turn these on or off for each schedule in Schedules.</p>
        </section>
      </div>
    </div>
  );
}
