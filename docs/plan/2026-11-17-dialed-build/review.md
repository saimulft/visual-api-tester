# Review brief

Model and effort: Opus 5.5, Extra high. Start after: chats A and B have both filled in their Reports.

1. **Read** every chat's Report (chat-f.md, chat-a.md and chat-b.md) and the full diff: `git status`, `git diff` and every untracked file.
2. **Check the contracts and integration points:**
   - **The spec:**
     - Specs from chat A's spec operations and built-in loop are handled by chat B's request builder and controls.
     - The seed specs, and the specs chat A's test setups produced, pass the schema.
   - **Between the chats:**
     - Chat B's runner functions and services work as chat A's MCP tools call them.
     - Chat A's `mcpStatus` and `aiSummary` work on chat B's Projects page.
     - The routes match the table in common.md.
     - No stub is left behind.
   - **Migrations:** `0001_init`, plus any `0002_a_*` and `0002_b_*`, apply in order from scratch on SQLite and on Postgres.
   - **Shared files:** nothing reordered or lost.
3. **Security.** Fix anything that fails.
   - **Outbound calls:** every call to a URL that came from a person or an AI goes through `guardedFetch`. Grep for `fetch(` and undici outside the guard.
   - **Keys:**
     - A key is attached only for its own host, and only over https.
     - A spec whose host was changed sends no key.
   - **Secrets:**
     - Keys, passwords and tokens are sealed or hashed at rest.
     - None of them appear in responses, logs, `runs.requests`, `setup_events`, MCP results or error text.
   - **The AI's reach:**
     - The setup agent and the MCP tools reach only the person's own projects.
     - Page and API content can't make the agent spend credits, change the host or read other data.
   - **Auth:**
     - scrypt passwords;
     - session cookies that are httpOnly, Secure on https and SameSite Lax;
     - origin checks on routes that change state;
     - rate limits on sign-up, log-in, reset and resend;
     - the email-check gate;
     - deleting an account removes everything in it.
   - **OAuth:**
     - PKCE with S256 and exact redirect URIs;
     - tokens bound to the person's address;
     - New address and Disconnect revoke tokens;
     - the consent page names the client.
   - **Credits:**
     - Test calls run only on free endpoints.
     - The credit limits per run and per schedule are enforced on the server.
     - MCP `run_request` needs a confirm for anything that costs.
   - **The live CSV link:**
     - the token has enough entropy;
     - Turn off works;
     - it reaches only its own dataset;
     - it's rate-limited.
   - **SQLite:** WAL and the busy timeout are on, and schedules and jobs never run twice.
4. **Run the full checks once,** from `client/`:
   - `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:pg`
   - `NEXT_DIST_DIR=.next-r npm run build`
   - `docker build` of `client/`, then run the image with SQLite on a volume and curl `/api/health`
5. **Fix** what fits in this chat. For anything bigger, write one fix brief, `fix.md` in this folder, with a paste-ready prompt for a single fix chat, and tell the user.
6. **Then** work through [e2e.md](e2e.md), and then go-live ([README.md](README.md) › Go-live), each production step with the user's OK in the picker.
