// --- Expedition Info + Decisions (inline) ---
import { getCor3Tab, formatTimeRemaining } from './utils.js';
import { el, clearEl, noDataMsg } from './dom-helpers.js';
import { updateExpeditionAlarmOptions } from './alarms.js';
import { refreshAllTimestamps } from './timestamps.js';
import { state } from './state.js';
import { savePinnedState, renderPinnedTimers } from './pinned-timers.js';

const expeditionInfoContainer = document.getElementById('expeditionInfoContainer');
const decisionsContainer = document.getElementById('decisionsContainer');
const decisionsSectionToggle = document.getElementById('decisionsSectionToggle');
const decisionsSectionBody = document.getElementById('decisionsSectionBody');
const getRidOfVeteransToggle = document.getElementById('getRidOfVeteransToggle');

let modifiersEnabled = true;
let savedLootMod = 1;
let savedRiskMod = -5;

const personalDroneSectionToggle = document.getElementById('personalDroneSectionToggle');
const personalDroneSectionBody = document.getElementById('personalDroneSectionBody');

personalDroneSectionToggle.addEventListener('click', async () => {
    personalDroneSectionToggle.classList.toggle('open');
    personalDroneSectionBody.classList.toggle('open');
});

decisionsSectionToggle.addEventListener('click', () => {
    decisionsSectionToggle.classList.toggle('open');
    decisionsSectionBody.classList.toggle('open');
});

// On popup open: load cached expeditions (no WS requests)
loadExpeditions();

export function setModifiers(enabled, loot, risk) {
    modifiersEnabled = enabled;
    savedLootMod = loot;
    savedRiskMod = risk;
}

export function getLootModifier() {
    return modifiersEnabled ? savedLootMod : 1;
}
export function getRiskModifier() {
    return modifiersEnabled ? savedRiskMod : -1;
}
export function calcOptionScore(opt, expeditionRiskScore, veteranOverride) {
    const lootMod = veteranOverride ? 1 : getLootModifier();
    const riskMod = veteranOverride ? 10 : getRiskModifier();
    return Math.round((opt.lootModifier * lootMod) + ((opt.riskModifier * riskMod) * (((expeditionRiskScore + Math.abs(opt.riskModifier)) / 10) || 1)));
}

let _cachedExpeditionsForVeteranCheck = null;
chrome.storage.local.get('expeditionsData', (data) => { _cachedExpeditionsForVeteranCheck = data.expeditionsData || null; });
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.expeditionsData) _cachedExpeditionsForVeteranCheck = changes.expeditionsData.newValue || null;
});

export function isVeteranExpedition(expeditionId) {
    if (!getRidOfVeteransToggle || !getRidOfVeteransToggle.checked) return false;
    if (!_cachedExpeditionsForVeteranCheck || !expeditionId) return false;
    const exps = Array.isArray(_cachedExpeditionsForVeteranCheck) ? _cachedExpeditionsForVeteranCheck : (_cachedExpeditionsForVeteranCheck.expeditions || []);
    const exp = exps.find(e => e.id === expeditionId);
    if (exp && exp.mercenary && (exp.mercenary.rank || '').toUpperCase() === 'VETERAN') return true;
    return false;
}

export function updateModifierDisplayValues() {
    const lootDisp = document.getElementById('modLootDisplay');
    const riskDisp = document.getElementById('modRiskDisplay');
    const defaultsNote = document.getElementById('modDefaultsNote');
    if (lootDisp) lootDisp.textContent = savedLootMod;
    if (riskDisp) riskDisp.textContent = savedRiskMod;
    if (defaultsNote) defaultsNote.style.display = (savedLootMod === 1 && savedRiskMod === -5) ? '' : 'none';
}

