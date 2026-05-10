// ice-wall-solver.js
// Auto-solver for "ICE Wall Break" hacking minigame on cor3.gg
// Injected into MAIN world. Controllable via window.__iceWallSolverAbort flag.
// The ICE Wall Break game shows a large composite target (9 small triangles forming
// a big triangle) and a board of ~100 triangles. The player must find where the
// target pattern appears on the board and click the anchor cell. The game has
// multiple rounds (counter shows e.g. "0/3").
//
// Algorithm: fingerprint each triangle by its inner SVG shapes. Parse the target
// preview to extract anchor fingerprint + 8 offset fingerprints. Scan the board
// grid for positions where the pattern matches. Use a MutationObserver to wait
// until exactly one candidate remains, then click it.

(function () {
	if (window.__iceWallSolverActive) {
		console.warn('\u26a0\ufe0f ICE Wall solver is already active. Aborting duplicate initialization.');
		return;
	}
	window.__iceWallSolverActive = true;
	window.__iceWallSolverAbort = false;

	// --- Utilities ------------------------------------------------------------
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	// Post a status message visible in the popup UI
	function postStatus(msg, level) {
		window.postMessage({ type: 'COR3_ICE_WALL_STATUS', message: msg, level: level || 'info' }, '*');
	}

	// Read the DOM round counter (e.g. "1/3")
	function getRoundCounter() {
		const el = document.querySelector('[data-sentry-element="SidebarCounterStyled"] span');
		return el ? el.textContent.trim() : '';
	}

	// Get the game timer duration from pendingMinigameData, fallback to 60s
	function getGameTimerMs() {
		if (pendingMinigameData && pendingMinigameData.meta && pendingMinigameData.meta.staticParams) {
			return pendingMinigameData.meta.staticParams.timerDurationMs || 60000;
		}
		return 60000;
	}

	// --- DOM Detection --------------------------------------------------------

	function findIceWallApp() {
		return document.querySelector(
			'[data-component-name="IceWallBreakApplication"], ' +
			'[data-sentry-component="IceWallBreakApplication"]'
		);
	}

	// --- Glyph Fingerprinting -------------------------------------------------

	// Build a fingerprint string from a glyph <g> element's visible SVG children.
	// Skips the bounding triangle hit-area, opacity-0 elements, and the outer
	// outline. Uses raw path "d" attributes for precision.
	function glyphFingerprint(g) {
		if (g.querySelector('path[fill="#00121D"]')) return null;

		const parts = [];
		for (const el of g.children) {
			if (el.getAttribute('fill-opacity') === '0.2') continue;
			if (el.getAttribute('data-sentry-component') === 'GlyphBoundingTriangle') continue;
			if (el.style && el.style.opacity === '0') continue;

			if (el.tagName === 'path') {
				const d = el.getAttribute('d');
				if (d) parts.push('p:' + d);
			} else if (el.tagName === 'rect') {
				parts.push('r:' + [
					el.getAttribute('x'),
					el.getAttribute('y'),
					el.getAttribute('width'),
					el.getAttribute('height'),
					el.getAttribute('transform')
				].join(','));
			}
		}
		return parts.length === 0 ? null : parts.join('|');
	}

	// --- Grid Coordinate Parsing ----------------------------------------------

	// Parse a glyph <g> transform into grid col/row + orientation.
	// Board triangles use translate(x,y) with ~31.5px col spacing and ~54px row spacing.
	function parseGridPos(g) {
		const t = g.getAttribute('transform') || '';
		const m = t.match(/translate\(\s*([^,]+),\s*([^)]+)\)/);
		if (!m) return null;
		return {
			col: Math.round(parseFloat(m[1]) / 31.5),
			row: Math.round(parseFloat(m[2]) / 54),
			orientation: (t.includes('scale(1, -1)') || t.includes('scale(1,-1)')) ? 'down' : 'up'
		};
	}

	// --- Target Pattern Extraction --------------------------------------------

	// The target preview (TargetPreview SVG) contains 3-9 <g> children arranged
	// as a composite triangle. With 9 children the layout is:
	//
	//        [0]          (top, up)
	//     [1] [2] [3]     (mid-row: up, down, up)
	//   [4] [5] [6] [7] [8]  (bot-row: up, down, up, down, up)
	//
	// For fewer triangles (e.g. 3 = hardest mode) only a subset is shown.
	// We dynamically parse each child's translate/scale to derive grid positions,
	// pick the first "up" triangle as the anchor, and compute relative offsets
	// for all remaining triangles.

	// Hardcoded offsets for the 9-triangle case (proven to work).
	// Index 6 is the anchor. The 8 offsets are for indices 0-5, 7-8.
	const OFFSETS_9 = [
		{ dc:  0, dr: -2, orient: 'up'   },  // index 0
		{ dc: -1, dr: -1, orient: 'up'   },  // index 1
		{ dc:  0, dr:  0, orient: 'down'  },  // index 2
		{ dc:  1, dr: -1, orient: 'up'   },  // index 3
		{ dc: -2, dr:  0, orient: 'up'   },  // index 4
		{ dc: -1, dr:  1, orient: 'down'  },  // index 5
		// index 6 = anchor (skipped)
		{ dc:  1, dr:  1, orient: 'down'  },  // index 7
		{ dc:  2, dr:  0, orient: 'up'   },  // index 8
	];

	// Extract the target pattern dynamically from the TargetPreview SVG.
	// Works with any number of hint triangles (3, 5, 7, or 9).
	function getTargetPattern() {
		const groups = document.querySelectorAll(
			'[data-component-name="TargetPreview"] > g'
		);
		if (groups.length === 0) return null;

		// Fast path: 9-triangle case uses hardcoded offsets (proven)
		if (groups.length >= 9) {
			return {
				anchorFingerprint: glyphFingerprint(groups[6]),
				offsets: OFFSETS_9.map((off, i) => ({
					...off,
					fingerprint: glyphFingerprint(groups[i < 6 ? i : i + 1])
				}))
			};
		}

		// Dynamic path: parse grid positions from each preview triangle's transform
		const parsed = [];
		for (const g of groups) {
			const pos = parseGridPos(g);
			if (pos) {
				parsed.push({ ...pos, fingerprint: glyphFingerprint(g) });
			}
		}
		if (parsed.length === 0) return null;

		// Pick the most-centered "up" triangle as anchor (matches working script)
		// For the 3-triangle case (one up-top, one down-mid, one up-bottom),
		// this picks the bottom "up" triangle — which is the correct click target.
		const upTriangles = parsed.filter(p => p.orientation === 'up');
		if (upTriangles.length === 0) return null;

		// Calculate centroid of ALL parsed triangles
		const centroidCol = parsed.reduce((s, p) => s + p.col, 0) / parsed.length;
		const centroidRow = parsed.reduce((s, p) => s + p.row, 0) / parsed.length;

		// Pick the "up" triangle closest to the centroid
		let anchor = upTriangles[0];
		let bestDist = Infinity;
		for (const p of upTriangles) {
			const dist = Math.abs(p.col - centroidCol) + Math.abs(p.row - centroidRow);
			if (dist < bestDist) {
				bestDist = dist;
				anchor = p;
			}
		}

		// Build offsets relative to the anchor
		const offsets = [];
		for (let i = 0; i < parsed.length; i++) {
			if (parsed[i] === anchor) continue;
			const p = parsed[i];
			offsets.push({
				dc: p.col - anchor.col,
				dr: p.row - anchor.row,
				orient: p.orientation,
				fingerprint: p.fingerprint
			});
		}

		return {
			anchorFingerprint: anchor.fingerprint,
			offsets: offsets
		};
	}

	// --- Board Scanning -------------------------------------------------------

	// Build a Map of "col,row,orient" → { el, fingerprint, col, row, orientation }
	// from the WallBoard SVG.
	function buildBoardMap() {
		const map = new Map();
		const cells = document.querySelectorAll(
			'[data-component-name="WallBoard"] > g > g > g'
		);
		for (const g of cells) {
			const pos = parseGridPos(g);
			if (!pos) continue;
			const key = pos.col + ',' + pos.row + ',' + pos.orientation;
			map.set(key, {
				el: g,
				fingerprint: glyphFingerprint(g),
				col: pos.col,
				row: pos.row,
				orientation: pos.orientation
			});
		}
		return map;
	}

	// --- Candidate Finding ----------------------------------------------------

	// Find board positions where the target pattern matches (positive matching).
	// minMatches: minimum number of offset fingerprints that must match.
	// excludeSet: set of "col,row" strings to skip (previous false positives).
	// Missing neighbors count as mismatches (matches working script behavior).
	function findCandidates(boardMap, targetPattern, excludeSet, minMatches) {
		const { anchorFingerprint, offsets } = targetPattern;
		const totalHints = 1 + offsets.length;
		const results = [];

		for (const [, cell] of boardMap) {
			if (cell.orientation !== 'up') continue;
			if (excludeSet && excludeSet.has(cell.col + ',' + cell.row)) continue;

			let matches = 0;
			let mismatches = 0;

			// Check anchor fingerprint
			if (cell.fingerprint !== null && anchorFingerprint !== null) {
				if (cell.fingerprint === anchorFingerprint) matches++;
				else mismatches++;
			}

			// Check each offset
			for (const { dc, dr, orient, fingerprint } of offsets) {
				const neighbor = boardMap.get(
					(cell.col + dc) + ',' + (cell.row + dr) + ',' + orient
				);
				if (!neighbor) {
					// Missing neighbor = mismatch (matches working script)
					mismatches++;
				} else if (neighbor.fingerprint !== null && fingerprint !== null) {
					if (neighbor.fingerprint === fingerprint) matches++;
					else mismatches++;
				}
			}

			if (mismatches === 0 && matches >= minMatches) {
				results.push({
					col: cell.col, row: cell.row, matches, mismatches,
					isCompleteMatch: matches === totalHints
				});
			}
		}

		return results.sort((a, b) => b.matches - a.matches);
	}

	// Elimination-based candidate finding (matches working script's r() function).
	// Returns positions where NO offset has a definite mismatch or missing neighbor.
	// This is stricter than findCandidates and is used as a fallback when positive
	// matching returns 0 candidates — if only 1 position survives elimination, use it.
	function findByElimination(boardMap, targetPattern, excludeSet) {
		const { anchorFingerprint, offsets } = targetPattern;
		const results = [];

		for (const [, cell] of boardMap) {
			if (cell.orientation !== 'up') continue;
			if (excludeSet && excludeSet.has(cell.col + ',' + cell.row)) continue;

			let eliminated = false;

			// Check anchor
			if (cell.fingerprint !== null && anchorFingerprint !== null) {
				if (cell.fingerprint !== anchorFingerprint) eliminated = true;
			}

			// Check offsets
			if (!eliminated) {
				for (const { dc, dr, orient, fingerprint } of offsets) {
					const neighbor = boardMap.get(
						(cell.col + dc) + ',' + (cell.row + dr) + ',' + orient
					);
					if (!neighbor) {
						// Missing neighbor = eliminated
						eliminated = true;
						break;
					}
					if (neighbor.fingerprint !== null && fingerprint !== null) {
						if (neighbor.fingerprint !== fingerprint) {
							eliminated = true;
							break;
						}
					}
				}
			}

			if (!eliminated) {
				results.push({ col: cell.col, row: cell.row });
			}
		}

		return results;
	}

	// --- Click Simulation -----------------------------------------------------

	function clickCell(cellData) {
		const target = cellData.el.querySelector(
			'[data-sentry-component="GlyphBoundingTriangle"]'
		) || cellData.el;
		target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	}

	// --- State Snapshot (for detecting round changes) -------------------------

	function stateSnapshot() {
		const counterSpan = document.querySelector(
			'[data-sentry-element="SidebarCounterStyled"] span'
		);
		const targetPreview = document.querySelector(
			'[data-component-name="TargetPreview"]'
		);
		return (counterSpan?.textContent ?? '') + '||' +
			(targetPreview?.innerHTML ?? '').slice(0, 300);
	}

	// --- Wait for state change (round advance or game close) ------------------

	async function waitForStateChange(prevSnapshot, timeout) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			if (!findIceWallApp()) return true;
			if (stateSnapshot() !== prevSnapshot) return true;
			await sleep(100);
		}
		return false;
	}

	// --- Wait for unique match using MutationObserver -------------------------

	// Watches the board for mutations (glyph reveals) and resolves when exactly
	// one candidate remains. Resolves with the full boardMap, or null if the
	// game closes / board disappears.
	function waitForUniqueMatch(targetPattern, excludeSet, minMatches, timeout) {
		return new Promise((resolve) => {
			let done = false;
			let debounceTimer = null;
			let lastLogKey = ''; // dedup repeated logs

			function check() {
				if (done) return;

				const wallBoard = document.querySelector(
					'[data-component-name="WallBoard"]'
				);
				if (!wallBoard) {
					done = true;
					observer.disconnect();
					return resolve(null);
				}

				const boardMap = buildBoardMap();
				const candidates = findCandidates(boardMap, targetPattern, excludeSet, minMatches);

				// If positive matching found 0 candidates, try elimination
				if (candidates.length === 0) {
					const eliminated = findByElimination(boardMap, targetPattern, excludeSet);
					if (eliminated.length === 1) {
						done = true;
						observer.disconnect();
						console.log(
							'%c\uD83D\uDD13 [COR3 Helper] Eliminated to single candidate at col=' +
							eliminated[0].col + ' row=' + eliminated[0].row,
							'color: #a0d070; font-weight: bold'
						);
						return resolve(boardMap);
					}
					return; // keep watching
				}

				// Accept immediately if any candidate is a complete match
				if (candidates.some(c => c.isCompleteMatch)) {
					done = true;
					observer.disconnect();
					return resolve(boardMap);
				}

				if (candidates.length === 1) {
					done = true;
					observer.disconnect();
					return resolve(boardMap);
				}

				// Multiple candidates — log only when state changes to avoid spam
				const totalHints = 1 + targetPattern.offsets.length;
				const bestMatches = candidates[0].matches;
				const logKey = candidates.length + ':' + bestMatches;
				if (logKey !== lastLogKey) {
					lastLogKey = logKey;
					console.log(
						'%c\uD83D\uDD13 [COR3 Helper] ' + candidates.length +
						' candidates (best: ' + bestMatches + '/' + totalHints +
						' matches) — waiting for more reveals...',
						'color: #76C1D1'
					);
				}
			}

			function scheduleCheck() {
				if (done) return;
				clearTimeout(debounceTimer);
				debounceTimer = setTimeout(check, 80);
			}

			const wallBoard = document.querySelector('[data-component-name="WallBoard"]');
			if (!wallBoard) return resolve(null);

			const observer = new MutationObserver(scheduleCheck);
			observer.observe(wallBoard, { subtree: true, childList: true, attributes: true });

			// Also set a hard timeout
			setTimeout(() => {
				if (!done) {
					done = true;
					observer.disconnect();
					// On timeout, return the board map anyway so caller can try best candidate
					resolve(buildBoardMap());
				}
			}, timeout || 15000);

			// Run initial check immediately
			scheduleCheck();
		});
	}

	// --- Solve one round (with false-positive retry loop) --------------------

	async function solveRound(targetPattern, excludeSet, minMatches, roundLabel) {
		const MAX_RETRIES = 20;
		const roundTimerMs = getGameTimerMs();
		const roundStart = Date.now();

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			if (window.__iceWallSolverAbort) return;
			if (!findIceWallApp()) return;

			// Time remaining for this round — use it as the waitForUniqueMatch timeout
			const elapsed = Date.now() - roundStart;
			const remaining = Math.max(5000, roundTimerMs - elapsed);

			const boardMap = await waitForUniqueMatch(targetPattern, excludeSet, minMatches, remaining);
			if (!boardMap) return; // game closed

			// Try positive matching first
			const candidates = findCandidates(boardMap, targetPattern, excludeSet, minMatches);
			let best = null;

			if (candidates.length > 0) {
				// Prefer complete match, otherwise best candidate
				best = candidates.find(c => c.isCompleteMatch) || candidates[0];
				console.log(
					'%c\uD83D\uDD13 [COR3 Helper] \u2705 Match at col=' + best.col +
					' row=' + best.row + ' (' + best.matches + ' matches' +
					(best.isCompleteMatch ? ', complete' : '') + ')',
					'color: #8fb24e; font-weight: bold'
				);
				postStatus(roundLabel + ': clicking match (' + best.matches + ' hits)', 'info');
			} else {
				// Fallback: elimination-based matching
				const eliminated = findByElimination(boardMap, targetPattern, excludeSet);
				if (eliminated.length === 1) {
					best = eliminated[0];
					console.log(
						'%c\uD83D\uDD13 [COR3 Helper] \u2705 Eliminated to col=' + best.col +
						' row=' + best.row + ' (no other valid position)',
						'color: #a0d070; font-weight: bold'
					);
					postStatus(roundLabel + ': clicking eliminated match', 'info');
				} else {
					// No candidates from either method — wait for more reveals
					if (Date.now() - roundStart >= roundTimerMs) {
						console.warn('\u26a0\ufe0f [COR3 Helper] Round timer expired with no candidates');
						postStatus(roundLabel + ': timer expired, no match found', 'error');
						return;
					}
					console.log(
						'%c\uD83D\uDD13 [COR3 Helper] No candidates yet (' +
						(eliminated.length > 1 ? eliminated.length + ' survived elimination' : 'still scanning') +
						') — waiting for more reveals... (' +
						Math.round((roundTimerMs - (Date.now() - roundStart)) / 1000) + 's left)',
						'color: #76C1D1'
					);
					await sleep(500);
					continue;
				}
			}

			const anchorCell = boardMap.get(best.col + ',' + best.row + ',up');
			const snapshot = stateSnapshot();

			if (anchorCell) {
				clickCell(anchorCell);
			} else {
				console.warn('\uD83D\uDD13 [COR3 Helper] \u26a0\ufe0f Anchor cell not found after lock-in.');
			}

			// Wait for state to change (counter advance or new round)
			const changed = await waitForStateChange(snapshot, 4000);
			if (changed) return; // success — round advanced

			// False positive — mark this position as invalid and retry within this round
			console.warn(
				'\uD83D\uDD13 [COR3 Helper] \u26a0\ufe0f False positive at col=' + best.col +
				' row=' + best.row + ' — marking invalid and retrying (' +
				(attempt + 1) + '/' + MAX_RETRIES + ')...'
			);
			postStatus(roundLabel + ': false positive, retrying (' + (attempt + 1) + '/' + MAX_RETRIES + ')', 'warn');
			excludeSet.add(best.col + ',' + best.row);
		}
		console.warn('\uD83D\uDD13 [COR3 Helper] \u26a0\ufe0f Exhausted retries for this round');
		postStatus(roundLabel + ': exhausted retries', 'error');
	}

	// --- Main game solver (handles all rounds) --------------------------------

	// Build a combined fingerprint of the current round state: counter + target preview + board hash
	function roundFingerprint() {
		const counter = getRoundCounter();
		const targetPreview = document.querySelector('[data-component-name="TargetPreview"]');
		const targetInner = targetPreview ? targetPreview.innerHTML.slice(0, 500) : '';
		return counter + '||' + targetInner;
	}

	// Wait for a new round to appear (counter changes, target preview changes, or game closes)
	async function waitForNewRound(prevFingerprint, timeoutMs) {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (window.__iceWallSolverAbort) return 'abort';
			if (!findIceWallApp()) return 'closed';
			const current = roundFingerprint();
			if (current !== prevFingerprint) return 'changed';
			await sleep(150);
		}
		return 'timeout';
	}

	async function solveIceWallGame() {
		console.log(
			'%c\uD83D\uDD13 [COR3 Helper] Starting ICE Wall solver...',
			'color: #4ec9f3; font-weight: bold'
		);
		postStatus('ICE Wall solver started', 'info');

		let roundNum = 0;
		let lastFingerprint = '';
		const MAX_ROUNDS = 10; // safety cap

		while (findIceWallApp() && roundNum < MAX_ROUNDS) {
			if (window.__iceWallSolverAbort) return;

			const targetPattern = getTargetPattern();
			if (!targetPattern) {
				await sleep(200);
				continue;
			}

			// Detect if this is actually a new round (target preview or counter changed)
			const currentFingerprint = roundFingerprint();
			if (currentFingerprint === lastFingerprint) {
				// Same round still — wait for it to change
				await sleep(200);
				continue;
			}
			lastFingerprint = currentFingerprint;

			// Dynamic minimum matches based on hint count (matches working script):
			// Formula: max(2, ceil(hintCount / 3))
			// 3 hints → min 2, 5 hints → min 2, 7 hints → min 3, 9 hints → min 3
			const hintCount = 1 + targetPattern.offsets.length; // anchor + offsets
			const minMatches = Math.max(2, Math.ceil(hintCount / 3));

			roundNum++;
			const counter = getRoundCounter();
			const roundLabel = 'Round ' + roundNum + (counter ? ' (' + counter + ')' : '');
			console.log(
				'%c\uD83D\uDD13 [COR3 Helper] ' + roundLabel +
				' — searching (' + hintCount + ' hints, min ' + minMatches + ' matches)...',
				'color: #76C1D1; font-weight: bold'
			);
			postStatus(roundLabel + ': scanning (' + hintCount + ' hints)', 'info');

			const excludeSet = new Set();
			const preRoundFingerprint = currentFingerprint;
			await solveRound(targetPattern, excludeSet, minMatches, roundLabel);

			if (window.__iceWallSolverAbort) return;

			console.log(
				'%c\uD83D\uDD13 [COR3 Helper] ' + roundLabel + ' complete. Waiting for next round...',
				'color: #888; font-style: italic'
			);
			postStatus(roundLabel + ': complete', 'success');

			// Wait for the round to actually change (counter or target preview update)
			// This prevents re-entering the same round if the DOM hasn't updated yet
			const changeResult = await waitForNewRound(preRoundFingerprint, 8000);
			if (changeResult === 'abort') return;
			if (changeResult === 'closed') break;
			if (changeResult === 'timeout') {
				console.warn('\uD83D\uDD13 [COR3 Helper] \u26a0\ufe0f Timed out waiting for next round — checking if game is done');
				// Game might be done (all rounds completed), check if app is still present
				if (!findIceWallApp()) break;
				// Still present — force refresh fingerprint and continue
				lastFingerprint = '';
			}

			// Brief pause for DOM to settle before parsing next round
			await sleep(500);
		}

		const finishMsg = 'Finished (' + roundNum + ' round(s) completed)';
		console.log(
			'%c\uD83D\uDD13 [COR3 Helper] ' + finishMsg,
			'color: #8fb24e; font-weight: bold'
		);
		postStatus(finishMsg, 'success');
	}

	// --- Watcher --------------------------------------------------------------

	let pendingMinigameData = null;

	window.addEventListener('message', (event) => {
		if (event.data && event.data.type === 'COR3_ICE_WALL_MINIGAME_START') {
			pendingMinigameData = event.data.data;
			console.log(
				'%c\uD83D\uDD13 [COR3 Helper] ICE Wall minigame started!',
				'color: #4ec9f3; font-weight: bold',
				'Difficulty:', pendingMinigameData.meta?.staticParams?.difficulty,
				'Max Attempts:', pendingMinigameData.meta?.staticParams?.maxAttempts,
				'Timer:', pendingMinigameData.meta?.staticParams?.timerDurationMs + 'ms'
			);
		}
	});

	async function watchForIceWall() {
		console.log(
			'%c\uD83D\uDD13 [COR3 Helper] ICE Wall solver watching for minigame...',
			'color: #888; font-style: italic'
		);

		while (!window.__iceWallSolverAbort) {
			await sleep(500);

			const app = findIceWallApp();
			if (app) {
				console.log(
					'%c\uD83D\uDD13 [COR3 Helper] ICE Wall game detected in DOM!',
					'color: #4ec9f3; font-weight: bold'
				);

				// Wait for game to fully initialize (glyphs to render)
				await sleep(2000);

				if (window.__iceWallSolverAbort) break;

				await solveIceWallGame();

				if (window.__iceWallSolverAbort) break;

				// Wait for the game app to be removed from DOM
				console.log(
					'%c\u23f3 [COR3 Helper] Waiting for ICE Wall game to close...',
					'color: #888; font-style: italic'
				);
				while (!window.__iceWallSolverAbort && findIceWallApp()) {
					await sleep(100);
				}

				if (!window.__iceWallSolverAbort) {
					console.log(
						'%c\uD83D\uDD13 [COR3 Helper] ICE Wall game closed. Watching for next one...',
						'color: #888; font-style: italic'
					);
				}

				pendingMinigameData = null;
			}
		}

		// Cleanup when aborted
		window.__iceWallSolverActive = false;
		window.__iceWallSolverAbort = false;
		console.log(
			'%c\uD83D\uDED1 [COR3 Helper] ICE Wall solver stopped.',
			'color: #ff5555; font-weight: bold'
		);
	}

	watchForIceWall();
})();
