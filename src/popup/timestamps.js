import { showLastUpdated } from './utils.js';

const dailyLastUpdated = document.getElementById('dailyLastUpdated');
const coreMarketLastUpdated = document.getElementById('coreMarketLastUpdated');
const darkMarketLastUpdated = document.getElementById('darkMarketLastUpdated');
const soyuzMarketLastUpdated = document.getElementById('soyuzMarketLastUpdated');
const usolMarketLastUpdated = document.getElementById('usolMarketLastUpdated');
const expeditionLastUpdated = document.getElementById('expeditionLastUpdated');
const decisionLastUpdated = document.getElementById('decisionLastUpdated');
const personalDroneLastUpdated = document.getElementById('personalDroneLastUpdated');
const inventoryLastUpdated = document.getElementById('inventoryLastUpdated');
const archivedExpLastUpdated = document.getElementById('archivedExpLastUpdated');
const mercenariesLastUpdated = document.getElementById('mercenariesLastUpdated');
const loadoutLastUpdated = document.getElementById('loadoutLastUpdated');

export function refreshAllTimestamps() {
    showLastUpdated(dailyLastUpdated, 'dailyOpsUpdatedAt');
    showLastUpdated(coreMarketLastUpdated, 'marketDataUpdatedAt');
    showLastUpdated(darkMarketLastUpdated, 'darkMarketDataUpdatedAt');
    showLastUpdated(soyuzMarketLastUpdated, 'soyuzMarketDataUpdatedAt');
    showLastUpdated(usolMarketLastUpdated, 'usolMarketDataUpdatedAt');
    showLastUpdated(expeditionLastUpdated, 'expeditionsDataUpdatedAt');
    showLastUpdated(decisionLastUpdated, 'expeditionsDataUpdatedAt');
    showLastUpdated(personalDroneLastUpdated, 'droneDataUpdatedAt');
    if (inventoryLastUpdated) showLastUpdated(inventoryLastUpdated, 'stashDataUpdatedAt');
    if (archivedExpLastUpdated) showLastUpdated(archivedExpLastUpdated, 'archivedExpeditionsUpdatedAt');
    if (mercenariesLastUpdated) showLastUpdated(mercenariesLastUpdated, 'mercenariesUpdatedAt');
    if (loadoutLastUpdated) showLastUpdated(loadoutLastUpdated, 'loadoutUpdatedAt');
}