function renderExpeditionError(error) {
    const now = Date.now();
    if (error.noRetry) {
        return el('div', { className: 'warning-banner', style: 'background:rgba(255,80,80,0.15);border-color:var(--accent-red);color:var(--accent-red);' },
            el('div', { style: { fontWeight: 'bold', marginBottom: '4px' } }, '❌ Expedition Error'),
            el('div', { style: { fontSize: '10px' } }, error.error),
            el('div', { style: { fontSize: '10px', marginTop: '4px' } }, 'Re-enable auto-send mercenary to retry.')
        );
    }
    const retryAfter = error.retryAfter || 120000;
    const timeUntilRetry = Math.max(0, retryAfter - (now - error.timestamp));
    if (timeUntilRetry > 0) {
        const retryMinutes = Math.ceil(timeUntilRetry / 60000);
        return el('div', { className: 'warning-banner', style: 'background:rgba(255,165,0,0.15);border-color:var(--accent-orange);color:var(--accent-orange);' },
            el('div', { style: { fontWeight: 'bold', marginBottom: '4px' } }, '⚠️ Expedition Launch Failed'),
            el('div', { style: { fontSize: '10px' } }, error.error),
            el('div', { style: { fontSize: '10px', marginTop: '4px' } }, `Retrying in ${retryMinutes} minute${retryMinutes !== 1 ? 's' : ''}...`)
        );
    }
    chrome.storage.local.remove('expeditionLaunchError');
    return null;
}

function buildContainerItems(containerData) {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('div', { className: 'detail-row', style: 'color:var(--accent-green);font-weight:bold;' }, 'Items Found:'));
    for (const item of containerData) {
        const tierColor = item.tier === 'RARE' ? 'var(--accent-blue)' : item.tier === 'EPIC' ? 'var(--accent-purple,#a855f7)' : item.tier === 'LEGENDARY' ? 'var(--accent-orange)' : 'var(--text-dim)';
        const img = el('img', { src: item.imageUrl, style: 'width:32px;height:32px;border-radius:4px;background:rgba(255,255,255,0.05);' });
        img.onerror = function() { this.style.display = 'none'; };
        frag.appendChild(
            el('div', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;' },
                img,
                el('div', { style: 'flex:1;min-width:0;' },
                    el('div', { style: 'font-size:11px;font-weight:bold;color:var(--text-primary);' }, `${item.name} x${item.quantity}`),
                    el('div', { style: `font-size:9px;color:${tierColor};` }, item.tier)
                )
            )
        );
    }
    return frag;
}

