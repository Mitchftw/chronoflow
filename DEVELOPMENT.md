# Local development

- `npm run dev` uses the separate `ChronoFlow-Dev` data directory.
- `npm run dev:installed-data` explicitly opens the installed app's `ChronoFlow` data directory. Changes made in this mode affect your actual data. Close the installed app first; the two instances share a single-instance guard.
- End-to-end tests create a fresh temporary `chronoflow-test-userdata-*` directory for each run. `IS_TEST=true` takes precedence over the installed-data option. Never run tests against the installed database. Old temporary test directories can be removed separately.

## Agent MCP

In Settings, select your agent and click **Install MCP**, then restart the agent. Keep ChronoFlow running. The installer writes the tokenized loopback URL to the agent configuration. The default port is 38473. Set `CHRONOFLOW_MCP_PORT` before startup to choose another port, then reinstall the connection.

- Manage projects and tasks, including status, estimates, scheduled dates and project assignments.
- Create a completed entry with `create_time_entry`, or use `start_timer` with a local task ID or Jira key. Pause, resume, stop or correct a running entry.
- Use `move_time_entry` to shift an entry to a different date, start time or task. Moving a completed entry preserves its duration.
- Use `split_time_entry` for a point cut. Use `split_out_time_entry` for a block such as lunch. Omitting the destination task removes that block. The remaining open segment keeps running.
- Use `merge_time_entries` to combine closed entries on one task into a span under 24 hours, including across midnight. The resulting span includes gaps. Entry edits use local times with optional seconds. An end earlier than the start represents an overnight entry.
- Search Jira, inspect issues and import a ticket as a local task with `import_jira_issue` before moving time to it. Local edits to linked entries are picked up by the app's Jira sync.

Run `npm run build` followed by `npx playwright test e2e/mcp.spec.ts` to exercise the HTTP endpoint and installer against an isolated Electron profile.
