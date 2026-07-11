# COR3 Helper

A Chrome extension that enhances the [cor3.gg](https://cor3.gg) experience by monitoring markets, expeditions, daily ops, and providing timer alerts — all from a compact popup UI.

## Affiliation & Disclaimer

This extension is in no way affiliated with, partnered with, or endorsed by cor3.gg, Fragmentary Order, or Rant Gaming Studios.

The use of automation tools may be detectable by the site's developers and could put your account at risk. Always make sure you understand what a particular feature does before enabling it. The developers of this extension assume no liability for any consequences that may arise from your use of its features.

## Features

- **Theme Support** — Multiple color themes to match your preference, including an "Original" theme matching the game's native UI colors
- **Pop-up Window / Panel Support** — Exports the UI to pop-up window or side panel depending on your preference
- **Refresh System** — Either by using "refresh all" button or by clicking "refresh" for each section, it refreshes related data available on the UI
- **Pinned Timers** — Every timer except "RESTING" timer for mercenaries can be pinned to top of the UI for tracking
- **Auto Job Refresh** — If the "auto-refresh" checkbox next to pinned job timer is enabled, jobs get automatically refreshed when they reach zero. This gives users more jobs per day by triggering them earlier and giving enough time to finish
- **Auto Decrypt Hacking** — Automatically solves decryption hacks when enabled. Just toggle it on and the extension handles the rest
- **Auto ICE Wall Hacking** — Automatically solves ICE Wall hacking minigame. Detects triangle patterns and clicks them in the correct sequence to complete the puzzle
- **Auto Simple Decrypt Hacking** — Automatically solves Simple Decrypt hacking minigame. Clicks the decrypt button and monitors progress until completion
- **Auto Daily Hacking** — Fully automated daily ops solver. Opens daily ops tab, starts the task, detects the puzzle type (System Log Integrity or Signal Hack), solves it end-to-end, closes windows, and auto-disables the toggle after completion. Includes retry logic (up to 3 attempts) with automatic window cleanup between retries
- **Auto Job Solver** — Automated market job solver supporting 9 job types: File Decryption, IP Injection, Data Download, Log Deletion, Log Download, Decrypt & Extract, File Elimination, Data Upload, and IP Cleanup. Features a tabbed UI showing HOME, D4RK, SOYUZ, and USOL market jobs with per-type checkboxes, a start/stop button, and a debug console with Jobs and Logs tabs. Jobs are sorted by server priority (furthest first) and job type priority, automatically handle endpoint setting (with hack-through if unreachable), server login (with hack if no active access), type-specific actions, and job completion with reward tracking. Checks server maintenance status before each job and skips jobs on servers currently in maintenance. Includes dynamic loadout management — automatically equips the right hack/decrypt software before each job and retries with loadout swaps on power/software errors
- **Auto Valuable Seller** — Automated valuable file/log scanner and seller. Scans all reachable servers for valuable files and logs, downloads them, and sells to the best market. Automatically equips optimal SEARCH and HACK software for each server type before scanning. Features a debug console with real-time progress logs and a server/download results UI
- **Auto Dismiss Failed Jobs** — Toggle to automatically dismiss failed and bugged jobs after each solver run, keeping the job queue clean
- **Auto Finish All Jobs** — Background scheduling that automatically starts the Auto Job Solver when new jobs become available after reset. Uses chrome.alarms to schedule runs at job reset times with retry logic. Works even when the popup is closed. Server maintenance–aware: skips jobs on servers currently in maintenance and schedules retries at the earlier of job reset or maintenance end.
- **Auto Clear Generated IPs** — Periodically cleans up auto-generated IPs (10.x, 172.x, 192.x, 198.x) from servers, keeping at most 10 per server. Runs every 3 hours in the background. Automatically hacks servers if access has expired.
- **Market Path-Through** — When market servers (D4RK, SOYUZ, USOL) are unreachable (no-path-to-server), automatically attempts to establish a path by setting endpoints to intermediate servers, hacking them if needed for access, then retrying the market endpoint.
- **Daily Ops** — Countdown to your next daily ops task with streak bonus, difficulty, and claim status
- **Market Monitoring** — View Market-1 (HOME), Market-2 (D4RK), Market-3 (SOYUZ), and Market-4 (USOL) stats, job reset timers, items list (with INFO popup for item details), and jobs list (with Category/Server/Reward columns)
- **Loadout Viewer** — View and manage your equipped hardware (CPU/GPU/RAM/PSU) and installed software. Game-style card UI with hardware specs, software power ratios, resource supply/demand overview with boot status, CHANGE/INFO buttons for hardware, and sort/search/equip/unequip for software
- **Active Expedition Tracking** — See active expeditions with remaining timer, cost, risk, insurance, and mercenary info
- **Expedition Decisions** — View and respond to pending decisions by clicking them with score calculation
- **Auto Choose Decision** — Auto choose decisions 1-min before deadline according to their scoring. Configure loot/risk modifiers to change how scoring works.
- **Inventory Viewer** — Browse your stash sorted by rarity (rarest first) then price, with item/storage details, total value, and last-updated timestamps
- **Mercenaries (Multi-Market)** — View mercenaries from CORE and USOL markets in expandable rows with faction icons. Each merc card shows callsign, rank, status, specialization, traits, mission count, cost, rest timers, risk, failed-survive chance, and death chance. Elite mercenaries are displayed on top with a bold "ELITE" badge.
- **Auto Send Mercenary** — Enable "auto send" toggle and select a mercenary to send just after current expedition is done. It auto-claims previous reward container. Works across both CORE and USOL markets with market-aware expedition config.
- **Auto Choose Mercenary** — Enable "auto choose" toggle for extension to do best mercenary selection according to their cost and risk values across all markets.
- **Auto-choose USOL First** — When enabled, USOL mercenaries are prioritized over CORE mercenaries during auto-choose, picking the cheapest USOL merc before considering CORE.
- **Ignore Elite Mercenary** — When enabled, elite mercenaries are excluded from auto-choose selection.
- **Auto Sell Cheapest Items** — Enable "auto sell" toggle for extension to sell two cheapest items from inventory automatically when there is not enough space to pickup expedition container items.
- **Archived Expeditions** — View past expeditions with outcome, cost, risk, location, loot container details and item images. Auto-loaded on startup
- **Multi-Alarm System** — Create multiple configurable alarms for any timer (daily ops, market job resets, expeditions). Each alarm has its own threshold, volume, continuous mode, and on/off toggle
- **Move Notifications** — Option to move in-game notification toasts and history panel from the right side to the left side of the screen
- **Secret Link/Server Finder** — Scans all known server IPs on the network map to discover hidden connections and servers. Sends `connect.ip` for each known IP, then compares before/after map data. Uses a toggle switch (auto-disables after scan) with progress and results shown in a log box. Reports new connections and new servers found
- **Resizable Network Map** — Toggle to make the in-game network map window resizable via drag
- **Helper-Only Mode** — Toggle to hide all automation features, converting the extension to a pure info/helper tool
- **Auto Update Markets** — Toggle to automatically refresh market data when WebSocket events arrive
- **Version Tracking** — Displays extension, web, system, and patch versions
- **Check for Updates** — Compare your installed extension, web, and system versions against the latest on GitHub. It lets user know if an update is required for extension or if web/system versions are different from what's stored.
- **Cache-First Design** — Data loads instantly from cache on popup open. Use the "Refresh All" button or per-section refresh buttons to fetch fresh data
- **Real-Time Updates** — WebSocket listeners auto-update daily ops, markets, expeditions, decisions, inventory, mercenaries, loadout, and archived expeditions live when data arrives — even if the popup is opened before data is ready
- **DevTools WS Inspector** — Built-in Chrome DevTools panel for real-time WebSocket message inspection and multicategory log viewer. Features include: category selector (WS Messages, Auto Job Solver, Auto Valuable Seller, Error Logs, Page Console Logs, Extension Console Logs), direction/event/action/server column filtering for WS messages, level/message columns for log categories, format dropdown (Raw / JSON-pretty / Interactive Tree View with inline object/array previews), search with highlight & navigation inside message detail (including tree view traversal with auto-expand), export filtered data as JSON or Markdown table, paginated log display (1000 entries per page) with section selector, IndexedDB-backed storage with 24-hour auto-cleanup, per-category clear, and resizable columns/detail pane. Includes an offline popout log viewer that imports exported log files (JSON, MD, Discord clipboard format) for offline analysis
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
- **Auto ICE Wall Hacking** — Toggle the switch to enable. It automatically solves ICE Wall hacking minigames by detecting and clicking triangle patterns.
- **Auto Simple Decrypt Hacking** — Toggle the switch to enable. It automatically solves Simple Decrypt hacking minigames by clicking the decrypt button and monitoring progress.
- **Auto Daily Hacking** — Toggle the switch to enable. It opens daily ops, starts the task, solves the puzzle automatically, and disables itself when done.
- **Auto Job Solver** — Toggle the switch to reveal job selection UI. Choose job types from HOME, D4RK, SOYUZ, and USOL market tabs, then click Start. The debug console shows real-time job progress and logs. Toggle "Auto Finish All Jobs" for fully automatic operation.
- **Auto Clear Generated IPs** — Toggle the switch to enable. Runs every 3 hours in the background to clean up excess auto-generated IPs from servers.
- **Set decision scores** by clicking edit button. After the change click save button to keep the changes. This way you can change default scoring that extension shows next to each decision.
- **Enable auto choose decision** for extension to automatically choose best decision according to scoring which is calculated by default/modified loot/risk modifiers.
- **Enable auto send mercenary** for extension to send selected mercenary by itself after the current expedition ends.
- **Enable auto choose mercenary** for extension to choose which mercenary to send for next expedition according to their cost and risk values across CORE and USOL markets. It only works if "auto-send" feature is turned on. Use "Auto-choose USOL first" to prioritize USOL mercs and "Ignore elite mercenary" to exclude elite mercs from selection.
- **Secret Link/Server Finder** — Toggle the switch to enable. It scans all known server IPs by connecting to each one, then compares the network map before and after to discover any new hidden connections or servers. The toggle auto-disables when the scan completes.
- **Alarms** — Click ➕ in the Alarms section to create a new alarm. Choose a timer source, set a threshold, and configure volume/continuous beeping. Toggle alarms on/off or edit/delete them anytime.
- **Check for Updates** — Click the button at the bottom of the popup to see if a new version of extension is available on GitHub. It also shows if web/system versions are changed recently.
- **DevTools WS Inspector** — Open Chrome DevTools (F12) and navigate to the "COR3 Helper" tab. Use the category selector to switch between WS Messages, Auto Job Solver logs, Auto Valuable Seller logs, Error Logs, Page Console Logs, and Extension Console Logs. Use the page selector to browse log history (1000 entries per page). Use the filter inputs, format dropdown, search bar, and export buttons to analyze data. Toggle Live mode to see only new entries from the activation point onward. Click the ⧉ popout button to open an offline log viewer in a new window where you can import previously exported log files.

## Files

| File                       | Description                                                                                                                                                               |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `manifest.json`            | Extension manifest (Manifest V3) — permissions include storage, scripting, activeTab, tabs, alarms, sidePanel                                                             |
| `popup.html`               | Popup UI (HTML + CSS) — includes auto job solver section, debug console, and all toggle UIs                                                                               |
| `popup.js`                 | Popup logic, rendering, alarm management, auto job solver UI, debug console, live storage update listeners                                                                |
| `console-logger.js`        | Console interceptor — captures console.log/warn/error in both MAIN world and extension contexts for DevTools log viewing                                                  |
| `errors.js`                | Centralized error logging — stores errors to chrome.storage.local with source, message, stack, and context (max 200 entries)                                              |
| `notepack.min.js`          | Bundled notepack.io 3.0.1 library — local copy of msgpack encoder/decoder used by the binary WS codec                                                                     |
| `msgpack-codec.js`         | Socket.IO v5 binary packet codec — converts between legacy 42[...] strings and binary msgpack WS frames using notepack.io                                                 |
| `content-early.js`         | Injected at `document_start` — intercepts WebSocket/HTTP polling messages, WS send functions, D4RK path-through logic                                                     |
| `content.js`               | Injected at `document_idle` — relays data to storage, handles auto-refresh, auto job solver injection, notification repositioning                                         |
| `background.js`            | Service worker — auto finish all jobs scheduling, auto clear IPs scheduling, expedition polling, alarm management                                                         |
| `ws-messages.js`           | IndexedDB writer for WS messages and categorized logs (auto-jobs, auto-valuable, errors). 24h purge                                                                       |
| `ws-interceptor.js`        | WebSocket interceptor helper                                                                                                                                              |
| `decrypt-solver.js`        | Auto-solver for decryption hacking minigame (injected into page when enabled)                                                                                             |
| `ice-wall-solver.js`       | Auto-solver for ICE Wall hacking minigame — detects triangle patterns and clicks them in sequence                                                                         |
| `simple-decrypt-solver.js` | Auto-solver for Simple Decrypt hacking minigame — clicks decrypt button and monitors progress                                                                             |
| `daily-hack-solver.js`     | Fully automated daily ops solver — opens tab, starts task, detects puzzle, solves it, closes windows, auto-disables toggle                                                |
| `auto-job-solver.js`       | MAIN world auto job solver engine — handles 9 job types with promise-based WS event orchestration                                                                         |
| `auto-valuable-seller.js`  | MAIN world valuable seller engine — scans servers for valuable files/logs, downloads them, and sells to markets with auto loadout                                         |
| `devtools.html`            | DevTools entry point — registers the WS Inspector panel                                                                                                                   |
| `devtools.js`              | DevTools page script — creates the panel tab                                                                                                                              |
| `devtools-panel.html`      | DevTools panel UI — message table, detail pane, export/search/format controls, popout button                                                                              |
| `devtools-panel.js`        | DevTools panel logic — multi-category viewing (incl. console logs), filtering, raw/json-pretty/tree-view, search, export, live mode, paginated IndexedDB loading, WS send |
| `devtools-log-viewer.html` | Offline log viewer UI — standalone popout window for importing and viewing exported logs                                                                                  |
| `devtools-log-viewer.js`   | Offline log viewer logic — import/parse JSON, MD table, Discord clipboard formats, category switching, filtering, detail view                                             |
| `versions.json`            | Version tracking file for update checks (extension, web, system, patch)                                                                                                   |

## Requirements

- Google Chrome (or Chromium-based browser)
- An active [cor3.gg](https://cor3.gg) account

## License

MIT