export function renderExpeditionInfo(expeditions) {
    clearEl(expeditionInfoContainer);

    chrome.storage.local.get('expeditionLaunchError', (result) => {
        if (result.expeditionLaunchError) {
            const errorEl = renderExpeditionError(result.expeditionLaunchError);
            if (errorEl) expeditionInfoContainer.appendChild(errorEl);
        }
    });

    if (!expeditions || expeditions.length === 0) {
        if (!expeditionInfoContainer.hasChildNodes()) {
            expeditionInfoContainer.appendChild(noDataMsg('No active expeditions.'));
        }
        return;
    }

    for (const exp of expeditions) {
        if (exp.endTime) {
            state.expeditionEndTimes[exp.id] = exp.endTime;
        }

        const card = document.createElement('div');
        card.className = 'expedition-card';

        const statusClass = exp.status === 'RUNNING' ? ' running' : '';
        const mercName = exp.mercenary ? exp.mercenary.callsign : 'Unknown';
        const insurance = exp.hasInsurance ? 'Yes' : 'No';

        // Header
        const header = el('div', { className: 'exp-header' },
            el('span', { className: 'exp-title' }, `📍 ${exp.locationName || 'Unknown'} — ${exp.zoneName || 'Unknown'}`),
            el('span', { className: 'exp-status' + statusClass }, exp.status || 'UNKNOWN')
        );
        card.appendChild(header);

        const payAndOpenMsg = exp.messages && exp.messages.find(m => m.actionType === 'pay_and_open');
        const hasContainerData = exp.containerData && Array.isArray(exp.containerData) && exp.containerData.length > 0;

        if (hasContainerData) {
            card.appendChild(buildContainerItems(exp.containerData));
        } else if (payAndOpenMsg && exp.status === 'COMPLETED' && !exp.containerOpenedAt) {
            const ad = payAndOpenMsg.actionData || {};
            const row = el('div', { style: 'display:flex;align-items:center;gap:10px;' },
                el('div', { style: 'flex:1;' },
                    el('div', { className: 'detail-row' },
                        el('span', { className: 'label' }, 'Open Cost:'), ` 💰 ${(ad.cost || 0).toLocaleString()}`
                    ),
                    el('div', { className: 'detail-row' },
                        el('span', { className: 'label' }, 'Items Inside:'), ` 📦 ${ad.itemCount || '?'}`
                    )
                )
            );
            if (ad.containerImageUrl) {
                const cImg = el('img', { src: ad.containerImageUrl, style: 'width:48px;height:48px;border-radius:6px;background:rgba(255,255,255,0.05);' });
                cImg.onerror = function() { this.style.display = 'none'; };
                row.appendChild(cImg);
            }
            card.appendChild(row);
        } else {
            const mercRow = el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Mercenary:'), ` 🧑 ${mercName}`
            );
            if (exp.specialization === "PROSPECTOR") {
                mercRow.appendChild(el('span', { className: 'merc-elite-badge' }, 'ELITE'));
            }
            card.appendChild(mercRow);
            card.appendChild(el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Total Cost:'), ` 💰 ${exp.totalCost ? exp.totalCost.toLocaleString() : '--'}`
            ));
            card.appendChild(el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Insurance:'), ` ${insurance}`
            ));
            card.appendChild(el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Risk Score:'), ` ${exp.riskScore ?? '--'}`
            ));

            if (exp.endTime) {
                const timerSpan = el('span', { className: 'exp-timer', dataset: { expId: exp.id } }, formatTimeRemaining(exp.endTime));
                const pinBtn = el('button', { className: 'refresh-btn-small pin-btn pin-exp-btn', dataset: { expId: exp.id }, title: 'Pin Expedition Timer' }, '📌');
                card.appendChild(el('div', { className: 'exp-timer-row' },
                    el('span', { style: 'font-size:11px;color:var(--accent-orange);' }, '⏳ ', timerSpan),
                    pinBtn
                ));
            }
        }

        expeditionInfoContainer.appendChild(card);
    }

    // Wire up pin buttons
    expeditionInfoContainer.querySelectorAll('.pin-exp-btn').forEach(btn => {
        const expId = btn.dataset.expId;
        btn.classList.toggle('pinned', !!state.pinnedTimers['exp_' + expId]);
        btn.addEventListener('click', async () => {
            const key = 'exp_' + expId;
            state.pinnedTimers[key] = !state.pinnedTimers[key];
            btn.classList.toggle('pinned', !!state.pinnedTimers[key]);
            await savePinnedState();
            renderPinnedTimers();
        });
    });
}

