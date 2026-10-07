// --- Helper-Only Mode ---
import { reRenderDecisions } from './modifiers.js';
import { loadMercenaries } from './mercenaries.js';
import { renderDebugJobs, renderDebugLogs } from './auto-job-solver-ui.js';
import { loadPinnedState } from './pinned-timers.js';
import { updateAutoUpdateMarketsStatus } from './ui-toggles.js';
import { state } from './state.js';

chrome.storage.sync.get('helperMode', (result) => {
    state.isHelper = result.helperMode;
});

let oldValues = {};
const helperModeToggle = document.getElementById('helperModeToggle');
export async function applyHelperMode(helper, mode) {
    state.isHelper = helper;
    if (state.isHelper) {console.log("Enabling helper mode!!");}
    else {console.log("Disabling helper mode!!");}

    const automationKeys = [
        'autoRefresh', 'autoJobSolverEnabled', 'autoFinishAllJobsEnabled',
        'autoJobsDebugConsoleEnabled', 'autoUpdateMarkets', 'decisionModifiers', 'autoSendMerc',
        'autoSellCheapest'
    ];

    if (mode === 'update') {
        let disabledValue = '';
        let value = '';
        if (state.isHelper) {
            oldValues = await chrome.storage.sync.get(automationKeys);
            chrome.storage.sync.set({ oldValues: oldValues });
        } else {
            oldValues = await chrome.storage.sync.get('oldValues');
        }
        console.log(JSON.stringify(oldValues));
        automationKeys.forEach(key => {
            if (key === 'autoRefresh') {
                disabledValue = {"dark_jobs":false,"home_jobs":false,"soyuz_jobs":false,"usol_jobs":false};
                value = state.isHelper ? disabledValue : (oldValues[key] ?? disabledValue);
                chrome.storage.sync.set({ [key]: value });
            } else if (key === 'autoSendMerc') {
                disabledValue = {"autoChooseMerc":false,"autoChooseUsolFirst":false,"insureHighRisk":false,"ignoreEliteMerc":false,"applyMercCostLimiter":false,"maxMercCost":15000,"disabledReason":null,"enabled":false,"mercenaryId":"","mercenaryName":""};
                value = state.isHelper ? disabledValue : (oldValues[key] ?? disabledValue);
                chrome.storage.sync.set({ [key]: value });
            } else if (key === 'decisionModifiers') {
                let loot = oldValues[key] ? (oldValues[key]).loot : 1;
                let risk = oldValues[key] ? (oldValues[key]).risk : -5;
                disabledValue = {"autoChoose":false,"enabled":false,"getRidOfVeterans":false,"loot":loot,"noWaitAutoChoose":false,"risk":risk};
                value = state.isHelper ? disabledValue : (oldValues[key] ?? disabledValue);
                chrome.storage.sync.set({ [key]: value });
            } else {
                value = state.isHelper ? false : (oldValues[key] ?? false);
                chrome.storage.sync.set({ [key]: value });
            }
        });

        reRenderDecisions();
        loadMercenaries();

        let toggles = {};
        try {
            toggles = await chrome.storage.sync.get(['autoRefresh', 'autoJobSolverEnabled', 'autoUpdateMarkets', 'autoFinishAllJobsEnabled', 'autoJobsDebugConsoleEnabled', 'decisionModifiers', 'autoSendMerc', 'autoSellCheapest']);
        } catch (err) {
            console.log("Couldn't find the related item on storage -> " + err);
        }

        // --- Update Toggles ---

        // Pinned Auto Refresh Timers

        (document.getElementById('autoRefreshCore')).checked = !!toggles.autoRefresh.home_jobs ?? false;
        (document.getElementById('autoRefreshDark')).checked = !!toggles.autoRefresh.dark_jobs ?? false;
        (document.getElementById('autoRefreshSoyuz')).checked = !!toggles.autoRefresh.soyuz_jobs ?? false;
        (document.getElementById('autoRefreshUsol')).checked = !!toggles.autoRefresh.usol_jobs ?? false;

        loadPinnedState()

        // Auto Jobs and Auto Update Markets

        (document.getElementById('autoJobSolverToggle')).checked = !!toggles.autoJobSolverEnabled ?? false;
        (document.getElementById('autoJobSolverStatus')).textContent = !!toggles.autoJobSolverEnabled ? 'Active' : 'Off';
        (document.getElementById('autoJobSolverStatus')).style.color = !!toggles.autoJobSolverEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
        (document.getElementById('autoUpdateMarketsToggle')).checked = !!toggles.autoUpdateMarkets ?? false;
        (document.getElementById('autoUpdateMarketsStatus')).textContent = !!toggles.autoUpdateMarkets ? 'Active' : 'Off';
        (document.getElementById('autoUpdateMarketsStatus')).style.color = !!toggles.autoUpdateMarkets ? 'var(--accent-green)' : 'var(--text-dim)';

        (document.getElementById('autoJobSolverSection')).style.display = !!toggles.autoJobSolverEnabled ? '' : 'none';

        (document.getElementById('autoFinishAllJobsToggle')).checked = !!toggles.autoFinishAllJobsEnabled ?? false;
        (document.getElementById('autoJobsDebugToggle')).checked =  !!toggles.autoJobsDebugConsoleEnabled ?? false;
        (document.getElementById('autoJobsDebugConsole')).style.display = !!toggles.autoJobsDebugConsoleEnabled ? '' : 'none';
        if (!!toggles.autoJobsDebugConsoleEnabled) {
            renderDebugJobs();
            renderDebugLogs();
        }

        updateAutoUpdateMarketsStatus();

        // Auto Decisions and Auto Mercs

        (document.getElementById('autoChooseCheckbox')).checked = !!toggles.decisionModifiers.autoChoose ?? false;
        (document.getElementById('noWaitAutoChooseCheckbox')).checked = !!toggles.decisionModifiers.noWaitAutoChoose ?? false;
        (document.getElementById('getRidOfVeteransToggle')).checked = !!toggles.decisionModifiers.getRidOfVeterans ?? false;

        (document.getElementById('autoSendMercenaryToggle')).checked = !!toggles.autoSendMerc.enabled ?? false;
        (document.getElementById('autoChooseMercToggle')).checked = !!toggles.autoSendMerc.autoChooseMerc ?? false;
        (document.getElementById('autoChooseUsolFirstToggle')).checked = !!toggles.autoSendMerc.autoChooseUsolFirst ?? false;
        (document.getElementById('insureHighRiskToggle')).checked = !!toggles.autoSendMerc.insureHighRisk ?? false;
        (document.getElementById('ignoreEliteMercToggle')).checked = !!toggles.autoSendMerc.ignoreEliteMerc ?? false;
        (document.getElementById('applyMercCostLimiterToggle')).checked = !!toggles.autoSendMerc.applyMercCostLimiter ?? false;
        (document.getElementById('maxMercCostInput')).value = toggles.autoSendMerc.maxMercCost ?? 15000;
        (document.getElementById('mercCostDisplayValue')).textContent = toggles.autoSendMerc.maxMercCost ?? 15000;
        (document.getElementById('autoSellCheapestToggle')).checked = !!toggles.autoSellCheapest ?? false;

    }

    // --- Update Toggle Rows, Checkbox and Container sections ---

    // Pinned Auto Refresh Timers

    (document.querySelectorAll('.pinned-auto-refresh')).forEach(element => {
        element.style.display = state.isHelper ? 'none' : 'flex';
    });

    // Auto Jobs and Auto Update Markets

    ['autoJobSolverToggle', 'autoValuableSellerToggle', 'autoUpdateMarketsToggle'].forEach(key => {
        ((document.getElementById(key)).closest('.auto-decrypt-row')).style.display = state.isHelper ? 'none' : 'flex';
    });

    // Auto Decisions and Auto Mercs

    ['noWaitAutoChooseCheckbox', 'autoChooseCheckbox', 'autoSellCheapestToggle', 'autoChooseMercToggle', 'autoChooseUsolFirstToggle', 'insureHighRiskToggle', 'ignoreEliteMercToggle', 'applyMercCostLimiterToggle', 'getRidOfVeteransToggle', 'autoSendMercenaryToggle'].forEach(key => {
        ((document.getElementById(key)).closest('.auto-choose-row')).style.display = state.isHelper ? 'none' : 'flex';
    });

    // Hide merc cost display/edit rows in helper mode
    if (document.getElementById('mercCostDisplay')) document.getElementById('mercCostDisplay').style.display = state.isHelper ? 'none' : '';
    if (document.getElementById('mercCostEditRow')) document.getElementById('mercCostEditRow').style.display = 'none';

    (document.getElementById('mercenariesContainer')).querySelectorAll('.merc-card').forEach(c => c.classList.remove('selected'));

}
if (helperModeToggle) {
    chrome.storage.sync.get('helperMode', (result) => {
        helperModeToggle.checked = result.helperMode || false;
        applyHelperMode(helperModeToggle.checked, 'render');
    });
    helperModeToggle.addEventListener('change', () => {
        state.isHelper = helperModeToggle.checked;
        chrome.storage.sync.set({ helperMode: state.isHelper });
        applyHelperMode(state.isHelper, 'update');
    });
}
