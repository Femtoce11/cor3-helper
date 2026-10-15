// Pure computation functions for loadout analysis.
// These have NO side effects — no WS calls, no DOM access, no logging.
// Async orchestration (getLoadoutData, applyLoadoutChange, ensureLoadoutForJob, etc.)
// remains in the solver scripts since they depend on sendCmd/waitForEvent/log.

export var RESOURCE_KEYS = ['cpu_frequency', 'cpu_cores', 'gpu_power', 'gpu_memory', 'ram_frequency', 'ram_memory'];

export function hardwareMatches(currentHw, targetHw) {
    var categories = ['cpu', 'gpu', 'ram', 'psu'];
    for (var i = 0; i < categories.length; i++) {
        var current = currentHw[categories[i]];
        var target = targetHw[categories[i]];
        if (!current || !target || current.id !== target.id) return false;
    }
    return true;
}

// Parse consuming array: 2-value = [min,max] (base=0), 3-value = [base,min,max]
export function parseConsuming(vals) {
    if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
    if (vals.length === 2) return { base: 0, min: vals[0], max: vals[1] };
    return { base: vals[0], min: vals[1], max: vals[2] };
}

// Normalize specs to always be an array
export function normSpecs(sw) {
    if (!sw || !sw.specs) return [];
    return Array.isArray(sw.specs) ? sw.specs : [sw.specs];
}

// Calculate full loadout analysis (mirrors simulator.html calculateAnalysis)
export function calculateAnalysis(loadout, softwareIds) {
    var hw = loadout.equippedHardware || {};
    var allSoftware = loadout.ownedSoftware || [];
    var installed = allSoftware.filter(function (sw) { return softwareIds.indexOf(sw.id) >= 0; });

    // Supply
    var supply = {};
    if (hw.cpu) {
        supply.cpu_frequency = hw.cpu.specs.cpuFrequency || 0;
        supply.cpu_cores = hw.cpu.specs.cpuCores || 0;
    }
    if (hw.gpu) {
        supply.gpu_power = hw.gpu.specs.gpuPower || 0;
        supply.gpu_memory = hw.gpu.specs.gpuMemory || 0;
    }
    if (hw.ram) {
        supply.ram_frequency = hw.ram.specs.ramFrequency || 0;
        supply.ram_memory = hw.ram.specs.ramMemory || 0;
    }
    if (hw.psu) {
        supply.psu_power = hw.psu.specs.psuPower || 0;
    }

    // Parse all consuming
    var parsed = {};
    for (var si = 0; si < installed.length; si++) {
        var sw = installed[si];
        parsed[sw.id] = {};
        for (var ri = 0; ri < RESOURCE_KEYS.length; ri++) {
            var rk = RESOURCE_KEYS[ri];
            var p = parseConsuming(sw.consuming && sw.consuming[rk]);
            if (p) parsed[sw.id][rk] = p;
        }
    }

    // Demand
    var demand = {};
    for (var ri2 = 0; ri2 < RESOURCE_KEYS.length; ri2++) {
        var rk2 = RESOURCE_KEYS[ri2];
        var totalBase = 0, highestMinUplift = 0;
        for (var si2 = 0; si2 < installed.length; si2++) {
            var pc = parsed[installed[si2].id][rk2];
            if (pc) {
                totalBase += pc.base;
                highestMinUplift = Math.max(highestMinUplift, pc.min - pc.base);
            }
        }
        demand[rk2] = totalBase + highestMinUplift;
    }
    var psuDemand = 0;
    if (hw.cpu) psuDemand += hw.cpu.specs.cpuConsuming || 0;
    if (hw.gpu) psuDemand += hw.gpu.specs.gpuConsuming || 0;
    demand.psu_total = psuDemand;

    // canBoot
    var hasAllHw = !!(hw.cpu && hw.gpu && hw.ram && hw.psu);
    var canBoot = hasAllHw;
    if (canBoot) {
        for (var ri3 = 0; ri3 < RESOURCE_KEYS.length; ri3++) {
            if ((supply[RESOURCE_KEYS[ri3]] || 0) < demand[RESOURCE_KEYS[ri3]]) { canBoot = false; break; }
        }
        if (canBoot && (supply.psu_power || 0) < demand.psu_total) canBoot = false;
    }

    // Per-software ratios + power
    var swAnalysis = {};
    for (var si3 = 0; si3 < installed.length; si3++) {
        var sw3 = installed[si3];
        var lowestRatio = 1, bottleneck = null;
        for (var ri4 = 0; ri4 < RESOURCE_KEYS.length; ri4++) {
            var rk4 = RESOURCE_KEYS[ri4];
            var pc4 = parsed[sw3.id][rk4];
            if (!pc4) continue;
            var otherBase = 0;
            for (var oi = 0; oi < installed.length; oi++) {
                if (installed[oi].id !== sw3.id) {
                    var opc = parsed[installed[oi].id][rk4];
                    if (opc) otherBase += opc.base;
                }
            }
            var avail = (supply[rk4] || 0) - otherBase;
            var ratio;
            if (pc4.max > pc4.min) {
                ratio = (avail - pc4.min) / (pc4.max - pc4.min);
                ratio = Math.max(0, Math.min(1, ratio));
            } else {
                ratio = avail >= pc4.min ? 1 : 0;
            }
            if (ratio < lowestRatio || (ratio === lowestRatio && bottleneck === null)) {
                lowestRatio = ratio;
                bottleneck = rk4;
            }
        }
        var specs = normSpecs(sw3);
        var abilities = specs.map(function (sp) {
            return {
                type: sp.type,
                computedPower: Math.floor(sp.power[0] + lowestRatio * (sp.power[1] - sp.power[0])),
                pMin: sp.power[0],
                pMax: sp.power[1],
                serverTypes: sp.serverTypes || null,
                fileTypes: sp.fileTypes || null
            };
        });
        swAnalysis[sw3.id] = { name: sw3.name, ratio: lowestRatio, bottleneck: bottleneck, abilities: abilities };
    }

    return { supply: supply, demand: demand, canBoot: canBoot, swAnalysis: swAnalysis, installed: installed };
}

