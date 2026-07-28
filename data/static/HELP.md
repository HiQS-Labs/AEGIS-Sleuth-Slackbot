*Sleuth AI: Short Help*
Use exact commands when you know what you want. If you do not, ask `@Sleuth AI help <what you want to do>` and Sleuth will point you at the best command.

*Quick Notes*
- Automatic reminder detection is off by default per channel, so enable it where you want passive task capture.
- Reaction shortcuts still work: `:alarm_clock:` creates a reminder, `:white_check_mark:` completes one, `:wastebasket:` cancels one, and `:wrench:` posts triage diagnostics.

*Getting Started*
- `@Sleuth AI help` — Show the user-facing help and features guide.
- `@Sleuth AI rmm remind me to check invoices` — Translate plain English into the closest exact Sleuth command.
- `@Sleuth AI rmm ifl show my reminders` — Resolve plain English to a Sleuth command and auto-run only the low-risk commands explicitly allowed for IFL.
- `@Sleuth AI changelog` — Summarize the latest shipped Sleuth changes from the changelog.

*Reminders*
- `@Sleuth AI enable reminders` — Enable automatic reminder detection in the current channel.
- `@Sleuth AI disable reminders` — Disable automatic reminder detection in the current channel.
- `@Sleuth AI search reminders invoice` — Search pending reminders across the workspace by keyword or close typo match.
- `@Sleuth AI search-projects` — Show high-level PROJECT-tagged reminders, a shortcut for searching reminders by the PROJECT keyword. Trailing keywords narrow within projects.
- `@Sleuth AI search my reminders invoice` — Search reminders the user created, is assigned to, or is mentioned in.
- `@Sleuth AI search reminders here invoice` — Search pending reminders only from the current channel.
- `@Sleuth AI show reminders` — List all pending reminders.
- `@Sleuth AI show my reminders` — List reminders the user created, is assigned to, or is mentioned in.
- `@Sleuth AI show reminders here` — List pending reminders only from the current channel.
- `@Sleuth AI show reminders github` — List only pending reminders with GitHub links.
- `@Sleuth AI summarize week` — Recap the current calendar week (Sun–Sat): reminder tasks completed this week and the tasks still open.
- Automatic assignment detection: if you mention another user and include a due-time phrase in the same message, Sleuth may schedule a reminder for that person even without an exact command.

*Search & Knowledge*
- `@Sleuth AI web-search automated web browsers` — Search the web through OpenAI Responses API and reply with sourced results.
- `@Sleuth AI gemini-search automated web browsers` — Search the web through Google Gemini and reply with sourced results.
- `@Sleuth AI notion search release notes` — Search the connected Notion workspace.
- `@Sleuth AI view stratalist jinhui2026` — Fetch a public Stratalist list and show it in Slack without creating reminders.
- `@Sleuth AI refresh clients` — Re-read the operator-managed Clients Slack List into the Sleuth client lookup so reminder client-name inference picks up new clients and aliases without a code deploy.
- `@Sleuth AI ask-reminders what's open for Client A?` — Query live open reminders and completion history to answer free-form questions about task state.

*Models & Workspace*
- `@Sleuth AI show-channel-model` — Show this channel's override and effective chat model.
- `@Sleuth AI show-stats` — Show usage statistics for the workspace.
- `@Sleuth AI ping` — Run a lightweight connectivity check.