export function renderDecisions(decisions) {
    clearEl(decisionsContainer);
    const countEl = document.getElementById('decisionsCount');

    if (!decisions || decisions.length === 0) {
        decisionsContainer.appendChild(noDataMsg('No pending decisions found.'));
        if (countEl) countEl.textContent = '';
        return;
    }

    const pending = decisions.filter(d => !d.isResolved);
    if (countEl) countEl.textContent = pending.length > 0 ? `(${pending.length} pending)` : '';

    let baseRisk = decisions[0].riskScore;
    let activeConfirmEl = null;
    let confirmTimeout = null;

    for (const d of decisions) {
        const card = document.createElement('div');
        card.className = 'decision-card';

        let statusTag;
        if (d.isResolved && d.isAutoResolved) {
            statusTag = el('span', { className: 'auto-resolved-tag' }, 'AUTO-RESOLVED');
        } else if (d.isResolved) {
            statusTag = el('span', { className: 'resolved-tag' }, 'RESOLVED');
        } else {
            statusTag = el('span', { className: 'pending-tag' }, 'PENDING');
        }

        const mercInfo = el('div', { className: 'merc-info' },
            `🧑 ${d.mercenaryCallsign} — ${d.locationName} / ${d.zoneName} `, statusTag
        );
        card.appendChild(mercInfo);
        card.appendChild(el('div', { className: 'msg-content' }, d.content));

        // Deadline
        const isExpired = d.decisionDeadline && new Date(d.decisionDeadline) <= new Date();
        if (d.decisionDeadline) {
            const dl = new Date(d.decisionDeadline);
            const diffMs = dl - new Date();
            if (diffMs > 0) {
                const mins = Math.floor(diffMs / 60000);
                const hrs = Math.floor(mins / 60);
                const remMins = mins % 60;
                card.appendChild(el('div', { className: 'deadline' }, `⏳ Deadline: ${hrs}h ${remMins}m remaining`));
            } else {
                card.appendChild(el('div', { className: 'deadline' }, '⏳ Deadline: Expired'));
            }
        }

        // Options
        const canClick = !d.isResolved && !isExpired;
        if (Array.isArray(d.decisionOptions)) {
            if (d.isResolved && d.selectedOption) {
                const selectedOpt = d.decisionOptions.find(o => o.id === d.selectedOption);
                if (selectedOpt) baseRisk -= selectedOpt.riskModifier;
            }

            for (const opt of d.decisionOptions) {
                const isSelected = d.selectedOption === opt.id;
                const isDefault = (d.isAutoResolved && d.selectedOption === opt.id);
                const riskSign = opt.riskModifier > 0 ? '+' : '';
                const lootSign = opt.lootModifier > 0 ? '+' : '';
                const vetOverride = isVeteranExpedition(d.expeditionId);
                const score = calcOptionScore(opt, d.isResolved ? baseRisk : d.riskScore, vetOverride);
                const selectedLabel = isSelected ? (isDefault ? " (⏳Expired⏳)" : ' ✓') : '';

                const optRow = el('div', {
                    className: 'option-row' + (isSelected ? ' option-selected' : '') + (canClick ? ' clickable' : ''),
                    dataset: { optId: opt.id, expId: d.expeditionId, msgId: d.messageId }
                },
                    el('span', { className: 'option-label' }, opt.label + selectedLabel),
                    el('span', { className: 'option-stats' },
                        el('span', { className: 'stat-risk' }, `Risk: ${riskSign}${opt.riskModifier}`),
                        el('span', { className: 'stat-loot' }, `Loot: ${lootSign}${opt.lootModifier}`),
                        el('span', { className: 'option-score' }, `${vetOverride ? '🎖️ ' : ''}Score: ${score >= 0 ? '+' : ''}${score}`)
                    )
                );

                if (canClick) {
                    optRow.addEventListener('click', async () => {
                        const optId = optRow.dataset.optId;
                        const expId = optRow.dataset.expId;
                        const msgId = optRow.dataset.msgId;
                        if (!optId || !expId || !msgId) return;

                        if (!optRow.classList.contains('confirming')) {
                            if (activeConfirmEl && activeConfirmEl !== optRow) {
                                activeConfirmEl.classList.remove('confirming');
                            }
                            if (confirmTimeout) clearTimeout(confirmTimeout);
                            optRow.classList.add('confirming');
                            activeConfirmEl = optRow;
                            confirmTimeout = setTimeout(() => {
                                optRow.classList.remove('confirming');
                                activeConfirmEl = null;
                            }, 3000);
                            return;
                        }

                        if (confirmTimeout) clearTimeout(confirmTimeout);
                        optRow.classList.remove('confirming');
                        activeConfirmEl = null;
                        optRow.style.opacity = '0.5';
                        try {
                            const tab = await getCor3Tab();
                            if (tab) {
                                await chrome.tabs.sendMessage(tab.id, {
                                    action: 'respondDecision',
                                    expeditionId: expId,
                                    messageId: msgId,
                                    selectedOption: optId
                                });
                                setTimeout(() => requestExpeditions(), 2000);
                            }
                        } catch (e) { /* not reachable */ }
                    });
                }

                card.appendChild(optRow);
            }
        }

        decisionsContainer.appendChild(card);
    }
}

