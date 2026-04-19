// decrypt-solver.js
// Auto-solver for "decrypt" hacking minigame on cor3.gg
// Injected into MAIN world. Controllable via window.__solverAbort flag.

(function () {
	if (window.__solverActive) {
		console.warn('⚠️ Solver is already active. Aborting duplicate initialization.');
		return;
	}
	window.__solverActive = true;
	window.__solverAbort = false;

	// --- Utilities ------------------------------------------------------------
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	function reactSet(el, value) {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(el, value);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}

	async function submit(el, text) {
		reactSet(el, text);
		sleep(10);
		['keydown', 'keypress', 'keyup'].forEach((type) =>
			el.dispatchEvent(
				new KeyboardEvent(type, {
					key: 'Enter',
					code: 'Enter',
					keyCode: 13,
					charCode: type === 'keypress' ? 13 : 0,
					bubbles: true,
					cancelable: true
				})
			)
		);
	}

	function logLines() {
		const container = document.querySelector(
			'[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]'
		);
		return [...(container?.querySelectorAll('div') ?? [])].map((d) => d.textContent.trim()).filter(Boolean);
	}

	async function waitForResponse(inputEl, combo, timeout = 5000) {
		const pattern = new RegExp(
			`^Input: ${combo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nResult:\\nMismatched (\\d+)`
		);
		const start = Date.now();
		while (Date.now() - start < timeout && document.contains(inputEl)) {
			if (window.__solverAbort) return null;
			const lines = logLines();
			for (const line of lines) {
				const m = line.match(pattern);
				if (m) return parseInt(m[1]);
			}
			await sleep(100);
		}
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

		const placeholder = FIELDS.map((f) => f[0]).join(' ');
		const input = document.querySelector(`input[placeholder="${placeholder}"]`);

		if (!input) {
			console.error(`❌ Input field not found (looked for placeholder="${placeholder}")`);
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

		const doGuess = async (combo, label) => {
			if (window.__solverAbort) return null;
			console.log(`%c▶ [${label}] ${combo}`, 'color: #7c9ef3; font-weight: bold');
			await submit(input, combo);
			const val = await waitForResponse(input, combo);
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
			const m = await doGuess(buildCombo(allGuesses[bestGuessIdx], FIELDS), `guess ${++guessNum}`);

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
