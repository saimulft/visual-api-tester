import { Fragment } from 'react';

/** How to add Dialed's MCP address in each AI app (screen 02, Settings › How to connect, the README). */
export type ConnectClient = 'claude' | 'chatgpt' | 'cursor';

/** Each step's **bold** parts are what the person clicks. */
export const CONNECT_STEPS: Record<ConnectClient, { name: string; steps: string[] }> = {
  claude: {
    name: 'Claude',
    steps: [
      'In Claude, open **Settings**, then **Connectors**, and choose **Add custom connector**.',
      'Paste the address and name it Dialed.',
      'Sign in to Dialed when Claude asks, and allow access.',
    ],
  },
  chatgpt: {
    name: 'ChatGPT',
    steps: [
      'In ChatGPT, open **Settings**, then **Apps and connectors**, and turn on **Developer mode** under Advanced.',
      'Choose **Create**, paste the address, name it Dialed and pick OAuth.',
      'Sign in to Dialed when ChatGPT asks, and allow access.',
    ],
  },
  cursor: {
    name: 'Cursor',
    steps: [
      'In Cursor, open **Settings**, then **MCP**, and choose **Add new MCP server**.',
      'Paste the address as the server URL and name it Dialed.',
      'Sign in to Dialed when Cursor asks, and allow access.',
    ],
  },
};

export const WORKS_WITH = ['Claude', 'ChatGPT', 'Cursor', 'VS Code', 'Any MCP client'];

/** The seven tools, as the design lists them. */
export const MCP_TOOLS = [
  'list_projects',
  'create_project',
  'read_api_docs',
  'set_controls',
  'run_request',
  'get_results',
  'schedule_pull',
];

/** One client's steps as the canvas's numbered .olist. */
export function ConnectSteps({ client = 'claude' }: { client?: ConnectClient }) {
  return (
    <ol className="olist">
      {CONNECT_STEPS[client].steps.map((step) => (
        <li key={step}>
          <span>
            {step
              .split('**')
              .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>))}
          </span>
        </li>
      ))}
    </ol>
  );
}
