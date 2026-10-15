// Loadout orchestration for auto-valuable-seller.
// Uses shared pure-computation from loadout-resolver.js,
// combined with async WS interactions from state.js wired utilities.

import {
    sendCmd, delay, waitForEvent, log, humanDelay,
    _cachedLoadout, _cachedLoadoutAt, _lastLoadoutFetchAt,
    LOADOUT_COOLDOWN_MS,
    setCachedLoadout, setLastLoadoutFetchAt, invalidateLoadoutCache,
    getServerName
} from './state.js';

import {
    findBestSoftwareLoadout, hardwareMatches,
    findHackSoftwareForServerType, findSearchSoftwareForServerType,
    getServerTypeName
} from '../shared/loadout-resolver.js';

// ---- Loadout data fetching ----

export async function getLoadoutData(forceRefresh) {
    if (!forceRefresh && _cachedLoadout && (Date.now() - _cachedLoadoutAt < 60000)) {
        return _cachedLoadout;
    }
    var sinceLastFetch = Date.now() - _lastLoadoutFetchAt;
    if (sinceLastFetch < LOADOUT_COOLDOWN_MS && _cachedLoadout) {
        return _cachedLoadout;
    }
    log('Loadout: requesting fresh data via WS...');
    setLastLoadoutFetchAt(Date.now());
    sendCmd('loadout.get', {});
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_LOADOUT', 15000);
        if (resp.data) {
            setCachedLoadout(resp.data);
            return resp.data;
        }
    } catch (e) {
        log('Loadout: fetch timeout', 'warn');
    }
    return _cachedLoadout || null;
}

// ---- Apply loadout change (unequip/equip hardware+software) ----

export async function applyLoadoutChange(loadout, targetHw, targetSwIds) {
    log('Loadout: applying change — target sw count: ' + targetSwIds.length);
    var currentHw = loadout.equippedHardware || {};
    var currentSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var changed = false;

    // 1. Unequip software that is NOT in targetSwIds
    for (var ui = 0; ui < currentSwIds.length; ui++) {
        if (targetSwIds.indexOf(currentSwIds[ui]) >= 0) continue;
        var unequipName = currentSwIds[ui];
        var eqSw = loadout.equippedSoftware || [];
        for (var un = 0; un < eqSw.length; un++) {
            if (eqSw[un].id === currentSwIds[ui]) { unequipName = eqSw[un].name + ' (' + currentSwIds[ui] + ')'; break; }
        }
        log('Loadout: unequipping software ' + unequipName);
        sendCmd('loadout.unequip.software', { moduleConfigId: currentSwIds[ui] });
        await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
        await delay(500);
        changed = true;
    }

    // 2. Equip hardware if changed — smart order to avoid PSU rejection
    var hwChanges = [];
    var hwSlots = ['cpu', 'gpu', 'ram', 'psu'];
    for (var hci = 0; hci < hwSlots.length; hci++) {
        var hSlot = hwSlots[hci];
        var hCurId = currentHw[hSlot] ? currentHw[hSlot].id : null;
        var hTgtId = targetHw[hSlot] ? targetHw[hSlot].id : null;
        if (hTgtId && hTgtId !== hCurId) {
            var curConsume = 0, tgtConsume = 0;
            if (hSlot === 'cpu') { curConsume = currentHw.cpu ? (currentHw.cpu.specs.cpuConsuming || 0) : 0; tgtConsume = targetHw.cpu.specs.cpuConsuming || 0; }
            if (hSlot === 'gpu') { curConsume = currentHw.gpu ? (currentHw.gpu.specs.gpuConsuming || 0) : 0; tgtConsume = targetHw.gpu.specs.gpuConsuming || 0; }
            hwChanges.push({ slot: hSlot, id: hTgtId, name: targetHw[hSlot].name || hTgtId, delta: tgtConsume - curConsume, isPsu: hSlot === 'psu' });
        }
    }
    var psuUpgrade = hwChanges.find(function (c) { return c.isPsu && targetHw.psu && currentHw.psu && (targetHw.psu.specs.psuPower || 0) > (currentHw.psu.specs.psuPower || 0); });
    var orderedHwChanges = [];
    if (psuUpgrade) orderedHwChanges.push(psuUpgrade);
    hwChanges.sort(function (a, b) { return a.delta - b.delta; });
    for (var hoi = 0; hoi < hwChanges.length; hoi++) {
        if (hwChanges[hoi] !== psuUpgrade) orderedHwChanges.push(hwChanges[hoi]);
    }
    for (var hi = 0; hi < orderedHwChanges.length; hi++) {
        var hc = orderedHwChanges[hi];
        log('Loadout: equipping ' + hc.slot.toUpperCase() + ' \u2192 ' + hc.name);
        sendCmd('loadout.equip.hardware', { moduleConfigId: hc.id });
        await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
        await delay(500);
        changed = true;
    }

    // 3. Equip target software
    for (var ei = 0; ei < targetSwIds.length; ei++) {
        var swName = '';
        var allSw = loadout.ownedSoftware || [];
        for (var k = 0; k < allSw.length; k++) {
            if (allSw[k].id === targetSwIds[ei]) { swName = allSw[k].name; break; }
        }
        log('Loadout: equipping software ' + swName + ' (' + targetSwIds[ei] + ')');
        sendCmd('loadout.equip.software', { moduleConfigId: targetSwIds[ei] });
        await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
        await delay(500);
        changed = true;
    }

    if (changed) {
        return await getLoadoutData(true);
    }
    return loadout;
}

