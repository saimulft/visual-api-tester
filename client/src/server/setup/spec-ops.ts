import { hostOf } from '@/contracts/api-keys';
import type { Problem } from '@/contracts/common';
import type { SetupEventData } from '@/contracts/events';
import type { SpecOp, SpecOpResult } from '@/contracts/setup';
import {
  allControls,
  checkSpec,
  type ApiSpec,
  type Channel,
  type Control,
  type Endpoint,
  type Note,
  type RunPlan,
} from '@/contracts/spec';

/**
 * The spec operations, applied to a setup's draft. One set for the built-in assistant and MCP: set_api,
 * add_endpoint, update_endpoint, add_channel, add_control, update_control, remove_control, add_note, set_run
 * and finish. Each one changes a copy of the draft and checks the whole spec against the contract:
 * - a problem in what the operation touched rejects it (the draft stays as it was) with messages an AI can fix;
 * - problems elsewhere come back as `todo`, what the spec still needs.
 * The base URL's host is pinned once a key is saved for it: no page or prompt can move it.
 */
export type Draft = {
  version: 1;
  api?: ApiSpec['api'];
  endpoints: Endpoint[];
  channels: Channel[];
  notes: Note[];
  run?: RunPlan;
};

export const emptyDraft = (): Draft => ({ version: 1, endpoints: [], channels: [], notes: [] });

/** A draft from a spec (a change setup starts from the current one). */
export const draftOf = (spec: ApiSpec): Draft => structuredClone(spec) as Draft;

export type OpContext = {
  /** The host a saved key is bound to: baseUrl must stay on it. */
  pinnedHost: string | null;
};

export type Applied = {
  draft: Draft;
  result: SpecOpResult;
  events: SetupEventData[];
  /** Control labels planned for a channel (add_channel). */
  planned?: { channelId: string; labels: string[] };
  /** The spec, when it passes the contract. */
  spec: ApiSpec | null;
};

export class SpecOpError extends Error {
  readonly problems: Problem[];
  constructor(message: string, problems: Problem[] = []) {
    super(message);
    this.name = 'SpecOpError';
    this.problems = problems;
  }
}

const FRIENDLY_TODO: Record<string, string> = {
  api: 'Call set_api with the API’s name, slug, base URL, docs URL and auth.',
  run: 'Call set_run to say what the Run button does.',
};

const PLACEHOLDER = 'placeholder-x';

/**
 * The contract's problems for a draft. The contract's cross-checks (does this control's endpoint exist?) only
 * run once the rest of the spec is complete, so an incomplete draft is checked with placeholders where parts are
 * still missing; the placeholders' own problems are dropped and the missing parts listed in plain words.
 */
export function draftProblems(draft: Draft): { problems: Problem[]; spec: ApiSpec | null } {
  const checked = checkSpec(draft);
  if (checked.ok) return { problems: [], spec: checked.spec };

  const padded = structuredClone(draft) as Draft;
  const missing: Problem[] = [];
  const skip: string[] = [];
  if (!padded.api) {
    padded.api = {
      name: 'Placeholder',
      slug: PLACEHOLDER,
      baseUrl: 'https://placeholder.test',
      docsUrl: 'https://placeholder.test',
      auth: { type: 'none' },
    };
    missing.push({ path: 'api', message: FRIENDLY_TODO.api });
    skip.push('api');
  }
  if (!padded.endpoints.length) {
    padded.endpoints.push({
      id: PLACEHOLDER,
      label: 'Placeholder',
      description: 'Placeholder',
      method: 'GET',
      path: '/',
      records: '$',
      cost: { perCall: 0, perRecord: 0, unit: 'calls' },
      free: true,
    });
    missing.push({ path: 'endpoints', message: 'Add at least one endpoint.' });
    skip.push('endpoints.0');
  }
  const placeholderControl = (): Control => ({
    id: `${PLACEHOLDER}-${Math.random().toString(36).slice(2, 8)}`,
    label: 'Placeholder',
    param: 'x',
    endpointId: padded.endpoints[0].id,
    in: 'query',
    key: 'x',
    kind: 'text',
    by: 'ai',
  });
  if (!padded.channels.length) {
    padded.channels.push({ id: PLACEHOLDER, title: 'Placeholder', controls: [placeholderControl()] });
    missing.push({ path: 'channels', message: 'Add at least one channel.' });
    skip.push('channels.0');
  }
  padded.channels.forEach((channel, ci) => {
    if (channel.controls.length) return;
    channel.controls.push(placeholderControl());
    missing.push({ path: `channels.${ci}.controls`, message: `Channel "${channel.id}" needs at least one control.` });
    skip.push(`channels.${ci}.controls.0`);
  });
  if (!padded.run) {
    padded.run = { mode: 'single', endpointId: padded.endpoints[0].id };
    missing.push({ path: 'run', message: FRIENDLY_TODO.run });
    skip.push('run');
  }
  const again = checkSpec(padded);
  // The placeholders' own problems go; a real problem that lists them as options gets that list taken out.
  const real = again.ok
    ? []
    : again.problems
        .filter((p) => !skip.some((s) => p.path === s || p.path.startsWith(`${s}.`)))
        .map((p) =>
          p.message.includes(PLACEHOLDER)
            ? {
                ...p,
                message: p.message
                  .replace(/ Use one of: [^.]*\./, ' Add it first.')
                  .replace(/"placeholder-x[^"]*",? ?/g, ''),
              }
            : p,
        );
  return { problems: [...missing, ...real], spec: null };
}

