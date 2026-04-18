// background.js
// Minimal service worker — kept for future use (e.g., notifications).

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "alarmActiveStatus") {
        sendResponse({ success: true });
        return true;
    }
});
