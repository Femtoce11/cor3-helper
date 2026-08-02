# Contributing to COR3 Helper

Thanks for your interest in contributing! This document outlines how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Load the extension in Chrome via `chrome://extensions` → "Load unpacked"
4. Make your changes and test them against [cor3.gg](https://cor3.gg)

## Project Structure

- `manifest.json` — Chrome Extension Manifest V3 config
- `popup.html` / `popup.js` — Extension popup UI
- `content-early.js` — MAIN world WebSocket interceptor (runs at `document_start`)
- `content.js` — Content script (runs at `document_idle`) — automation queue, message relay
- `background.js` — Service worker for alarms, scheduling, auto-finish logic
- `auto-job-solver.js` — MAIN world auto job solving engine
- `auto-valuable-seller.js` — MAIN world valuable item search and sell engine
- `decrypt-solver.js` / `ice-wall-solver.js` / `simple-decrypt-solver.js` — Minigame solvers
- `console-logger.js` — Console interception and IndexedDB logging
- `ws-interceptor.js` — DevTools panel WebSocket capture
- `msgpack-codec.js` — Binary Socket.IO v5 message codec

## Development Guidelines

- **No new dependencies** — This is a vanilla JS Chrome extension with no build step.
- **Test manually** — Load the extension, open cor3.gg, and verify your changes work.
- **Keep comments minimal** — Don't add unnecessary comment lines.
- **Match existing style** — Use `var` in MAIN world scripts, `const`/`let` in content/popup/background scripts.
- **WebSocket protocol** — The game uses Socket.IO v5 with binary msgpack. All WS messages flow through the `decodeBinaryMsg` → `handleWsMessage` pipeline.

## Submitting Changes

1. Create a feature branch from `main`
2. Make focused, atomic commits
3. Open a Pull Request with a clear description of what changed and why
4. Reference any related issues

## Reporting Bugs

Use the [Bug Report](https://github.com/Femtoce11/cor3-helper/issues/new?template=bug_report.md) issue template. Include:
- Steps to reproduce
- Expected vs actual behavior
- Console logs (use the DevTools Log Viewer panel)
- Extension version (from `manifest.json`)