// Find which software can hack a given server type, sorted by max power descending
export function findHackSoftwareForServerType(allSoftware, serverTypeName) {
    var candidates = [];
    for (var i = 0; i < allSoftware.length; i++) {
        var specs = normSpecs(allSoftware[i]);
        for (var j = 0; j < specs.length; j++) {
            if (specs[j].type === 'HACK' && specs[j].serverTypes &&
                specs[j].serverTypes.indexOf(serverTypeName) >= 0) {
                candidates.push({ sw: allSoftware[i], spec: specs[j], specIndex: j });
            }
        }
    }
    candidates.sort(function (a, b) { return b.spec.power[1] - a.spec.power[1]; });
    return candidates;
}

// Find which software can search a given server type, sorted by max power descending
export function findSearchSoftwareForServerType(allSoftware, serverTypeName) {
    var candidates = [];
    for (var i = 0; i < allSoftware.length; i++) {
        var specs = normSpecs(allSoftware[i]);
        for (var j = 0; j < specs.length; j++) {
            if (specs[j].type === 'SEARCH' && specs[j].serverTypes &&
                specs[j].serverTypes.indexOf(serverTypeName) >= 0) {
                candidates.push({ sw: allSoftware[i], spec: specs[j], specIndex: j });
            }
        }
    }
    candidates.sort(function (a, b) { return b.spec.power[1] - a.spec.power[1]; });
    return candidates;
}

// Find which software can decrypt a given file type, sorted by max power descending
export function findDecryptSoftwareForFileType(allSoftware, fileType) {
    var candidates = [];
    for (var i = 0; i < allSoftware.length; i++) {
        var specs = normSpecs(allSoftware[i]);
        for (var j = 0; j < specs.length; j++) {
            if (specs[j].type === 'DECRYPT' && specs[j].fileTypes &&
                specs[j].fileTypes.indexOf(fileType) >= 0) {
                candidates.push({ sw: allSoftware[i], spec: specs[j], specIndex: j });
            }
        }
    }
    candidates.sort(function (a, b) { return b.spec.power[1] - a.spec.power[1]; });
    return candidates;
}

