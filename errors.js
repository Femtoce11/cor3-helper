// errors.js
// Centralized error logging for COR3 Helper extension.
// Errors are stored in chrome.storage.local under 'cor3_errors' as an array.
// Each entry: { timestamp, source, message, stack?, context? }
// Max 200 entries stored (oldest trimmed).

const COR3_ERRORS_KEY = 'cor3_errors';
const COR3_ERRORS_MAX = 200;

/**
 * Log an error to storage.
 * @param {string} source - Where the error originated (e.g. 'background.js', 'popup.js', 'content.js', 'content-early.js')
 * @param {string|Error} error - The error message or Error object
 * @param {object} [context] - Optional context data (e.g. { action: 'refreshMarket', tabId: 123 })
 */
async function cor3LogError(source, error, context) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            source: source,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            context: context || undefined
        };

        const data = await chrome.storage.local.get(COR3_ERRORS_KEY);
        const errors = data[COR3_ERRORS_KEY] || [];
        errors.push(entry);

        // Trim oldest entries if over max
        while (errors.length > COR3_ERRORS_MAX) {
            errors.shift();
        }

        await chrome.storage.local.set({ [COR3_ERRORS_KEY]: errors });
    } catch (e) {
        // Last resort: console only
        console.error('[COR3 Helper] Failed to log error to storage:', e);
    }
}

/**
 * Get all stored errors.
 * @returns {Promise<Array>} Array of error entries
 */
async function cor3GetErrors() {
    const data = await chrome.storage.local.get(COR3_ERRORS_KEY);
    return data[COR3_ERRORS_KEY] || [];
}

/**
 * Clear all stored errors.
 */
async function cor3ClearErrors() {
    await chrome.storage.local.remove(COR3_ERRORS_KEY);
}
