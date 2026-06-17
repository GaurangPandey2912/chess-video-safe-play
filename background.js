chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'get-state':
      sendResponse({ active: true });
      break;

    case 'get-auth':
      chrome.storage.local.get(['cv_token', 'cv_user'], (result) => {
        sendResponse(result);
      });
      return true;

    case 'set-auth':
      chrome.storage.local.set({ cv_token: msg.token, cv_user: msg.user }, () => {
        sendResponse({ success: true });
      });
      return true;

    case 'logout':
      chrome.storage.local.remove(['cv_token', 'cv_user'], () => {
        sendResponse({ success: true });
      });
      return true;
  }
});