// Find the best hardware set from owned hardware that maximizes power
// while still booting with the given software set.
export function findBestHardware(loadout, softwareIds) {
    var owned = loadout.ownedHardware || [];
    var byCat = { CPU: [], GPU: [], RAM: [], PSU: [] };
    for (var i = 0; i < owned.length; i++) {
        var cat = (owned[i].category || '').toUpperCase();
        if (byCat[cat]) byCat[cat].push(owned[i]);
    }
    if (byCat.CPU.length === 0 || byCat.GPU.length === 0 || byCat.RAM.length === 0 || byCat.PSU.length === 0) return null;
    var bestHw = null;
    var bestPower = -1;
    for (var ci = 0; ci < byCat.CPU.length; ci++) {
        for (var gi = 0; gi < byCat.GPU.length; gi++) {
            var psuNeed = (byCat.CPU[ci].specs.cpuConsuming || 0) + (byCat.GPU[gi].specs.gpuConsuming || 0);
            for (var pi = 0; pi < byCat.PSU.length; pi++) {
                if ((byCat.PSU[pi].specs.psuPower || 0) < psuNeed) continue;
                for (var rmi = 0; rmi < byCat.RAM.length; rmi++) {
                    var testHw = { cpu: byCat.CPU[ci], gpu: byCat.GPU[gi], ram: byCat.RAM[rmi], psu: byCat.PSU[pi] };
                    var testLoadout = JSON.parse(JSON.stringify(loadout));
                    testLoadout.equippedHardware = testHw;
                    var analysis = calculateAnalysis(testLoadout, softwareIds);
                    if (!analysis.canBoot) continue;
                    var totalPower = 0;
                    for (var swId in analysis.swAnalysis) {
                        var ab = analysis.swAnalysis[swId].abilities;
                        for (var ai = 0; ai < ab.length; ai++) totalPower += ab[ai].computedPower;
                    }
                    if (totalPower > bestPower) {
                        bestPower = totalPower;
                        bestHw = testHw;
                    }
                }
                break;
            }
        }
    }
    return bestHw;
}

// Find the software and owned hardware combination with the highest achievable power.
export function findBestSoftwareLoadout(loadout, candidates, abilityType) {
    var best = null;
    var equippedSw = loadout.equippedSoftware || [];
    for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        var softwareIds = [candidate.sw.id];
        var currentAnalysis = calculateAnalysis(loadout, softwareIds);
        var hardware = findBestHardware(loadout, softwareIds);
        if (!hardware) {
            if (!currentAnalysis.canBoot) continue;
            hardware = loadout.equippedHardware || {};
        }

        var testLoadout = JSON.parse(JSON.stringify(loadout));
        testLoadout.equippedHardware = hardware;
        var analysis = calculateAnalysis(testLoadout, softwareIds);
        if (!analysis.canBoot) continue;

        var swAnalysis = analysis.swAnalysis[candidate.sw.id];
        if (!swAnalysis) continue;
        var ability = typeof candidate.specIndex === 'number' ? swAnalysis.abilities[candidate.specIndex] : null;
        if (!ability || ability.type !== abilityType) {
            ability = null;
            for (var ai = 0; ai < swAnalysis.abilities.length; ai++) {
                if (swAnalysis.abilities[ai].type === abilityType) {
                    ability = swAnalysis.abilities[ai];
                    break;
                }
            }
        }
        if (!ability) continue;

        if (currentAnalysis.canBoot) {
            var currentSwAnalysis = currentAnalysis.swAnalysis[candidate.sw.id];
            var currentAbility = currentSwAnalysis && typeof candidate.specIndex === 'number' ? currentSwAnalysis.abilities[candidate.specIndex] : null;
            if (currentAbility && currentAbility.type === abilityType && currentAbility.computedPower === ability.computedPower) {
                hardware = loadout.equippedHardware || {};
            }
        }

        var isEquipped = equippedSw.some(function (sw) { return sw.id === candidate.sw.id; });
        if (!best || ability.computedPower > best.power ||
            (ability.computedPower === best.power && isEquipped && !best.isEquipped)) {
            best = {
                sw: candidate.sw,
                spec: candidate.spec,
                hardware: hardware,
                power: ability.computedPower,
                isEquipped: isEquipped
            };
        }
    }
    return best;
}

// Find the lowest-priority equipped software that can be removed (not the protected one)
export function findRemovableSoftware(loadout, swIds, protectedId) {
    var equipped = loadout.equippedSoftware || [];
    var removable = [];
    for (var i = 0; i < equipped.length; i++) {
        if (equipped[i].id === protectedId) continue;
        if (swIds.indexOf(equipped[i].id) < 0) continue;
        var specs = normSpecs(equipped[i]);
        var hasOnlySearch = specs.every(function (s) { return s.type === 'SEARCH'; });
        removable.push({ id: equipped[i].id, tier: equipped[i].tier || 0, onlySearch: hasOnlySearch });
    }
    removable.sort(function (a, b) {
        if (a.onlySearch !== b.onlySearch) return a.onlySearch ? -1 : 1;
        return (a.tier || 0) - (b.tier || 0);
    });
    return removable.length > 0 ? removable[0].id : null;
}

// Get server type name by server ID from cached network map
export function getServerTypeName(serverId) {
    var map = typeof window !== 'undefined' && window.__cor3ServerTypeMap;
    if (map && map[serverId]) return map[serverId].serverTypeName;
    return null;
}
