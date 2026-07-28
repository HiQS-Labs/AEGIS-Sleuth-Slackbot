---
title: Sleuth — Product Strategy Brief
date: 2026-04-15
status: RETIRED 2026-07-17 — 3+ months stale, operator call during a PDDA doc-hygiene sweep.
tags: [sleuth, product, marketing, strategy, inbox]
---

# Sleuth — Product Strategy Brief

Three concise strategy docs for Sleuth: value proposition, product-market fit, and a rough marketing plan. Intended as a jumping-off point — hand the homework assignments at the bottom to Claude / Gemini / Perplexity for deeper research.

---

## 1. Product Value Proposition

**Sleuth turns Slack messages into tracked tasks without leaving Slack.**

### Problem

Asks buried in channels get forgotten. Context-switching to Jira / Linear / Notion loses ~70% of intent along the way, and most teams never actually migrate the ask — it just dies in scrollback.

### Solution

Sleuth reads messages in enabled channels, uses AI to extract *who needs to do what by when*, schedules reminders, and posts them back in a dedicated channel at the right time.

### Differentiators

- **Reactions as UI** — no modal dialogs, no slash-command soup:
  - `:alarm_clock:` → manually schedule a reminder from any message
  - `:white_check_mark:` → mark complete
  - `:wastebasket:` → delete
  - `:wrench:` → on-demand triage diagnostic (channel status + AI recommendation)
  - `:mag:` → discovery hint: *"I see this looks schedulable, but I'm not active here"*
- **Deep GitHub integration** — thread replies relay to issue/PR comments; reminders tag the linked PRs so you never lose the thread of a review.
- **Per-channel opt-in** with a workspace-admin escape hatch so bot setup isn't blocked by an unavailable channel creator.
- **Multi-workspace, per-org deployment** — each workspace is isolated with its own config, PATs, and reminder queue.
- **Natural-language-first** — no slash commands to memorize, tuned extraction for Slack grammar (direct asks, negations, relative time triggers).

### One-liner

> *"Slack's missing task memory."*

---

## 2. Product-Market Fit

### Ideal Customer Profile (ICP)

Distributed engineering teams, 5–50 people, already on Slack + GitHub, coordinating work async across time zones.

### Primary Job-To-Be-Done

> *"When a teammate asks me something in Slack, make sure neither of us forgets."*

### Secondary JTBD

> *"Keep my GitHub PRs and my Slack conversations from drifting apart."*

### Signals of Fit

- Repeat usage of `:alarm_clock:` and `:wrench:` per user per week
- Channel-enable requests from non-creators (workspace-admin escape hatch actually gets used)
- GitHub relay engagement (thread replies → GitHub comments)
- Daily digest open / click behavior
- Organic channel-enable spread within a workspace (social proof)

### Moat

- Slack-native UX + GitHub depth + AI extraction tuned specifically for Slack messaging grammar (direct-ask heuristic, deterministic fallback, negation handling)
- Reaction-driven UX is *hard to copy well* — it's a taste thing, not a feature list
- Multi-workspace infrastructure already exists (rare among hobby Slack bots)

### Existential Risks

- **Slack's own AI features** — if Slack ships good reminder extraction natively, Sleuth becomes a thin wrapper
- **Linear / Notion Slack integrations** — already entrenched in many eng teams; they just need to ship "AI extract from message"
- **Quality of GPT extraction at scale** — one bad week of hallucinated reminders could kill trust
- **Cost of AI calls per active workspace** — margin pressure if usage outpaces pricing

---

## 3. Marketing Plan — Rough Sketch

### Audience

Engineering managers, staff engineers, DevOps / SRE leads at Slack-using orgs. Secondary: indie dev teams and open-source maintainers running Slack communities.

### Positioning

> *"Stop losing work in Slack threads."*

### Channels

- **Bottom-up** — Slack App Directory listing, Product Hunt launch, Hacker News "Show HN", `r/programming`, `r/devops`
- **Content** — blog series:
  1. *"Why your Slack asks keep slipping"*
  2. *"Reaction-driven UX: less UI, more signal"*
  3. *"Slack ↔ GitHub without a second tool"*
- **Dev community** — dev.to cross-posts, SRE Weekly sponsorship, DevOps'ish newsletter, staff-eng podcast circuit
- **Owner-first acquisition** — free for single workspaces, paid for multi-workspace / SSO / compliance / custom retention

### Early Metrics (North Star → inputs)

- **North star**: weekly-active reminders scheduled per workspace
- **Leading**: installs → activated workspaces (≥1 enabled channel) → first reminder scheduled
- **Retention**: 30-day and 90-day workspace retention
- **Quality**: heuristic accuracy (AI-recommended `schedule` vs. user confirmations / `:wastebasket:` corrections)

### First 90 Days

1. **Launch week** — Product Hunt, Show HN, Slack App Directory
2. **Weeks 2–6** — ship 2 case studies, publish blog post #1, start collecting heuristic accuracy metrics
3. **Weeks 7–10** — target 100 workspaces, publish blog post #2, start dev-community podcast outreach
4. **Weeks 11–13** — measure retention, adjust pricing, ship paid tier for multi-workspace

---

## Homework Assignments

Hand these off to research assistants (Claude Desktop, Gemini Desktop, Perplexity) for deeper work:

### For Perplexity — *Competitive Landscape*

> *"Competitive landscape for Slack-native task / reminder bots in 2026. Cover Slack's own AI reminders, Linear Slack app, Notion Slack app, Missive, Range, Standuply, Geekbot, Taskbot, and any new entrants. For each: current pricing, core positioning, main weakness, and whether they do AI extraction from natural-language messages. Output as a markdown table plus a 2-paragraph synthesis on where Sleuth can carve defensible space."*

### For Claude Desktop — *Content Marketing Drafts*

> *"Draft 3 blog posts for Sleuth (a Slack-native AI reminder bot): (1) 'Why your Slack asks keep slipping — and what to do about it' (2) 'Reaction-driven UX: fewer buttons, more signal' (3) 'Slack ↔ GitHub without a second tool.' Each post: 600–800 words, technical engineering audience, show-don't-tell with code / screenshot placeholders, one strong takeaway per post. Tone: confident but not salesy."*

### For Gemini Desktop — *Go-to-Market Scorecard*

> *"Build a go-to-market scorecard for Sleuth (a Slack + GitHub AI reminder bot targeting eng teams of 5–50). Rank 10 acquisition channels — Slack App Directory, Product Hunt, Hacker News, dev.to, SRE Weekly sponsorship, DevOps'ish newsletter, GitHub README / OSS presence, technical webinars, dev podcasts, targeted ads — by expected CAC, time-to-first-install, and long-term moat-building value. Output as a markdown table with a recommended 90-day sequencing plan at the bottom."*

---

## Notes

- Kept deliberately short and opinionated — these are starting points, not final drafts.
- Everything here should be challenged with real data from the first 100 workspaces before becoming doctrine.
