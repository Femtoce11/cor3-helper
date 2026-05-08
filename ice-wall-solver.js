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

	// The target preview (TargetPreview SVG) contains 9 <g> children arranged as
	// a large composite triangle:
	//
	//   Index layout (0-based):
	//        [0]          (top, up)
	//     [1] [2] [3]     (mid-row: up, down, up)
	//   [4] [5] [6] [7] [8]  (bot-row: up, down, up, down, up)
	//
	// Index 6 is the anchor (center of bottom row, orientation "up").
	// The 8 offsets describe where the other cells are relative to the anchor in
	// grid units (dc=delta-col, dr=delta-row).
	const OFFSETS = [
		{ dc:  0, dr: -2, orient: 'up'   },  // index 0
		{ dc: -1, dr: -1, orient: 'up'   },  // index 1
		{ dc:  0, dr:  0, orient: 'down'  },  // index 2  (same position as anchor, but inverted)
		{ dc:  1, dr: -1, orient: 'up'   },  // index 3
		{ dc: -2, dr:  0, orient: 'up'   },  // index 4
		{ dc: -1, dr:  1, orient: 'down'  },  // index 5
		// index 6 = anchor (skipped)
		{ dc:  1, dr:  1, orient: 'down'  },  // index 7
		{ dc:  2, dr:  0, orient: 'up'   },  // index 8
	];

	// Extract the target pattern: anchor fingerprint + 8 offset fingerprints.
	// Returns null if the target preview isn't ready or doesn't have 9 children.
	function getTargetPattern() {
		const groups = document.querySelectorAll(
			'[data-component-name="TargetPreview"] > g'
		);
		if (groups.length < 9) return null;

		return {
			anchorFingerprint: glyphFingerprint(groups[6]),
			offsets: OFFSETS.map((off, i) => ({
				...off,
				fingerprint: glyphFingerprint(groups[i < 6 ? i : i + 1])
			}))
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

	// Find board positions where the target pattern matches.
	// minMatches: minimum number of offset fingerprints that must match (default 3).
	// excludeSet: set of "col,row" strings to skip (previous false positives).
	function findCandidates(boardMap, targetPattern, excludeSet, minMatches) {
		const { anchorFingerprint, offsets } = targetPattern;
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
				if (neighbor && neighbor.fingerprint !== null && fingerprint !== null) {
					if (neighbor.fingerprint === fingerprint) matches++;
					else mismatches++;
				}
			}

			if (mismatches === 0 && matches >= minMatches) {
				results.push({ col: cell.col, row: cell.row, matches, mismatches });
			}
		}

		return results.sort((a, b) => b.matches - a.matches);
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

				if (candidates.length === 0) return; // keep watching

				if (candidates.length === 1) {
					done = true;
					observer.disconnect();
					return resolve(boardMap);
				}

				// Multiple candidates — log and keep waiting for more reveals
				console.log(
					'%c\uD83D\uDD13 [COR3 Helper] ' + candidates.length +
					' candidates (best: ' + candidates[0].matches + ' matches) — waiting for more reveals...',
					'color: #76C1D1'
				);
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

	// --- Solve one round ------------------------------------------------------

	async function solveRound(targetPattern, excludeSet, minMatches) {
		const boardMap = await waitForUniqueMatch(targetPattern, excludeSet, minMatches, 15000);
		if (!boardMap) return; // game closed

		const candidates = findCandidates(boardMap, targetPattern, excludeSet, minMatches);
		if (candidates.length === 0) {
			console.warn('\u26a0\ufe0f [COR3 Helper] No matching candidates found on board');
			return;
		}

		const best = candidates[0];
		console.log(
			'%c\uD83D\uDD13 [COR3 Helper] \u2705 Match at col=' + best.col +
			' row=' + best.row + ' (' + best.matches + ' matches)',
			'color: #8fb24e; font-weight: bold'
		);

		const anchorCell = boardMap.get(best.col + ',' + best.row + ',up');
		const snapshot = stateSnapshot();

		if (anchorCell) {
			clickCell(anchorCell);
		} else {
			console.warn('\uD83D\uDD13 [COR3 Helper] \u26a0\ufe0f Anchor cell not found after lock-in.');
		}

		// Wait for state to change (counter advance or new round)
		const changed = await waitForStateChange(snapshot, 4000);
		if (changed) return;

		// False positive — mark this position as invalid and retry
		console.warn(
			'\uD83D\uDD13 [COR3 Helper] \u26a0\ufe0f False positive at col=' + best.col +
			' row=' + best.row + ' — marking invalid and retrying...'
		);
		excludeSet.add(best.col + ',' + best.row);
	}

	// --- Main game solver (handles all rounds) --------------------------------

	async function solveIceWallGame() {
		console.log(
			'%c\uD83D\uDD13 [COR3 Helper] Starting ICE Wall solver...',
			'color: #4ec9f3; font-weight: bold'
		);

		let roundNum = 0;
		const MIN_MATCHES = 3;

		while (findIceWallApp()) {
			if (window.__iceWallSolverAbort) return;

			const targetPattern = getTargetPattern();
			if (!targetPattern) {
				await sleep(100);
				continue;
			}

			roundNum++;
			console.log(
				'%c\uD83D\uDD13 [COR3 Helper] Round ' + roundNum + ' — searching...',
				'color: #76C1D1; font-weight: bold'
			);

			const excludeSet = new Set();
			await solveRound(targetPattern, excludeSet, MIN_MATCHES);

			if (window.__iceWallSolverAbort) return;

			console.log(
				'%c\uD83D\uDD13 [COR3 Helper] Round ' + roundNum + ' complete. Waiting for next round...',
				'color: #888; font-style: italic'
			);
			await sleep(300);
		}

		console.log(
			'%c\uD83D\uDD13 [COR3 Helper] Finished (' + roundNum + ' round(s) completed).',
			'color: #8fb24e; font-weight: bold'
		);
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