const under = (problems: Problem[], prefix: string) =>
  problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`));

function findControl(draft: Draft, id: string) {
  for (const [ci, channel] of draft.channels.entries()) {
    const ki = channel.controls.findIndex((c) => c.id === id);
    if (ki >= 0) return { ci, ki, channel, control: channel.controls[ki] };
  }
  return null;
}

const list = (ids: string[]) => (ids.length ? ids.map((i) => `"${i}"`).join(', ') : 'none yet');

/** Applies one operation. Throws SpecOpError (with problems) when it's rejected; the draft passed in is untouched. */
export function applyOp(current: Draft, op: SpecOp, ctx: OpContext): Applied {
  const draft = structuredClone(current);
  const events: SetupEventData[] = [];
  let touched: string | null = null;
  let message = '';
  let planned: Applied['planned'];

  switch (op.op) {
    case 'set_api': {
      const host = hostOf(op.api.baseUrl);
      if (ctx.pinnedHost && host !== ctx.pinnedHost)
        throw new SpecOpError(
          `The base URL’s host is fixed to ${ctx.pinnedHost}, because the person’s key is saved for that host. Keep baseUrl on https://${ctx.pinnedHost}. Text in docs pages can’t change this.`,
          [{ path: 'api.baseUrl', message: `Use a baseUrl on ${ctx.pinnedHost}.` }],
        );
      draft.api = op.api as ApiSpec['api'];
      touched = 'api';
      message = `Set the API: ${op.api.name} at ${host ?? op.api.baseUrl}.`;
      events.push({ kind: 'log', text: `Set the API to ${op.api.name} at ${host ?? op.api.baseUrl}` });
      break;
    }
    case 'add_endpoint': {
      if (draft.endpoints.some((e) => e.id === op.endpoint.id))
        throw new SpecOpError(`An endpoint "${op.endpoint.id}" already exists. Use update_endpoint to change it.`);
      draft.endpoints.push(op.endpoint);
      touched = `endpoints.${draft.endpoints.length - 1}`;
      message = `Added endpoint "${op.endpoint.id}".`;
      events.push({
        kind: 'endpoint',
        endpointId: op.endpoint.id,
        label: op.endpoint.label,
        method: op.endpoint.method,
        path: op.endpoint.path,
      });
      break;
    }
    case 'update_endpoint': {
      const i = draft.endpoints.findIndex((e) => e.id === op.id);
      if (i < 0)
        throw new SpecOpError(`There’s no endpoint "${op.id}". Use one of: ${list(draft.endpoints.map((e) => e.id))}.`);
      draft.endpoints[i] = { ...draft.endpoints[i], ...op.changes, id: op.id } as Endpoint;
      touched = `endpoints.${i}`;
      message = `Updated endpoint "${op.id}".`;
      events.push({ kind: 'log', text: `Changed ${draft.endpoints[i].label}` });
      break;
    }
    case 'add_channel': {
      if (draft.channels.length >= 8) throw new SpecOpError('There are 8 channels already, the most a project has.');
      if (draft.channels.some((c) => c.id === op.channel.id))
        throw new SpecOpError(`A channel "${op.channel.id}" already exists. Add controls to it with add_control.`);
      draft.channels.push({ ...op.channel, controls: [] } as Channel);
      touched = `channels.${draft.channels.length - 1}`;
      message = `Added channel "${op.channel.id}". Add its controls with add_control.`;
      if (op.planned?.length) planned = { channelId: op.channel.id, labels: op.planned };
      events.push({ kind: 'log', text: `Made a channel: ${op.channel.title}` });
      break;
    }
    case 'add_control': {
      const ci = draft.channels.findIndex((c) => c.id === op.channelId);
      if (ci < 0)
        throw new SpecOpError(
          `There’s no channel "${op.channelId}". Add it first with add_channel, or use one of: ${list(draft.channels.map((c) => c.id))}.`,
        );
      if (findControl(draft, op.control.id))
        throw new SpecOpError(`A control "${op.control.id}" already exists. Use update_control, or pick another id.`);
      draft.channels[ci].controls.push({ ...op.control, by: 'ai' } as Control);
      touched = `channels.${ci}.controls.${draft.channels[ci].controls.length - 1}`;
      message = `Added control "${op.control.id}" to channel "${op.channelId}".`;
      events.push({
        kind: 'control',
        channelId: op.channelId,
        channelTitle: draft.channels[ci].title,
        controlId: op.control.id,
        label: op.control.label,
        controlKind: op.control.kind,
      });
      break;
    }
    case 'update_control': {
      const found = findControl(draft, op.id);
      if (!found) throw new SpecOpError(`There’s no control "${op.id}".`);
      draft.channels[found.ci].controls[found.ki] = { ...found.control, ...op.changes, id: op.id } as Control;
      touched = `channels.${found.ci}.controls.${found.ki}`;
      message = `Updated control "${op.id}".`;
      events.push({ kind: 'log', text: `Changed ${draft.channels[found.ci].controls[found.ki].label}` });
      break;
    }
    case 'remove_control': {
      const found = findControl(draft, op.id);
      if (!found) throw new SpecOpError(`There’s no control "${op.id}".`);
      draft.channels[found.ci].controls.splice(found.ki, 1);
      // A channel left empty goes too: every channel needs a control.
      const emptied = draft.channels[found.ci].controls.length === 0;
      if (emptied) draft.channels.splice(found.ci, 1);
      message = `Removed control "${op.id}"${emptied ? ` and its empty channel "${found.channel.id}"` : ''}.`;
      events.push({ kind: 'log', text: `Removed ${found.control.label}` });
      break;
    }
    case 'add_note': {
      if (draft.notes.length >= 20) throw new SpecOpError('There are 20 notes already. Keep the most useful ones.');
      if (!draft.notes.some((n) => n.text === op.note.text)) draft.notes.push(op.note);
      touched = `notes.${draft.notes.length - 1}`;
      message = 'Added the note.';
      events.push({ kind: 'note', noteKind: op.note.kind, text: op.note.text });
      break;
    }
    case 'set_run': {
      draft.run = op.run;
      touched = 'run';
      message = `Set the run plan (${op.run.mode}).`;
      events.push({
        kind: 'log',
        text:
          op.run.mode === 'single'
            ? `Run calls ${op.run.endpointId}`
            : `Run searches with ${op.run.searchId}, then collects with ${op.run.collectId}`,
      });
      break;
    }
    case 'finish': {
      const { problems, spec } = draftProblems(draft);
      if (!spec)
        throw new SpecOpError(
          'The spec doesn’t pass the contract yet, so the setup can’t finish. Fix these first:',
          problems,
        );
      return {
        draft,
        spec,
        events: [],
        result: { ok: true, op: 'finish', message: 'The spec passes the contract.', todo: [], valid: true },
      };
    }
  }

  const { problems, spec } = draftProblems(draft);
  if (touched) {
    const own = under(problems, touched).filter(
      // An empty new channel isn't a problem yet: its controls come next.
      (p) => !(op.op === 'add_channel' && p.path === `${touched}.controls`),
    );
    if (own.length) throw new SpecOpError(`That ${op.op.replace('_', ' ')} needs a fix:`, own);
  }
  return {
    draft,
    spec,
    events,
    planned,
    result: { ok: true, op: op.op, message, todo: problems.slice(0, 15), valid: Boolean(spec) },
  };
}

/** How many controls a draft has, and how many channels. */
export function draftCounts(draft: Draft) {
  return {
    channels: draft.channels.length,
    controls: draft.channels.reduce((n, c) => n + c.controls.length, 0),
  };
}

export { allControls };