const autoChosenDecisions = new Set();
var counter = 0;
export async function checkAutoChoose(decisions) {
    const autoChoose = document.getElementById('autoChooseCheckbox');
    if (!autoChoose || !autoChoose.checked) return;
    if (!decisions || decisions.length === 0) return;

    for (const d of decisions) {
        if (d.isResolved || !d.decisionDeadline || !Array.isArray(d.decisionOptions)) continue;
        if (autoChosenDecisions.has(d.messageId)) continue;
        const dl = new Date(d.decisionDeadline);
        const remaining = dl - Date.now();
        chrome.storage.local.set({ popupConsoleLog: "remaining time for decision -> " + remaining + " Counter: " + counter });
        if (remaining <= 0) continue;
        const noWaitCb = document.getElementById('noWaitAutoChooseCheckbox');
        const noWait = noWaitCb && noWaitCb.checked;
        if (!noWait && remaining > 60000) continue;

        const vetOverride = isVeteranExpedition(d.expeditionId);
        let bestOpt = null;
        let bestScore = -Infinity;
        for (const opt of d.decisionOptions) {
            const score = calcOptionScore(opt, d.riskScore, vetOverride);
            if (score > bestScore) {
                bestScore = score;
                bestOpt = opt;
            }
        }
        if (bestOpt) {
            autoChosenDecisions.add(d.messageId);
            try {
                const tab = await getCor3Tab();
                if (tab) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'respondDecision',
                        expeditionId: d.expeditionId,
                        messageId: d.messageId,
                        selectedOption: bestOpt.id
                    });
                    console.log(`[COR3 Helper] Auto-chose "${bestOpt.label}" (score: ${bestScore})`);
                }
            } catch (e) { /* silent */ }
        }
    }
}

export async function loadExpeditions() {
    const { expeditionsData, expeditionDecisions } = await chrome.storage.local.get(['expeditionsData', 'expeditionDecisions']);
    renderExpeditionInfo(expeditionsData || []);
    renderDecisions(expeditionDecisions || []);
    updateExpeditionAlarmOptions(expeditionsData || []);
    refreshAllTimestamps();

    setInterval(() => {
        chrome.storage.local.get('expeditionLaunchError', (result) => {
            if (result.expeditionLaunchError) {
                const error = result.expeditionLaunchError;
                const now = Date.now();
                const retryAfter = error.retryAfter || 120000;
                const timeUntilRetry = Math.max(0, retryAfter - (now - error.timestamp));

                if (timeUntilRetry <= 0) {
                    chrome.storage.local.remove('expeditionLaunchError');
                    loadExpeditions();
                }
            }
        });
    }, 30000);
}

export async function requestExpeditions() {
    expeditionInfoContainer.replaceChildren(noDataMsg('Loading expedition data...'));
    await chrome.storage.local.remove(['expeditionsData', 'expeditionDecisions']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
    } catch (e) { /* not reachable */ }
    let loaded = false;
    const poll = setInterval(async () => {
        const { expeditionsData } = await chrome.storage.local.get('expeditionsData');
        if (expeditionsData) {
            clearInterval(poll);
            if (loaded) return;
            loaded = true;
            await loadExpeditions();
        }
    }, 300);
    setTimeout(() => {
        clearInterval(poll);
        if (!loaded) {
            loaded = true;
            expeditionInfoContainer.replaceChildren(noDataMsg('No active expeditions.'));
            decisionsContainer.replaceChildren(noDataMsg('No pending decisions found.'));
        }
    }, 5000);
}
