console.log("Zomato Expense Calculator: Content script loaded");

let isFetching = false;

// Listen for messages from the popup/dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start_sync") {
        if (isFetching) {
            sendResponse({ status: "already_running" });
            return;
        }
        startFetching(sendResponse);
        return true; // Keep the message channel open for async response
    }
});

async function startFetching(sendResponse) {
    isFetching = true;
    let allOrders = [];
    let page = 1;
    let hasMore = true;

    try {
        notifyStatus("Fetching your order history... Please wait.");

        while (hasMore) {
            notifyStatus(`Fetching page ${page}...`);

            const response = await fetch(`https://www.zomato.com/webroutes/user/orders?page=${page}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log(`[Zomato Tracker] Page ${page} data:`, data);

            if (data) {
                let orders = [];

                // Handle various potential Zomato API structures
                if (data.entities && data.entities.ORDER) {
                    orders = Object.values(data.entities.ORDER);
                } else if (data.sections) {
                    console.warn("Zomato Tracker: unexpected structure 'sections', checking detail", data);
                }

                if (orders.length === 0) {
                    if (page === 1) {
                        console.warn("Zomato Tracker: No orders found on page 1. Check response structure.");
                    }
                    hasMore = false;
                } else {
                    allOrders = allOrders.concat(orders);
                    page++;
                    await new Promise(r => setTimeout(r, 1000)); // Increase delay
                }
            } else {
                hasMore = false;
            }
        }

        // Save to storage
        try {
            await chrome.storage.local.set({
                zomatoOrders: allOrders,
                lastSynced: new Date().toISOString()
            });
            console.log("Saved to storage.");
        } catch (e) {
            console.error("Storage save failed:", e);
            alert("Zomato Expense Calculator: Extension updated. Please REFRESH this page and try again.");
            return;
        }

        notifyStatus(`Success! Fetched ${allOrders.length} orders.`);

        try {
            chrome.runtime.sendMessage({ action: "sync_complete", count: allOrders.length });
        } catch (e) { console.log("Could not send completion message", e); }

    } catch (error) {
        console.error("Zomato Fetch Error:", error);
        notifyStatus(`Error: ${error.message}. Make sure you are logged in.`);
    } finally {
        isFetching = false;
    }
}

function notifyStatus(message) {
    console.log(`[Zomato Tracker] ${message}`);
    // Check if extension context is valid
    if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: "status_update", message: message }).catch(() => {
            // Popup closed or error
        });
    }
}
