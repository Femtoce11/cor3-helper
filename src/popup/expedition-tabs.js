// Expedition mode tabs (Mercenaries A layer / Personal Drone A layer)
// and the collapsible Active Expedition blocks.

const expTabMercenaries = document.getElementById('expTabMercenaries');
const expTabDrone = document.getElementById('expTabDrone');
const expPanelMercenaries = document.getElementById('expPanelMercenaries');
const expPanelDrone = document.getElementById('expPanelDrone');

function switchExpeditionMode(mode) {
    if (!expTabMercenaries || !expTabDrone || !expPanelMercenaries || !expPanelDrone) return;
    const merc = mode === 'merc';
    expTabMercenaries.classList.toggle('active', merc);
    expTabDrone.classList.toggle('active', !merc);
    expPanelMercenaries.classList.toggle('active', merc);
    expPanelDrone.classList.toggle('active', !merc);
}
if (expTabMercenaries) expTabMercenaries.addEventListener('click', () => switchExpeditionMode('merc'));
if (expTabDrone) expTabDrone.addEventListener('click', () => switchExpeditionMode('drone'));

// Collapsible Active Expedition blocks (mercenary; drone's is wired in drone.js)
[['mercExpActiveToggle', 'mercExpActiveBody']].forEach(([thId, tbId]) => {
    const h = document.getElementById(thId);
    const b = document.getElementById(tbId);
    if (h && b) h.addEventListener('click', () => { h.classList.toggle('open'); b.classList.toggle('open'); });
});
