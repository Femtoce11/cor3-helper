# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.5.x   | :white_check_mark: |
| < 1.5   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in COR3 Helper, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainer or use GitHub's private vulnerability reporting feature
3. Include a description of the vulnerability, steps to reproduce, and potential impact

## Scope

This extension runs entirely client-side in the browser. It:
- Intercepts WebSocket messages on `cor3.gg` only
- Stores data in `chrome.storage.local` and `chrome.storage.sync`
- Does not transmit data to any external server
- Does not collect or store authentication credentials

## Response

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for confirmed vulnerabilities.
