// ws-messages.js
// WebSocket message logging for COR3 Helper extension.
// Messages are stored in chrome.storage.local under 'cor3_ws_messages' as an array.
// Each entry: { timestamp, direction ('sent'|'received'), message (string, truncated) }
// Max 500 entries stored (oldest trimmed).

const COR3_WS_MESSAGES_KEY = 'cor3_ws_messages';
const COR3_WS_MESSAGES_MAX = 500;
const COR3_WS_MSG_MAX_LEN = 1000; // Truncate individual messages to prevent storage bloat

/**
 * Log a WS message to storage.
 * @param {'sent'|'received'} direction
 * @param {string} message - The raw WS message string
 */
async function cor3LogWsMessage(direction, message) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            direction: direction,
            message: typeof message === 'string' && message.length > COR3_WS_MSG_MAX_LEN
                ? message.substring(0, COR3_WS_MSG_MAX_LEN) + '...'
                : String(message)
        };

        const data = await chrome.storage.local.get(COR3_WS_MESSAGES_KEY);
        const messages = data[COR3_WS_MESSAGES_KEY] || [];
        messages.push(entry);

        // Trim oldest entries if over max
        while (messages.length > COR3_WS_MESSAGES_MAX) {
            messages.shift();
        }

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
