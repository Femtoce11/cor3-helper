// Inventory: batch sell items filtered by rarity (single-select) + craft tag (single-select).
// Both filters must be chosen; selling requires a second confirmation click.
import { getCor3Tab } from './utils.js';

const invBatchRarity = document.getElementById('invBatchRarity');
const invBatchTag = document.getElementById('invBatchTag');
const invBatchCount = document.getElementById('invBatchCount');
const invBatchSellBtn = document.getElementById('invBatchSellBtn');

let _stashData = null;
let _invBatchSelling = false;
let _invBatchTimer = null;
let _invBatchConfirmTimer = null;

function inventoryBatchMatches() {
    if (!_stashData || !Array.isArray(_stashData.items)) return [];
    const rarity = invBatchRarity ? invBatchRarity.value : 'COMMON';
    const tag = invBatchTag ? invBatchTag.value : 'NONE';
    const wantCraft = tag === 'CRAFT';
    return _stashData.items.filter(it =>
        it.canSell && it.sellPrice && it.sellPrice > 0 &&
        (it.tier || '').toUpperCase() === rarity &&
        !!it.canCraft === wantCraft
    );
}

function updateInventoryBatchSell() {
    if (!invBatchCount || !invBatchSellBtn) return;
    const matches = inventoryBatchMatches();
    const count = matches.length;
    invBatchCount.textContent = count === 0 ? 'no matches' : count + ' item(s) · 💰 ' + matches.reduce((s, i) => s + (i.sellPrice * (i.quantity || 1)), 0).toLocaleString();
    if (!_invBatchSelling) {
        invBatchSellBtn.disabled = count === 0;
        invBatchSellBtn.style.opacity = count === 0 ? '0.4' : '';
        invBatchSellBtn.textContent = 'Sell';
        invBatchSellBtn.style.borderColor = 'var(--accent-green)';
        invBatchSellBtn.style.color = 'var(--accent-green)';
        invBatchSellBtn.classList.remove('inv-sell-confirm');
    }
}

function finishInventoryBatch() {
    if (!_invBatchSelling) return;
    _invBatchSelling = false;
    if (_invBatchTimer) { clearTimeout(_invBatchTimer); _invBatchTimer = null; }
    updateInventoryBatchSell();
}

async function loadBatchStash() {
    const { stashData } = await chrome.storage.local.get('stashData');
    _stashData = stashData || null;
    updateInventoryBatchSell();
}

if (invBatchRarity) invBatchRarity.addEventListener('change', updateInventoryBatchSell);
if (invBatchTag) invBatchTag.addEventListener('change', updateInventoryBatchSell);

if (invBatchSellBtn) {
    invBatchSellBtn.addEventListener('click', async () => {
        const matches = inventoryBatchMatches();
        if (matches.length === 0 || _invBatchSelling) return;

        if (!invBatchSellBtn.classList.contains('inv-sell-confirm')) {
            invBatchSellBtn.classList.add('inv-sell-confirm');
            invBatchSellBtn.textContent = 'Confirm sell ' + matches.length + '?';
            invBatchSellBtn.style.borderColor = 'var(--accent-orange)';
            invBatchSellBtn.style.color = 'var(--accent-orange)';
            if (_invBatchConfirmTimer) clearTimeout(_invBatchConfirmTimer);
            _invBatchConfirmTimer = setTimeout(() => updateInventoryBatchSell(), 4000);
            return;
        }

        if (_invBatchConfirmTimer) clearTimeout(_invBatchConfirmTimer);
        _invBatchSelling = true;
        invBatchSellBtn.classList.remove('inv-sell-confirm');
        invBatchSellBtn.disabled = true;
        invBatchSellBtn.textContent = 'Selling ' + matches.length + '…';
        invBatchSellBtn.style.opacity = '';
        _invBatchTimer = setTimeout(finishInventoryBatch, 60000);

        try {
            const tab = await getCor3Tab();
            if (!tab) { finishInventoryBatch(); return; }
            // Single-sell requests are sent while in the stash room — join it first
            try { await chrome.tabs.sendMessage(tab.id, { action: 'requestStash' }); } catch (e) { /* best effort */ }
            await new Promise(r => setTimeout(r, 2000));
            await new Promise((resolve) => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'batchSellItems',
                    items: matches.map(m => ({ itemId: m.id, quantity: m.quantity || 1 }))
                }, () => resolve());
            });
            await chrome.tabs.sendMessage(tab.id, { action: 'requestStash' });
            setTimeout(finishInventoryBatch, 1200);
        } catch (err) {
            console.log('[COR3 Helper] Batch sell error:', err);
            finishInventoryBatch();
        }
    });
}

// Refresh the summary whenever stash data changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.stashData) {
        _stashData = changes.stashData.newValue || null;
        updateInventoryBatchSell();
    }
});

loadBatchStash();
