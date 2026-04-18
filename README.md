# COR3 Helper

A Chrome extension that enhances the [cor3.gg](https://cor3.gg) experience by monitoring markets, expeditions, daily ops, and providing timer alerts — all from a compact popup UI.

## Features

- **Market Monitoring** — View Market-1 (HOME) and Market-2 (D4RK) options, prices, jobs, and reset timers
- **Expedition Tracking** — See active expeditions with various information
- **Daily Ops Timer** — Countdown to your next daily ops task with extra information
- **Multi-Alarm System** — Create multiple configurable alarms for any timer (daily ops, market job resets). Each alarm has its own threshold, volume, continuous mode, and on/off toggle
- **Pinned Timers** — Pin important timers to the top of the popup for quick access
- **Auto-Job-Refresh** — Market job timers automatically refresh when they reach zero, so jobs get refreshed even with the popup closed. This gives users more jobs per day by triggering them earlier and giving enough time to finish
- **Inventory Viewer** — Browse your stash with item details and total value
- **Expedition Decisions** — View details related to pending expedition decisions directly from the popup
- **Cache-First Design** — Data loads instantly from cache on popup open. Use the 🔄 Refresh All button or per-section refresh buttons to fetch fresh data
- **Theme Support** — Multiple color themes to match your preference
- **Lightweight** — Intercepts existing WebSocket traffic; no extra API calls beyond what the game already sends

## Installation

1. **Download** — Clone or download this repository:
   ```
   git clone https://github.com/YOUR_USERNAME/cor3-helper.git
   ```
   Or click **Code → Download ZIP** and extract it somewhere on your computer.

2. **Open Chrome Extensions** — Navigate to `chrome://extensions/` in your browser.

3. **Enable Developer Mode** — Toggle the **Developer mode** switch in the top-right corner.

4. **Load the Extension** — Click **Load unpacked** and select the folder containing the extension files (the folder with `manifest.json`).

5. **Navigate to cor3.gg** — Open [https://cor3.gg](https://cor3.gg) and log in. The extension will automatically start intercepting game data.

6. **Open the Popup** — Click the COR3 Helper icon in your browser toolbar to view your dashboard.

## Usage

- **On page load**, the extension automatically fetches market data, expedition data, and daily ops to populate the cache.
- **Open the popup** to see cached data instantly with "last updated" timestamps.
- **Refresh All** (🔄 button in header) sequentially refreshes daily ops → markets → expeditions.
- **Per-section refresh** buttons let you refresh individual data types.
- **Alarms** — Click ➕ in the Alarms section to create a new alarm. Choose a timer source, set a threshold, and configure volume/continuous beeping. Toggle alarms on/off or edit/delete them anytime.
- **Pin timers** to keep them visible at the top of the popup.

## Files

| File | Description |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `popup.html` | Popup UI (HTML + CSS) |
| `popup.js` | Popup logic, rendering, alarm management |
| `content-early.js` | Injected at `document_start` — intercepts WebSocket messages, sends market/expedition requests |
| `content.js` | Injected at `document_idle` — relays data to storage, handles alarm checking, auto-refresh |
| `background.js` | Service worker for extension lifecycle |
| `ws-interceptor.js` | WebSocket interceptor helper |

## Requirements

- Google Chrome (or Chromium-based browser)
- An active [cor3.gg](https://cor3.gg) account

## License

MIT