// ---- Ensure hack-only loadout for a server ----

export async function ensureHackOnlyLoadout(serverId, getLoginStatusFn) {
    var serverTypeName = getServerTypeName(serverId);
    if (!serverTypeName) {
        log('Loadout: cannot determine server type for ' + getServerName(serverId) + ' \u2014 skipping hack loadout');
        return { ok: false, reason: 'unknown-server-type' };
    }

    var serverDefenceRate = 0;
    try {
        var preLoginData = await getLoginStatusFn(serverId);
        if (preLoginData && preLoginData.serverDefenceRate) {
            serverDefenceRate = preLoginData.serverDefenceRate;
        }
    } catch (e) { }

    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: could not fetch loadout data \u2014 proceeding without hack loadout', 'warn');
        return { ok: false, reason: 'no-loadout-data' };
    }

    var allSw = loadout.ownedSoftware || [];
    var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
    if (hackCandidates.length === 0) {
        log('Loadout: no HACK software available for ' + serverTypeName, 'warn');
        return { ok: false, reason: 'no-hack-software' };
    }

    var bestHack = findBestSoftwareLoadout(loadout, hackCandidates, 'HACK');
    if (!bestHack) {
        log('Loadout: no bootable hack software available for ' + serverTypeName, 'warn');
        return { ok: false, reason: 'cannot-boot' };
    }
    log('Loadout: found ' + hackCandidates.length + ' hack candidate(s) for ' + serverTypeName + ' \u2014 best: ' + bestHack.sw.name + ' (power ' + bestHack.power + '/' + bestHack.spec.power[1] + ')');

    var targetSwIds = [bestHack.sw.id];
    var currentHw = loadout.equippedHardware || {};
    var alreadyBest = equippedSwIds.length === 1 && equippedSwIds[0] === bestHack.sw.id &&
        hardwareMatches(currentHw, bestHack.hardware);

    if (alreadyBest) {
        log('Loadout: best HACK software "' + bestHack.sw.name + '" already equipped alone (power ' + bestHack.power + ')');
    }
    if (serverDefenceRate > 0) {
        log('Loadout: hack power comparison \u2014 hackPower: ' + bestHack.power + ' vs serverDefenceRate: ' + serverDefenceRate + (bestHack.power >= serverDefenceRate ? ' \u2713' : ' \u2717 INSUFFICIENT'));
    } else {
        log('Loadout: computed hack power: ' + bestHack.power + ' (serverDefenceRate unknown)');
    }

    if (serverDefenceRate > 0 && bestHack.power < serverDefenceRate) {
        log('Loadout: cannot reach required hack power (' + serverDefenceRate + ') \u2014 best achievable: ' + bestHack.power, 'error');
        return { ok: false, reason: 'insufficient-power', hackPower: bestHack.power, defenceRate: serverDefenceRate };
    }

    if (!alreadyBest) {
        log('Loadout: equipping HACK software "' + bestHack.sw.name + '" (power ' + bestHack.power + '/' + bestHack.spec.power[1] + ') for ' + serverTypeName);
        await applyLoadoutChange(loadout, bestHack.hardware, targetSwIds);
    }
    return { ok: true, hackPower: bestHack.power, defenceRate: serverDefenceRate };
}

