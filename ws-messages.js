// ws-messages.js
// WebSocket message logging for COR3 Helper extension.
// Messages are stored in chrome.storage.local under 'cor3_ws_messages' as an array.
// Each entry: { timestamp, direction ('sent'|'received'), message (string, truncated) }
// No cap — full history available in DevTools panel.

const COR3_WS_MESSAGES_KEY = 'cor3_ws_messages';

/**
 * Log a WS message to storage.
 * @param {'sent'|'received'} direction
 * @param {string} message - The raw WS message string (stored in full — no truncation)
 */
async function cor3LogWsMessage(direction, message) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            direction: direction,
            message: String(message)
        };

        const data = await chrome.storage.local.get(COR3_WS_MESSAGES_KEY);
        const messages = data[COR3_WS_MESSAGES_KEY] || [];
        messages.push(entry);

        await chrome.storage.local.set({ [COR3_WS_MESSAGES_KEY]: messages });
    } catch (e) {
        // Silent — don't let logging break core functionality
    }
}

/**
 * Get all stored WS messages.
 * @returns {Promise<Array>} Array of message entries
 */
async function cor3GetWsMessages() {
    const data = await chrome.storage.local.get(COR3_WS_MESSAGES_KEY);
    return data[COR3_WS_MESSAGES_KEY] || [];
}

/**
 * Clear all stored WS messages.
 */
async function cor3ClearWsMessages() {
    await chrome.storage.local.remove(COR3_WS_MESSAGES_KEY);
}
