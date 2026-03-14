# Botpress ADK Agent

> This project is built with the **Botpress Agent Development Kit (ADK)** — a TypeScript-first framework for building AI agents.

## Key Files

- `agent.config.ts` — Agent configuration, models, state schemas, and dependencies
- `src/conversations/` — Message handlers (primary user interaction)
- `src/workflows/` — Long-running background processes
- `src/tools/` — AI-callable functions
- `src/actions/` — Reusable business logic
- `src/knowledge/` — RAG knowledge base sources
- `src/tables/` — Database table definitions
- `src/triggers/` — Event-based triggers

## Development

```bash
adk dev      # Start dev server with hot reload
adk build    # Build and generate types
adk deploy   # Deploy to Botpress Cloud
adk chat     # Chat with your agent in the terminal
```

## AI Coding Assistant Skills

This project uses the Botpress ADK. Before making changes, use the relevant skill:

| Skill              | Use for                                          |
| ------------------ | ------------------------------------------------ |
| `/adk`             | ADK concepts, patterns, and API reference        |
| `/adk-integration` | Finding and using Botpress integrations           |
| `/adk-debugger`    | Debugging with traces and test conversations      |
| `/adk-frontend`    | Building frontends that connect to ADK bots       |

If these skills are not installed, install them:

```
npx skills add botpress/skills --skill adk
```

## Project Overview

<!-- Describe what your agent does -->

## Architecture & Conventions

<!-- Add project-specific patterns, decisions, and conventions -->

## Notes

<!-- Add anything else relevant to your project -->
