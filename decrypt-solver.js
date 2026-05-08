// decrypt-solver.js
// Auto-solver for "decrypt" hacking minigame on cor3.gg
// Injected into MAIN world. Controllable via window.__solverAbort flag.
// Updated for the new arrow-key-based UI (no text input).

(function () {
	if (window.__solverActive) {
		console.warn('⚠️ Solver is already active. Aborting duplicate initialization.');
		return;
	}
	window.__solverActive = true;
	window.__solverAbort = false;

	// --- Utilities ------------------------------------------------------------
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	// Dispatch a keyboard event on an element (repeat count times)
	async function dispatchKey(el, key, keyCode, count = 1) {
		for (let i = 0; i < count; i++) {
			['keydown', 'keypress', 'keyup'].forEach((type) =>
				el.dispatchEvent(
					new KeyboardEvent(type, {
						key: key,
						code: key,
						keyCode: keyCode,
						charCode: type === 'keypress' ? keyCode : 0,
						bubbles: true,
						cancelable: true
					})
				)
			);
			if (count > 1) await sleep(1);
		}
	}

	// Find the hack application container
	function findHackContainer() {
		return document.querySelector('[data-sentry-component="ConfigHackApplication"]');
	}

	// Read current field values from the ParameterCells buttons
	function getCurrentFieldValues() {
		return [
			...(document.querySelectorAll(
				'[data-sentry-component="ParameterCells"] button[type="button"]'
			) ?? [])
		]
			.filter((btn) => btn.getAttribute('data-sentry-element') !== 'SendButtonStyled')
			.map((btn) => {
				const spans = btn.querySelectorAll('span');
				return spans.length >= 2 ? spans[1].textContent.trim() : null;
			});
	}

	// Submit a guess using arrow key navigation
	// fields = array of arrays (options per field), indices = array of target option indices
	async function submitGuess(fields, indices) {
		const container = findHackContainer();
		if (!container) {
			console.warn('⚠️ [submitGuess] Hack container not found.');
			return false;
		}

		// Focus the container and reset cursor to first field
		container.focus();
		await sleep(1);
		await dispatchKey(container, 'ArrowLeft', 37, fields.length);
		await sleep(1);

		for (let f = 0; f < fields.length; f++) {
			// Move right to next field (skip for first)
			if (f > 0) {
				await dispatchKey(container, 'ArrowRight', 39);
				await sleep(1);
			}

			const currentValues = getCurrentFieldValues();
			const currentVal = currentValues[f];
			const targetIdx = indices[f];
			const options = fields[f];
			const currentIdx = options.indexOf(currentVal);

			if (currentIdx === -1) {
				console.warn(`⚠️ [submitGuess] Field ${f}: current value "${currentVal}" not found in options [${options.join(', ')}]`);
			}

			// Already at target? Skip navigation
			if (currentIdx === targetIdx) continue;

			// Navigate to target using shortest path (up or down)
			const numOpts = options.length;
			const downSteps = ((currentIdx - targetIdx) % numOpts + numOpts) % numOpts;
			const upSteps = ((targetIdx - currentIdx) % numOpts + numOpts) % numOpts;

			if (downSteps <= upSteps) {
				await dispatchKey(container, 'ArrowDown', 40, downSteps);
			} else {
				await dispatchKey(container, 'ArrowUp', 38, upSteps);
			}
			await sleep(10);

			// Verify navigation landed correctly
			const newValues = getCurrentFieldValues();
			const newVal = newValues[f];
			const expectedVal = options[targetIdx];
			if (newVal !== expectedVal) {
				console.warn(`⚠️ [submitGuess] Field ${f}: expected "${expectedVal}" after navigation but got "${newVal}". Aborting guess.`);
				return false;
			}
		}

		// Press Enter to submit
		await sleep(1);
		await dispatchKey(container, 'Enter', 13);
		return true;
	}

	function logLines() {
		const container = document.querySelector(
			'[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]'
		);
		return [...(container?.querySelectorAll('div') ?? [])].map((d) => d.textContent.trim()).filter(Boolean);
	}

	async function waitForResponse(combo, timeout = 5000) {
		const pattern = new RegExp(
			`^Input: ${combo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nResult:\\nMismatched (\\d+)`
		);
		const start = Date.now();
		while (Date.now() - start < timeout) {
			if (window.__solverAbort) return null;
			if (!findHackContainer()) {
				console.warn('⚠️ [waitForResponse] Hack container disappeared while waiting.');
				return null;
			}
			const lines = logLines();
			for (const line of lines) {
				const m = line.match(pattern);
				if (m) return parseInt(m[1]);
			}
			await sleep(100);
		}
		console.warn(`⚠️ [waitForResponse] Timed out after ${timeout}ms waiting for combo: "${combo}"`);
		return null;
	}

	function buildCombo(indices, fields) {
		return indices.map((vi, fi) => fields[fi][vi]).join(' ');
	}

	function detectFields(lines) {
		const fields = [];
		for (const line of lines) {
			const m = line.match(/→\s*(.+)/);
			if (m) {
				fields.push(m[1].split('/').map((s) => s.trim()));
			}
		}
		return fields;
	}

	function generateAllCombinations(numFields, optsPerField) {
		let results = [[]];
		for (let i = 0; i < numFields; i++) {
			const next = [];
			for (const r of results) {
				for (let j = 0; j < optsPerField[i]; j++) {
					next.push([...r, j]);
				}
			}
			results = next;
		}
		return results;
	}

	// --- Solver Cache ---------------------------------------------------------

	let cachedSolver = null;

	function getOrCreateSolver(FIELDS) {
		const key = FIELDS.map((f) => f.join('|')).join('||');
		if (cachedSolver && cachedSolver.key === key) return cachedSolver;

		const numFields = FIELDS.length;
		const allGuesses = generateAllCombinations(
			numFields,
			FIELDS.map((f) => f.length)
		);
		const N = allGuesses.length;

		const distMatrix = new Uint8Array(N * N);
		for (let i = 0; i < N; i++) {
			for (let j = i; j < N; j++) {
				let d = 0;
				for (let k = 0; k < numFields; k++) {
					if (allGuesses[i][k] !== allGuesses[j][k]) d++;
				}
				distMatrix[i * N + j] = d;
				distMatrix[j * N + i] = d;
			}
		}

		const memo = new Map();

		cachedSolver = { key, distMatrix, memo, allGuesses, N, numFields };
		return cachedSolver;
	}

	// --- Solver ---------------------------------------------------------------

	async function runSolver() {
		if (window.__solverAbort) return;

		const lines = logLines();
		const FIELDS = detectFields(lines);

		if (FIELDS.length === 0) {
			console.warn('⚠️ Could not detect fields from logs.');
			return;
		}

		console.log(
			'%c📋 Detected fields:',
			'color: #b08944; font-weight: bold',
			FIELDS.map((f, i) => `\n   ${i}: [${f.join(', ')}]`).join('')
		);

		if (!findHackContainer()) {
			console.error('❌ Hack container not found');
			return;
		}

		const solver = getOrCreateSolver(FIELDS);
		const { distMatrix, memo, allGuesses, N, numFields } = solver;
		const getDist = (a, b) => distMatrix[a * N + b];

		if (solver.key === cachedSolver.key && memo.size > 0) {
			console.log('%c♻️ Reusing cached solver', 'color: #8fb24e; font-weight: bold');
		}

		// --- Minimax with Pruning ---
		function getBestGuess(possibilities, parentBest = Infinity) {
			if (possibilities.length === 1) {
				return { guess: possibilities[0], depth: 1 };
			}

			const key = possibilities.join(',');
			if (memo.has(key)) return memo.get(key);

			let bestDepth = Infinity;
			let bestGuess = -1;

			for (let g = 0; g < N; g++) {
				const partitions = new Array(numFields + 1);
				for (let i = 0; i <= numFields; i++) partitions[i] = [];

				let isPossibleAnswer = false;

				for (let i = 0; i < possibilities.length; i++) {
					const p = possibilities[i];
					const d = getDist(g, p);
					if (d === 0) {
						isPossibleAnswer = true;
					} else {
						partitions[d].push(p);
					}
				}

				let dominated = false;
				for (let d = 1; d <= numFields; d++) {
					if (partitions[d].length === possibilities.length) {
						dominated = true;
						break;
					}
				}
				if (dominated) continue;

				let currentMax = isPossibleAnswer ? 1 : 0;
				let aborted = false;

				for (let d = 1; d <= numFields; d++) {
					if (partitions[d].length === 0) continue;

					const res = getBestGuess(partitions[d], bestDepth);
					const candidate = res.depth + 1;
					if (candidate > currentMax) currentMax = candidate;

					if (currentMax > bestDepth || currentMax >= parentBest) {
						aborted = true;
						break;
					}
				}

				if (aborted) continue;

				if (currentMax < bestDepth) {
					bestDepth = currentMax;
					bestGuess = g;
				} else if (currentMax === bestDepth) {
					const newInSet = possibilities.includes(g);
					const curInSet = possibilities.includes(bestGuess);
					if (newInSet && !curInSet) {
						bestGuess = g;
					}
				}
			}

			const result = { guess: bestGuess, depth: bestDepth };
			memo.set(key, result);
			return result;
		}

		// --- Game loop ---
		let possibilities = Array.from({ length: N }, (_, i) => i);
		let guessNum = 0;

		const doGuess = async (guessIndices, label) => {
			if (window.__solverAbort) return null;
			const combo = buildCombo(guessIndices, FIELDS);
			console.log(`%c▶ [${label}] ${combo}`, 'color: #7c9ef3; font-weight: bold');
			const ok = await submitGuess(FIELDS, guessIndices);
			if (!ok) {
				console.info(`❌ Failed to submit guess for ${label}`);
				return null;
			}
			const val = await waitForResponse(combo);
			if (val === null) {
				console.info(`❌ Mismatch count not found for ${label}`);
			} else {
				console.log(`   Mismatch: ${val}`);
			}
			return val;
		};

		while (possibilities.length > 0) {
			if (window.__solverAbort) return;

			const best = getBestGuess(possibilities);
			const bestGuessIdx = best.guess;
			const m = await doGuess(allGuesses[bestGuessIdx], `guess ${++guessNum}`);

			if (m == null || m === 0) return;

			possibilities = possibilities.filter((p) => getDist(bestGuessIdx, p) === m);

			if (possibilities.length === 0) {
				console.error('❌ No possibilities left. Something went wrong.');
				return;
			}
		}
	}

	// --- Watcher --------------------------------------------------------------

	async function waitForMinigame() {
		console.log('%c👀 [COR3 Helper] Decrypt solver watching for minigame...', 'color: #888; font-style: italic');
		getOrCreateSolver([
			['v1.0', 'v1.1', 'v2.0'],
			['GET', 'PUT', 'POST'],
			['LTE', 'Fiber', 'Sat'],
			['AES', 'RSA', 'DES']
		]);

		while (!window.__solverAbort) {
			await sleep(250);

			const container = document.querySelector(
				'[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]'
			);

			if (container) {
				const lines = logLines();
				const isReady = lines.length > 0 && lines[lines.length - 1].startsWith('Attempts:');

				if (isReady) {
					console.log('%c✅ [COR3 Helper] Minigame detected, starting solver...', 'color: #8fb24e; font-weight: bold');
					await runSolver();

					if (window.__solverAbort) break;

					console.log('%c⏳ [COR3 Helper] Waiting for minigame to close...', 'color: #888; font-style: italic');
					while (
						!window.__solverAbort &&
						document.querySelector(
							'[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]'
						)
					) {
						await sleep(100);
					}

					if (!window.__solverAbort) {
						console.log('%c👀 [COR3 Helper] Minigame closed. Watching for next one...', 'color: #888; font-style: italic');
					}
				}
			}
		}

		// Cleanup when aborted
		window.__solverActive = false;
		window.__solverAbort = false;
		console.log('%c🛑 [COR3 Helper] Decrypt solver stopped.', 'color: #ff5555; font-weight: bold');
	}

	waitForMinigame();
})();
