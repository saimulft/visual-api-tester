'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, Dialog, Field, Input, PasswordInput, SearchSelect, toast, type Option } from '@/components/ui';
import type { Me } from '@/contracts/auth';

/**
 * Settings › Account, from the same panels and fields as AI and keys: name and workspace with the time zone,
 * the email change (checked by a link), the password, signing out everywhere else, and deleting the account
 * with a typed confirm.
 */
function zones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

export function AccountSettings({
  me,
  counts,
}: {
  me: Me;
  counts: { projects: number; datasets: number; schedules: number };
}) {
  const router = useRouter();
  const [name, setName] = useState(me.name);
  const [workspace, setWorkspace] = useState(me.workspace);
  const [timezone, setTimezone] = useState(me.timezone);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileProblems, setProfileProblems] = useState<Record<string, string>>({});

  const [email, setEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [outBusy, setOutBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const zoneOptions: Option[] = useMemo(() => zones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), []);

  const saveProfile = async () => {
    setSavingProfile(true);
    const res = await api('/api/settings/profile', { name, workspace, timezone }, { method: 'PATCH' });
    setSavingProfile(false);
    if (!res.ok) {
      setProfileProblems(Object.fromEntries((res.error.problems ?? []).map((p) => [p.path, p.message])));
      return toast.error(res.error.message);
    }
    setProfileProblems({});
    toast.success('Saved.');
    router.refresh();
  };
  const changeEmail = async () => {
    setEmailBusy(true);
    setEmailError(null);
    const res = await api<{ sentTo: string }>('/api/auth/change-email', { email, password: emailPassword });
    setEmailBusy(false);
    if (!res.ok) return setEmailError(res.error.message);
    setEmailNote(`We sent a link to ${res.data.sentTo}. Your email changes when you open it.`);
    setEmail('');
    setEmailPassword('');
  };
  const changePassword = async () => {
    setPwBusy(true);
    setPwError(null);
    const res = await api('/api/auth/change-password', { current, password: next });
    setPwBusy(false);
    if (!res.ok) return setPwError(res.error.message);
    setCurrent('');
    setNext('');
    toast.success('Password changed. Other sessions are signed out.');
  };
  const signOutEverywhere = async () => {
    setOutBusy(true);
    const res = await api('/api/settings/sign-out-everywhere', {});
    setOutBusy(false);
    if (!res.ok) return toast.error(res.error.message);
    toast.success('Signed out everywhere else.');
  };
  const deleteAccount = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    const res = await api('/api/auth/delete-account', { password: deletePassword });
    if (!res.ok) {
      setDeleteBusy(false);
      return setDeleteError(res.error.message);
    }
    router.replace('/sign-up');
    router.refresh();
  };

  return (
    <div className="set-cols">
      <div className="set-col">
        <section className="panel" aria-labelledby="h-profile">
          <div className="panel-head">
            <h2 className="panel-title grow" id="h-profile">
              Your profile
            </h2>
          </div>
          <Field label="Name" error={profileProblems.name ?? null}>
            {({ id, invalid }) => (
              <Input
                id={id}
                value={name}
                invalid={invalid}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Workspace name" hint="Shown above every page title." error={profileProblems.workspace ?? null}>
            {({ id, invalid, describedBy }) => (
              <Input
                id={id}
                value={workspace}
                invalid={invalid}
                aria-describedby={describedBy}
                onChange={(e) => setWorkspace(e.target.value)}
              />
            )}
          </Field>
          <div className="field">
            <span className="label">Time zone</span>
            <SearchSelect
              options={zoneOptions}
              value={timezone}
              onChange={setTimezone}
              label="Time zone"
              searchPlaceholder="Search time zones"
            />
            <p className="hint">Schedules and logs use it.</p>
          </div>
          <div className="row">
            <Button variant="primary" onClick={saveProfile} busy={savingProfile}>
              Save
            </Button>
          </div>
        </section>

        <section className="panel" aria-labelledby="h-email">
          <div className="panel-head">
            <h2 className="panel-title grow" id="h-email">
              Email
            </h2>
            <span className={me.emailChecked ? 'chip is-on' : 'chip is-warn'}>
              {me.emailChecked ? 'Checked' : 'Not checked yet'}
            </span>
          </div>
          <p className="hint">
            You log in with <strong>{me.email}</strong>. A new email is checked with a link before it counts.
          </p>
          <Field label="New email" error={emailError}>
            {({ id, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                value={email}
                invalid={invalid}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Your password">
            {({ id }) => (
              <PasswordInput
                id={id}
                large={false}
                autoComplete="current-password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
              />
            )}
          </Field>
          {emailNote && (
            <div className="ok-line" role="status">
              {emailNote}
            </div>
          )}
          <div className="row">
            <Button onClick={changeEmail} busy={emailBusy} disabled={!email.trim() || !emailPassword}>
              Change email
            </Button>
          </div>
        </section>

        <section className="panel" aria-labelledby="h-password">
          <div className="panel-head">
            <h2 className="panel-title grow" id="h-password">
              Password
            </h2>
          </div>
          <Field label="Current password" error={pwError}>
            {({ id, invalid }) => (
              <PasswordInput
                id={id}
                large={false}
                invalid={invalid}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field label="New password">
            {({ id }) => (
              <PasswordInput
                id={id}
                large={false}
                meter
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </Field>
          <div className="row">
            <Button onClick={changePassword} busy={pwBusy} disabled={!current || next.length < 8}>
              Change password
            </Button>
          </div>
        </section>
      </div>

      <div className="set-col">
        <section className="panel" aria-labelledby="h-sessions">
          <div className="panel-head">
            <h2 className="panel-title grow" id="h-sessions">
              Signed in
            </h2>
          </div>
          <p className="hint">Signs you out on every other browser and device. You stay signed in here.</p>
          <div className="row">
            <Button onClick={signOutEverywhere} busy={outBusy}>
              Sign out everywhere else
            </Button>
          </div>
        </section>

        <section className="panel" aria-labelledby="h-delete">
          <div className="panel-head">
            <h2 className="panel-title grow" id="h-delete">
              Delete account
            </h2>
          </div>
          <p className="hint">
            Deletes everything: {counts.projects} project{counts.projects === 1 ? '' : 's'}, {counts.datasets} dataset
            {counts.datasets === 1 ? '' : 's'}, {counts.schedules} schedule{counts.schedules === 1 ? '' : 's'}, your
            saved keys and every MCP connection. It can’t be undone.
          </p>
          <div className="row">
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete account
            </Button>
          </div>
        </section>
      </div>

      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete your account?"
        description="Everything goes for good: projects, data, schedules, keys and connections."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              Keep my account
            </Button>
            <Button
              variant="danger"
              onClick={deleteAccount}
              busy={deleteBusy}
              disabled={typed.trim().toLowerCase() !== me.email || !deletePassword}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <Field label={`Type ${me.email} to confirm`}>
          {({ id }) => <Input id={id} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />}
        </Field>
        <Field label="Your password" error={deleteError}>
          {({ id, invalid }) => (
            <PasswordInput
              id={id}
              large={false}
              invalid={invalid}
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          )}
        </Field>
      </Dialog>
    </div>
  );
}