// ---- Ensure search-only loadout for a server ----

export async function ensureSearchOnlyLoadout(serverId) {
    var serverTypeName = getServerTypeName(serverId);
    if (!serverTypeName) {
        log('Loadout: cannot determine server type for ' + getServerName(serverId) + ' \u2014 skipping search loadout');
        return;
    }

    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: could not fetch loadout data \u2014 proceeding without search loadout', 'warn');
        return;
    }

    var allSw = loadout.ownedSoftware || [];
    var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var searchCandidates = findSearchSoftwareForServerType(allSw, serverTypeName);
    if (searchCandidates.length === 0) {
        log('Loadout: no SEARCH software available for ' + serverTypeName);
        return;
    }

    var bestSearch = findBestSoftwareLoadout(loadout, searchCandidates, 'SEARCH');
    if (!bestSearch) {
        log('Loadout: no bootable search software available for ' + serverTypeName, 'warn');
        return;
    }

    var targetSwIds = [bestSearch.sw.id];
    var swAlreadyOk = equippedSwIds.length === 1 && equippedSwIds[0] === bestSearch.sw.id;
    var curHw = loadout.equippedHardware || {};
    var hwAlreadyOk = hardwareMatches(curHw, bestSearch.hardware);
    if (swAlreadyOk && hwAlreadyOk) {
        log('Loadout: best SEARCH software "' + bestSearch.sw.name + '" already equipped with optimal hardware (power: ' + bestSearch.power + '/' + bestSearch.spec.power[1] + ')');
        return bestSearch.power;
    }

    log('Loadout: equipping SEARCH software "' + bestSearch.sw.name + '" (computed power: ' + bestSearch.power + '/' + bestSearch.spec.power[1] + ') for ' + serverTypeName);
    await applyLoadoutChange(loadout, bestSearch.hardware, targetSwIds);
    return bestSearch.power;
}

// ---- Try hack loadout swap after sai-hack-impossible ----

export async function tryHackLoadoutSwap(serverId, getLoginStatusFn) {
    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: cannot retry \u2014 no loadout data available', 'warn');
        return false;
    }

    var serverTypeName = getServerTypeName(serverId);
    if (!serverTypeName) {
        log('Loadout: cannot determine server type for ' + getServerName(serverId), 'warn');
        return false;
    }

    var allSw = loadout.ownedSoftware || [];
    var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
    if (hackCandidates.length === 0) {
        log('Loadout: no hack software available for ' + serverTypeName, 'warn');
        return false;
    }

    var serverDefenceRate = 0;
    try {
        var loginStatus = await getLoginStatusFn(serverId, true);
        if (loginStatus && loginStatus.serverDefenceRate) {
            serverDefenceRate = loginStatus.serverDefenceRate;
        }
    } catch (e) { }

    var bestHack = findBestSoftwareLoadout(loadout, hackCandidates, 'HACK');
    if (!bestHack) {
        log('Loadout: no bootable hack software available for ' + serverTypeName, 'warn');
        return false;
    }
    if (serverDefenceRate > 0 && bestHack.power < serverDefenceRate) {
        log('Loadout: cannot reach required hack power (' + serverDefenceRate + ') \u2014 best achievable: ' + bestHack.power, 'error');
        return false;
    }

    var targetSwIds = [bestHack.sw.id];
    var currentHw = loadout.equippedHardware || {};
    var alreadyBest = equippedSwIds.length === 1 && equippedSwIds[0] === bestHack.sw.id &&
        hardwareMatches(currentHw, bestHack.hardware);
    if (alreadyBest) {
        log('Loadout: best hack loadout already equipped \u2014 cannot improve beyond power ' + bestHack.power, 'warn');
        return false;
    }

    log('Loadout: equipping HACK-only "' + bestHack.sw.name + '" for retry (power ' + bestHack.power + ')');
    await applyLoadoutChange(loadout, bestHack.hardware, targetSwIds);
    return true;
}
