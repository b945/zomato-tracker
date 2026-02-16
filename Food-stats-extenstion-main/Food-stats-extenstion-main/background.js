chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "openDashboard",
        title: "Open Zomato Dashboard",
        contexts: ["action"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "openDashboard") {
        chrome.tabs.create({ url: 'dashboard.html' });
    }
});
