FRC Data Proxy (Statbotics Integration)
Overview

This repository hosts the FRC Data Proxy used by Summit High School Robotics (Team 5468 – Chaos Theory) to power advanced competitive analysis, strategy modeling, and historical performance insights.

The proxy provides a stable, GPT-compatible API layer in front of the public Statbotics data service. It enables our custom Strategy GPT and internal tools to reliably access team, event, and season performance data without directly coupling to third-party APIs.

This project is maintained by mentors and the Booster Club to support in-season strategy, off-season analysis, and long-term program development.

Why This Exists

Statbotics provides exceptional FRC analytics, but:

The native API is not designed for direct use by Custom GPT Actions

Some endpoints are slow, unstable, or undocumented

Event key discovery (e.g. “OSF 2025”) requires fuzzy matching

Year-to-year analysis requires careful normalization to avoid incorrect conclusions

This proxy solves those problems by:

Wrapping Statbotics endpoints with GPT-safe URLs

Adding domain-specific logic (FRC seasons, districts, canceled years, etc.)

Enforcing correct interpretation of EPA fields

Providing helper endpoints for common competitive questions

What This Proxy Supports
Team & Season Data

Team snapshots (/team/:team)

Team-year performance (/team/:team/year/:year)

Multi-year summaries (/team/:team/years)

Event Data

Event metadata and EPA summaries

Alliance and captain-level analysis

Event key resolution from human-friendly names

Benchmarks & Rankings

Regional percentile benchmarks (e.g. PNW 50th / 75th / 90th)

World #1 team lookup by season

Unitless EPA and world rank comparisons

Strategy Modeling

Supports scoring ceiling analysis

Enables comparison of robot capability vs district competitiveness

Feeds directly into the 5468 Strategy & Competitive Analysis GPT

Important Data Rules (Read Before Using)

This proxy enforces strict Statbotics field definitions to avoid common analytical mistakes:

EPA (Points) = expected match contribution in real game points

EPA SD = match-to-match variability (consistency), not strength

Unitless EPA = normalized power rating (cross-team, same-year)

World Rank = ranking based on Unitless EPA

Estimated Season Start (prior) = Statbotics preseason estimate
⚠️ Not the team’s first-event EPA

Cross-year EPA comparisons are never done directly — each season is normalized against that year’s elite teams to account for different game scoring scales.

How This Is Used

This service is consumed by:

The Team 5468 Strategy & Competitive Analysis GPT

Mentor-led scouting and competitive analysis

Off-season robot design trade studies

Alliance selection and event preparation

Long-term program performance tracking

Students do not need to interact with this API directly unless working on tooling or analytics projects.

Hosting & Ownership Notes (IMPORTANT)

Render Hosting

The live proxy service is hosted on Render

The Render account is currently owned and administered by the Team 5468 Booster Club

This ensures continuity beyond any individual mentor or student

Custom GPT Hosting

The Strategy & Competitive Analysis GPT that consumes this proxy
is currently hosted on Eyal Goldman’s paid OpenAI account

The GPT configuration (Actions schema, instructions, privacy policy)
should be treated as team infrastructure and documented if ownership changes

If stewardship of either account changes in the future, this README must be updated.

Deployment

Runtime: Node.js / Express

Hosting: Render

Upstream Data: https://api.statbotics.io

Keepalive: External cron ping to prevent cold starts

Privacy Policy: Hosted via GitHub Pages (required for GPT Actions)

The proxy is intentionally lightweight and stateless.

Repository Structure
/
├── server.js        # Express server + API endpoints
├── package.json     # Node dependencies
├── privacy.html     # Privacy policy for GPT Actions
└── README.md        # Project documentation

Maintenance Notes

This repo is owned by SummitRobotics

Changes should be reviewed by a mentor

Avoid breaking endpoint names used by the GPT

Always validate Statbotics field meanings before exposing new metrics

Acknowledgements

Statbotics for providing best-in-class FRC analytics

FIRST Robotics Competition community for open data

Team 5468 mentors and students for strategy input and validation

Questions or Changes?

If you’re a mentor or student and aren’t sure whether something should be changed here — ask first.
Small changes can have large downstream effects on strategy analysis.
