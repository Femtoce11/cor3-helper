# COR3 Helper

A Chrome extension that enhances the [cor3.gg](https://cor3.gg) experience by monitoring markets, expeditions, daily ops, and providing timer alerts — all from a compact popup UI.

## Affiliation & Disclaimer

This extension is in no way affiliated with, partnered with, or endorsed by cor3.gg, Fragmentary Order, or Rant Gaming Studios.

The use of automation tools may be detectable by the site's developers and could put your account at risk. Always make sure you understand what a particular feature does before enabling it. The developers of this extension assume no liability for any consequences that may arise from your use of its features.

## Features

- **Theme Support** — Multiple color themes to match your preference
- **Pop-up Window / Panel Support** — Exports the UI to pop-up window or side panel depending on your preference
- **Refresh System** — Either by using "refresh all" button or by clicking "refresh" for each section, it refreshes related data available on the UI
- **Pinned Timers** — Every timer except "RESTING" timer for mercenaries can be pinned to top of the UI for tracking.
- **Auto Job Refresh** — If the "auto-refresh" checkbox next to pinned job timer is enabled, jobs get automatically refreshed when they reach zero. This gives users more jobs per day by triggering them earlier and giving enough time to finish
- **Auto Decrypt Hacking** — Automatically solves decryption hacks when enabled. Just toggle it on and the extension handles the rest
- **Auto Daily Hacking** — Fully automated daily ops solver. Opens daily ops tab, starts the task, detects the puzzle type (System Log Integrity or Signal Hack), solves it end-to-end, closes windows, and auto-disables the toggle after completion. Includes retry logic (up to 3 attempts) with automatic window cleanup between retries.
- **Auto Job Solver** — Automated market job solver supporting 9 job types: File Decryption, IP Injection, Data Download, Log Deletion, Log Download, Decrypt & Extract, File Elimination, Data Upload, and IP Cleanup. Features a tabbed UI showing both HOME and D4RK market jobs with per-type checkboxes, a start/stop button, and a debug console with Jobs and Logs tabs. Jobs are sorted by server priority (furthest first) and automatically handle endpoint setting, server login (with hack if needed), type-specific actions, and job completion with reward tracking. Checks server maintenance status before each job and skips jobs on servers currently in maintenance.
- **Auto Finish All Jobs** — Background scheduling that automatically starts the Auto Job Solver when new jobs become available after reset. Uses chrome.alarms to schedule runs at job reset times with retry logic. Works even when the popup is closed. Server maintenance–aware: skips jobs on servers currently in maintenance and schedules retries at the earlier of job reset or maintenance end.
- **Auto Clear Generated IPs** — Periodically cleans up auto-generated IPs (10.x, 172.x, 192.x, 198.x) from servers, keeping at most 10 per server. Runs every 3 hours in the background. Automatically hacks servers if access has expired.
- **D4RK Market Path-Through** — When the D4RK market server is unreachable (no-path-to-server), automatically attempts to establish a path by setting endpoints to intermediate servers (RM7-E1L5 → RM7-E1SCP), hacking them if needed for access, then retrying the D4RK endpoint.
- **Daily Ops** — Countdown to your next daily ops task with streak bonus, difficulty, and claim status
- **Market Monitoring** — View Market-1 (HOME) and Market-2 (D4RK) stats, job reset timers, items list, and jobs list (with Category/Server/Reward columns)
- **Active Expedition Tracking** — See active expeditions with remaining timer, cost, risk, insurance, and mercenary info
- **Expedition Decisions** — View and respond to pending decisions by clicking them with score calculation
- **Auto Choose Decision** — Auto choose decisions 1-min before deadline according to their scoring. Configure loot/risk modifiers to change how scoring works.
- **Inventory Viewer** — Browse your stash sorted by rarity (rarest first) then price, with item/storage details, total value, and last-updated timestamps
- **Mercenaries** — View mercenary callsign, rank, status, specialization, traits, mission count, cost, rest timers, risk, failed-survive chance, and death chance.
- **Auto Send Mercenary** — Enable "auto send" toggle and select a mercenary to send just after current expedition is done. It auto-claims previous reward container.
- **Auto Choose Mercenary** — Enable "auto choose" toggle for extension to do best mercenary selection according to their cost and risk values.
- **Archived Expeditions** — View past expeditions with outcome, cost, risk, location, loot container details and item images. Auto-loaded on startup
- **Multi-Alarm System** — Create multiple configurable alarms for any timer (daily ops, market job resets, expeditions). Each alarm has its own threshold, volume, continuous mode, and on/off toggle
- **Move Notifications** — Option to move in-game notification toasts and history panel from the right side to the left side of the screen
- **Version Tracking** — Displays extension, web, system, and patch versions
- **Check for Updates** — Compare your installed extension, web, and system versions against the latest on GitHub. It lets user know if an update is required for extension or if web/system versions are different from what's stored.
- **Cache-First Design** — Data loads instantly from cache on popup open. Use the "Refresh All" button or per-section refresh buttons to fetch fresh data
- **Real-Time Updates** — WebSocket listeners auto-update daily ops, markets, expeditions, decisions, inventory, mercenaries, and archived expeditions live when data arrives — even if the popup is opened before data is ready
- **Lightweight** — Only intercepts existing WebSocket traffic and re-triggers some API calls that the game already sends

## Installation

1. **Download** — Clone or download this repository:
   ```
   git clone https://github.com/Femtoce11/cor3-helper.git
   ```
   Or click **Code → Download ZIP** and extract it somewhere on your computer.

2. **Open Chrome Extensions** — Navigate to `chrome://extensions/` in your browser.

3. **Enable Developer Mode** — Toggle the **Developer mode** switch in the top-right corner.

4. **Load the Extension** — Click **Load unpacked** and select the folder containing the extension files (the folder with `manifest.json`).

5. **Navigate to cor3.gg** — Open [https://cor3.gg](https://cor3.gg) and log in. The extension will automatically start intercepting game data.

6. **Open the Popup** — Click the COR3 Helper icon in your browser toolbar to view your dashboard.

## Usage

- **On page load**, the extension automatically fetches daily ops, market data, expedition data, and mercenary data to populate the cache.
- **Open the popup** to see cached data instantly with "last updated" timestamps.
- **Refresh All** button sequentially refreshes daily ops → markets → expeditions -> mercenary.
- **Per-section refresh** buttons let you refresh individual data types.
- **Pin timers** to keep them visible at the top of the popup.
- **Auto job refresh** feature can be used to automatically refresh jobs when needed after pinning timers and clicking the "Auto" checkbox next to it.
- **Auto Decrypt Hacking** — Toggle the switch to enable. It automatically solves decryption hacks whenever one appears.
- **Auto Daily Hacking** — Toggle the switch to enable. It opens daily ops, starts the task, solves the puzzle automatically, and disables itself when done.
- **Auto Job Solver** — Toggle the switch to reveal job selection UI. Choose job types from HOME and D4RK market tabs, then click Start. The debug console shows real-time job progress and logs. Toggle "Auto Finish All Jobs" for fully automatic operation.
- **Auto Clear Generated IPs** — Toggle the switch to enable. Runs every 3 hours in the background to clean up excess auto-generated IPs from servers.
- **Set decision scores** by clicking edit button. After the change click save button to keep the changes. This way you can change default scoring that extension shows next to each decision.
- **Enable auto choose decision** for extension to automatically choose best decision according to scoring which is calculated by default/modified loot/risk modifiers.
- **Enable auto send mercenary** for extension to send selected mercenary by itself after the current expedition ends.
- **Enable auto choose mercenary** for extension to choose which mercenary to send for next expedition according to their cost and risk values. It only works if "auto-send" feature is turned on.
- **Alarms** — Click ➕ in the Alarms section to create a new alarm. Choose a timer source, set a threshold, and configure volume/continuous beeping. Toggle alarms on/off or edit/delete them anytime.
- **Check for Updates** — Click the button at the bottom of the popup to see if a new version of extension is available on GitHub. It also shows if web/system versions are changed recently.

## Files

| File                   | Description                                                                                                                       |
|------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| `manifest.json`        | Extension manifest (Manifest V3) — permissions include storage, tabs, alarms, sidePanel                                           |
| `popup.html`           | Popup UI (HTML + CSS) — includes auto job solver section, debug console, and all toggle UIs                                       |
| `popup.js`             | Popup logic, rendering, alarm management, auto job solver UI, debug console, live storage update listeners                        |
| `content-early.js`     | Injected at `document_start` — intercepts WebSocket/HTTP polling messages, WS send functions, D4RK path-through logic             |
| `content.js`           | Injected at `document_idle` — relays data to storage, handles auto-refresh, auto job solver injection, notification repositioning |
| `background.js`        | Service worker — auto finish all jobs scheduling, auto clear IPs scheduling, expedition polling, alarm management                 |
| `ws-interceptor.js`    | WebSocket interceptor helper                                                                                                      |
| `decrypt-solver.js`    | Auto-solver for decryption hacking minigame (injected into page when enabled)                                                     |
| `daily-hack-solver.js` | Fully automated daily ops solver — opens tab, starts task, detects puzzle, solves it, closes windows, auto-disables toggle        |
| `auto-job-solver.js`   | MAIN world auto job solver engine — handles 9 job types with promise-based WS event orchestration                                 |
| `versions.json`        | Version tracking file for update checks (extension, web, system, patch)                                                           |

## Requirements

- Google Chrome (or Chromium-based browser)
- An active [cor3.gg](https://cor3.gg) account

## License

MIT
