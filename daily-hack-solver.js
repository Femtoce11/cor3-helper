// daily-hack-solver.js
// Fully automated solver for daily hacking minigames on cor3.gg
// Handles both "System Log Integrity" and "Signal Hack" puzzles end-to-end.
// Flow: Open daily ops tab → Start task → Detect puzzle → Solve → Close windows.
// Injected into MAIN world. Controllable via window.__dailyHackAbort flag.

(function () {
    if (window.__dailyHackActive) {
        console.warn('[COR3 Daily Hack] Solver already active.');
        return;
    }
    window.__dailyHackActive = true;
    window.__dailyHackAbort = false;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const hlog = (msg, level) => {
        level = level || 'info';
        console.log('[COR3 Daily Hack] ' + msg);
        window.postMessage({ type: 'COR3_DAILY_HACK_LOG', message: msg }, '*');
    };

    // --- Wait for an element to appear in DOM, with timeout ---
    function waitForEl(selector, timeoutMs, parent) {
        timeoutMs = timeoutMs || 10000;
        parent = parent || document;
        return new Promise((resolve) => {
            const el = parent.querySelector(selector);
            if (el) { resolve(el); return; }
            const observer = new MutationObserver(() => {
                const found = parent.querySelector(selector);
                if (found) { observer.disconnect(); clearTimeout(timer); resolve(found); }
            });
            observer.observe(parent === document ? document.body : parent, { childList: true, subtree: true });
            const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
        });
    }

    // --- Click helper with React-compatible event dispatch ---
    function click(el) {
        if (!el) return;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    // --- Set React-controlled input value ---
    function setInputValue(input, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // --- Morse / Binary maps for Signal Hack ---
    const MORSE_MAP = {
        LLLLL: '0', SLLLL: '1', SSLLL: '2', SSSLL: '3', SSSSL: '4',
        SSSSS: '5', LSSSS: '6', LLSSS: '7', LLLSS: '8', LLLLS: '9'
    };
    const BINARY_MAP = {
        SSSS: '0', SSSL: '1', SSLS: '2', SSLL: '3', SLSS: '4',
        SLSL: '5', SLLS: '6', SLLL: '7', LSSS: '8', LSSL: '9'
    };

    // Encoding option header text → internal key
    const ENCODING_LABELS = {
        'MORSE': 'Morse Numeric (0-9)',
        'BINARY': 'Binary Numeric'
    };

    // --- System Log Integrity: valid types & statuses ---
    const VALID_TYPES = new Set(['AUTH', 'TEMP-SYNC', 'SCAN', 'ROUTE-CHECK', 'RADIO-TEST', 'PING', 'SYNC']);
    const VALID_STATUSES = new Set(['OK', 'WARN', 'ERROR']);
    const ERROR_LABELS = {
        TIME: 'Time format is incorrect',
        TYPE: 'Event type is incorrect',
        MISSING_SECTOR: 'Missing /sector parameter',
        MISSING_STATUS: 'Missing /status parameter',
        SECTOR_BAD: '/sector parameter is incorrect',
        STATUS_BAD: '/status parameter is incorrect'
    };

    function analyzeLogLine(rawText) {
        const issues = [];
        const text = (rawText || '').trim();
        const timeMatch = text.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s+/);
        let rest = text;
        if (timeMatch) {
            const h = Number(timeMatch[1]), m = Number(timeMatch[2]), s = Number(timeMatch[3]);
            if (!(Number.isInteger(h) && h >= 0 && h <= 23 && Number.isInteger(m) && m >= 0 && m <= 59 && Number.isInteger(s) && s >= 0 && s <= 59)) issues.push('TIME');
            rest = text.slice(timeMatch[0].length);
        } else {
            issues.push('TIME');
        }
        const typeMatch = rest.match(/^([A-Z-]+)\b/);
        if (typeMatch) {
            if (!VALID_TYPES.has(typeMatch[1])) issues.push('TYPE');
            rest = rest.slice(typeMatch[0].length).trim();
        } else {
            issues.push('TYPE');
        }
        const hasSector = /(^|\s)\/sector=/.test(rest);
        const hasStatus = /(^|\s)\/status=/.test(rest);
        if (!hasSector) issues.push('MISSING_SECTOR');
        if (!hasStatus) issues.push('MISSING_STATUS');
        if (hasSector) {
            const sm = rest.match(/\/sector=([^\s]+)/);
            const sv = sm ? sm[1] : null;
            const sn = sv != null && /^[0-9]+$/.test(sv) ? Number(sv) : NaN;
            if (!(Number.isInteger(sn) && sn >= 1 && sn <= 256)) issues.push('SECTOR_BAD');
        }
        if (hasStatus) {
            const stm = rest.match(/\/status=([^\s]+)/);
            const stv = stm ? stm[1] : null;
            if (!(stv != null && VALID_STATUSES.has(stv))) issues.push('STATUS_BAD');
        }
        return [...new Set(issues)];
    }

    function clickCheckbox(entryEl) {
        const input = entryEl.querySelector('input[type="checkbox"]') ||
                       entryEl.querySelector('.checkbox input') ||
                       entryEl.querySelector('[role="checkbox"]') ||
                       entryEl.querySelector('input');
        if (!input) return false;
        if (input.tagName === 'INPUT' && input.type === 'checkbox') {
            if (!input.checked) {
                input.checked = true;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            return true;
        }
        input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
    }

    function findErrorTypeButton(container, label) {
        return Array.from(container.querySelectorAll('.error-type-button'))
            .find(b => (b.textContent || '').trim() === label) || null;
    }

    // --- Close app windows (decode screen, daily ops) ---
    async function closeAppWindows(count) {
        count = count || 2;
        for (let i = 0; i < count; i++) {
            await sleep(300);
            const closeBtn = document.querySelector('[data-component-name="close-app-btn"]');
            if (closeBtn) {
                click(closeBtn);
                hlog('Closed window ' + (i + 1));
            } else {
                break;
            }
        }
    }

    // =============================================
    // STEP 1: Open Daily Ops tab
    // =============================================
    async function openDailyOpsTab() {
        hlog('Opening Daily Ops tab...');
        // Click the tab bar item that opens daily ops page
        const tabItem = document.querySelector('[data-component-name="TabBarItem-019a0c41-b17f-7abc-1234-567890abcde2"]');
        if (!tabItem) {
            hlog('Could not find Daily Ops tab bar item (.go3582441102)', 'error');
            return false;
        }
        click(tabItem);
        await sleep(800);
        return true;
    }

    // =============================================
    // STEP 2: Select "Daily Ops" section
    // =============================================
    async function selectDailyOpsSection() {
        hlog('Waiting for Start Task button...');
        const dailyOpsBtn = document.querySelector('.game-center-grid button:nth-child(2)');
        if (!dailyOpsBtn) {
            hlog('Could not find Daily Ops section button (.game-center-grid button:nth-child(2))', 'error');
            return false;
        }
        click(dailyOpsBtn);
        hlog('Clicked Daily Ops section');
        await sleep(1000);
        return true;
    }

    // =============================================
    // STEP 3: Click "Start Task" button
    // =============================================
    async function clickStartTask() {
        hlog('Waiting for Start Task button...');
        const startBtn = await waitForEl('[data-component-name="DailyOpsStartButton"]', 8000);
        if (!startBtn) {
            hlog('Could not find Start Task button (.start-task-button)', 'error');
            return false;
        }
        click(startBtn);
        hlog('Clicked Start Task');
        await sleep(1000);
        return true;
    }

    // =============================================
    // Signal Hack — full end-to-end
    // =============================================
    async function solveSignalHackFull() {
        hlog('Signal Hack detected');

        // Step A: Click "Get Signal" button
        const getSignalBtn = await waitForEl('.go190644802', 5000);
        if (!getSignalBtn) {
            hlog('Could not find Get Signal button (.go190644802)', 'error');
            return false;
        }
        click(getSignalBtn);
        hlog('Clicked Get Signal');
        await sleep(1500);

        // Step B: Wait for pulse timeline and decode
        const timeline = await waitForEl('.pulse-timeline', 10000);
        if (!timeline) {
            hlog('Could not find pulse timeline after Get Signal', 'error');
            return false;
        }

        const groups = Array.from(timeline.querySelectorAll('.pulse-group'));
        const pulses = groups.map((g, i) => {
            const isShort = !!g.querySelector('.pulse-bar.short');
            const longCount = g.querySelectorAll('.pulse-bar.long').length;
            if (isShort) return 'S';
            if (longCount >= 3) return 'L';
            const bar = g.querySelector('.pulse-bar');
            if (bar?.classList.contains('short')) return 'S';
            if (bar?.classList.contains('long')) return 'L';
            console.warn(`[COR3 Daily Hack] Pulse group #${i} couldn't be classified. Using "?".`);
            return '?';
        });

        const decode = (groupSize, map) => {
            const result = [];
            for (let i = 0; i < pulses.length; i += groupSize) {
                const chunk = pulses.slice(i, i + groupSize);
                if (chunk.length < groupSize) break;
                result.push(map[chunk.join('')] ?? '?');
            }
            return result.join('');
        };

        const morseResult = decode(5, MORSE_MAP);
        const binaryResult = decode(4, BINARY_MAP);
        const countDigits = s => (s.match(/[0-9]/g) || []).length;
        const countUnknown = s => (s.match(/\?/g) || []).length;

        const md = countDigits(morseResult);
        const bd = countDigits(binaryResult);
        let encoding, value;
        if (md === 0 && bd === 0) {
            hlog('Could not decode signal — no valid digits found', 'error');
            return false;
        } else if (md > bd) {
            encoding = 'MORSE';
            value = morseResult;
        } else if (bd > md) {
            encoding = 'BINARY';
            value = binaryResult;
        } else if (countUnknown(morseResult) <= countUnknown(binaryResult)) {
            encoding = 'MORSE';
            value = morseResult;
        } else {
            encoding = 'BINARY';
            value = binaryResult;
        }

        hlog(`Signal Hack → Type: ${encoding}, Value: ${value}`);
        console.log(`[COR3 Daily Hack] Pulses: ${pulses.join(' ')}`);

        // Step C: Click "Select Encoding" (next-button)
        await sleep(500);
        const selectEncodingBtn = document.querySelector('.next-button');
        if (!selectEncodingBtn) {
            hlog('Could not find Select Encoding button (.next-button)', 'error');
            return false;
        }
        click(selectEncodingBtn);
        hlog('Clicked Select Encoding');
        await sleep(800);

        // Step D: Choose the correct encoding option
        const targetLabel = ENCODING_LABELS[encoding];
        const encodingOptions = Array.from(document.querySelectorAll('.encoding-option'));
        let chosen = null;
        for (const opt of encodingOptions) {
            const header = opt.querySelector('.option-header');
            if (header && (header.textContent || '').trim() === targetLabel) {
                chosen = opt;
                break;
            }
        }
        if (!chosen) {
            hlog(`Could not find encoding option "${targetLabel}"`, 'error');
            return false;
        }
        click(chosen);
        hlog(`Selected encoding: ${targetLabel}`);
        await sleep(500);

        // Step E: Click "Decode Signal" (next-button again)
        const decodeBtn = document.querySelector('.next-button');
        if (!decodeBtn) {
            hlog('Could not find Decode Signal button (.next-button)', 'error');
            return false;
        }
        click(decodeBtn);
        hlog('Clicked Decode Signal');
        await sleep(800);

        // Step F: Enter the code value
        const codeInput = await waitForEl('.code-input', 5000);
        if (!codeInput) {
            hlog('Could not find code input (.code-input)', 'error');
            return false;
        }
        setInputValue(codeInput, value);
        hlog(`Entered code: ${value}`);
        await sleep(400);

        // Step G: Click "CONFIRM CODE"
        const confirmBtn = document.querySelector('.submit-button');
        if (!confirmBtn) {
            hlog('Could not find Confirm Code button (.submit-button)', 'error');
            return false;
        }
        click(confirmBtn);
        hlog('Clicked CONFIRM CODE');
        await sleep(1500);

        // Step H: Check for success
        const resultTitle = document.querySelector('.result-title');
        if (resultTitle && resultTitle.classList.contains('success')) {
            hlog('✅ Signal Hack VERIFIED — Success!', 'success');
        } else if (resultTitle) {
            hlog('Signal Hack result: ' + (resultTitle.textContent || '').trim(), 'warn');
        } else {
            hlog('Could not verify result (no .result-title found)', 'warn');
        }

        // Step I: Close windows (decode screen + daily ops)
        await sleep(500);
        await closeAppWindows(3);

        return true;
    }

    // =============================================
    // System Log Integrity — full end-to-end
    // =============================================
    async function solveSystemLogIntegrityFull() {
        hlog('System Log Integrity detected');

        // Step A: Click "Get Logs" button
        const getLogsBtn = await waitForEl('.go190644802', 5000);
        if (!getLogsBtn) {
            hlog('Could not find Get Logs button (.go190644802)', 'error');
            return false;
        }
        click(getLogsBtn);
        hlog('Clicked Get Logs');
        await sleep(4000);
        // Step B: Wait for pulse timeline and decode
        const log_entries = await waitForEl('.log-entries', 10000);
        if (!log_entries) {
            hlog('Could not find log-entries after Get Logs', 'error');
            return false;
        }
        const logContainer = document.querySelector('.log-entries');
        if (!logContainer) {
            hlog('Could not find log-entries container', 'error');
            return false;
        }
        const entries = Array.from(logContainer.querySelectorAll('.log-entry.log-entry-appearing'));
        if (!entries.length) {
            hlog('No .log-entry elements found', 'error');
            return false;
        }

        const analyzed = entries.map(el => {
            const textEl = el.querySelector('span') || el.querySelector('.log-line') || el;
            const text = (textEl?.textContent || '').trim();
            return { el, text, issues: analyzeLogLine(text) };
        }).filter(e => e.issues.length > 0);

        analyzed.sort((a, b) => b.issues.length - a.issues.length);
        const selected = analyzed.slice(0, 2);
        if (selected.length === 0) {
            hlog('No invalid log entries found — puzzle may already be solved', 'warn');
            return false;
        }
        if (selected.length < 2) hlog(`Only found ${selected.length} invalid log(s)`);

        for (const entry of selected) {
            clickCheckbox(entry.el);
        }

        hlog(`Selected ${selected.length} wrong log(s)`);
        selected.forEach((e, i) => {
            console.log(`[SELECTED #${i + 1}] ${e.text}`);
            e.issues.forEach(iss => console.log(`  - ${ERROR_LABELS[iss] || iss}`));
        });

        // Click confirm button
        const confirmSelectionBtn = document.querySelector('.confirm-button');
        if (!confirmSelectionBtn) {
            hlog('Could not find .confirm-button', 'error');
            return false;
        }
        click(confirmSelectionBtn);
        await sleep(1000);

        // Handle analysis/fix phase
        const analysisContainer = await waitForEl('.analysis-container', 5000);
        if (!analysisContainer) {
            hlog('Could not find .analysis-container after confirming', 'error');
            return false;
        }

        const blocks = Array.from(analysisContainer.querySelectorAll('.error-analysis-block'));
        if (!blocks.length) {
            hlog('No .error-analysis-block found', 'error');
            return false;
        }

        const issueMap = new Map(selected.map(e => [e.text, e.issues]));

        for (const block of blocks) {
            const lineDisplay = block.querySelector('.log-line-display');
            const lineText = (lineDisplay?.textContent || '').trim();
            let issues = issueMap.get(lineText);
            if (!issues) {
                const match = selected.find(e => e.text === lineText) ||
                              selected.find(e => lineText && e.text && (e.text.includes(lineText) || lineText.includes(e.text)));
                issues = match ? match.issues : null;
            }
            if (!issues || !issues.length) {
                console.warn('[COR3 Daily Hack] Could not map analysis block to picked issues:', lineText);
                continue;
            }

            const fixBtn = block.querySelector('.fix-error-button');
            if (fixBtn) {
                click(fixBtn);
                await sleep(50);
                for (const iss of issues) {
                    const label = ERROR_LABELS[iss] || iss;
                    const errBtn = findErrorTypeButton(block, label);
                    if (errBtn) {
                        click(errBtn);
                        await sleep(25);
                    } else {
                        console.warn('[COR3 Daily Hack] Could not find error-type-button for:', label);
                    }
                }
                hlog(`Fixed: ${lineText.substring(0, 40)}...`);
            }
        }
        await sleep(1000);
        // Click confirm button
        const confirmFixesBtn = document.querySelector('.confirm-button');
        if (!confirmFixesBtn) {
            hlog('Could not find .confirm-button', 'error');
            return false;
        }
        click(confirmFixesBtn);

        await sleep(1000);
        // Click confirm button
        const scanBtn = document.querySelector('.scan-button');
        if (!scanBtn) {
            hlog('Could not find .confirm-button', 'error');
            return false;
        }
        click(scanBtn);

        // Wait for result
        await sleep(1500);
        const resultTitle = document.querySelector('.result-title');
        if (resultTitle && resultTitle.classList.contains('success')) {
            hlog('✅ System Log Integrity VERIFIED — Success!', 'success');
        } else if (resultTitle) {
            hlog('Log Integrity result: ' + (resultTitle.textContent || '').trim(), 'warn');
        }

        // Close windows
        await sleep(500);
        await closeAppWindows(3);

        return true;
    }

    // =============================================
    // Detect puzzle type from DOM
    // =============================================
    function detectPuzzle() {
        // First check for hack type label in the DOM (most reliable)
        var hackTypeDiv = document.querySelector('[data-component-name="DailyOpsTaskInfoTitle"]');
        if (hackTypeDiv) {
            if ((hackTypeDiv.textContent).includes('System Log Integrity')) return 'log';
            if ((hackTypeDiv.textContent).includes('Signal Decode')) return 'signal';
        }
        return null;
    }

    // =============================================
    // Main run — full automation flow with retry
    // =============================================
    const MAX_ATTEMPTS = 3;

    async function attemptSolve() {
        // STEP 1: Open Daily Ops tab
        const tabOpened = await openDailyOpsTab();
        if (!tabOpened || window.__dailyHackAbort) return { success: false, abort: true };

        // STEP 2: Select Daily Ops section
        const sectionSelected = await selectDailyOpsSection();
        if (!sectionSelected || window.__dailyHackAbort) return { success: false, abort: true };

        // STEP 3: Wait for puzzle to appear
        hlog('Waiting for puzzle to appear...');
        let puzzle = null;
        let waited = 0;
        while (!puzzle && waited < 15000 && !window.__dailyHackAbort) {
            puzzle = detectPuzzle();
            await sleep(500);
            waited += 500;
        }

        // STEP 4: Click "Start Task"
        const taskStarted = await clickStartTask();
        if (!taskStarted || window.__dailyHackAbort) return { success: false, abort: true };

        if (window.__dailyHackAbort) return { success: false, abort: true };

        if (!puzzle) {
            hlog('No puzzle detected after 15s', 'error');
            return { success: false, abort: false };
        }

        // STEP 4: Solve based on type
        let solved = false;
        try {
            if (puzzle === 'signal') {
                solved = await solveSignalHackFull();
            } else if (puzzle === 'log') {
                solved = await solveSystemLogIntegrityFull();
            }
        } catch (e) {
            hlog('Error: ' + (e.message || e), 'error');
            console.error('[COR3 Daily Hack] Error:', e);
            solved = false;
        }

        // Verify success by checking for .result-title.success
        const resultTitle = document.querySelector('.result-title');
        if (resultTitle && resultTitle.classList.contains('success')) {
            return { success: true };
        }

        return { success: solved === true, abort: false };
    }

    async function run() {
        hlog('Solver started — full automation mode');

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (window.__dailyHackAbort) break;

            if (attempt > 1) {
                hlog(`Retry attempt ${attempt}/${MAX_ATTEMPTS} — closing windows and restarting...`, 'warn');
                await closeAppWindows(4);
                await sleep(3000);
                if (window.__dailyHackAbort) break;
            }

            const result = await attemptSolve();

            if (result.abort) {
                hlog('Solver aborted');
                break;
            }

            if (result.success) {
                hlog('✅ Daily hack completed successfully!', 'success');
                // Auto-disable toggle after success
                window.postMessage({ type: 'COR3_DAILY_HACK_DISABLE_TOGGLE' }, '*');
                cleanup();
                return;
            }

            if (attempt < MAX_ATTEMPTS) {
                hlog(`Attempt ${attempt}/${MAX_ATTEMPTS} failed — will retry...`, 'warn');
            }
        }

        // All attempts failed
        hlog(`Daily hack failed after ${MAX_ATTEMPTS} attempts — disabling toggle`, 'error');
        window.postMessage({ type: 'COR3_DAILY_HACK_DISABLE_TOGGLE' }, '*');
        cleanup();
    }

    function cleanup() {
        window.__dailyHackActive = false;
        window.__dailyHackAbort = false;
    }

    run();
})();
