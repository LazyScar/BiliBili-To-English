chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "bte:bgFetch" || !message.payload) {
    return false;
  }

  const payload = message.payload;
  const url = String(payload.url || "");
  if (!url) {
    sendResponse({ ok: false, error: "Missing URL" });
    return true;
  }

  const init = {
    method: payload.method || "GET",
    headers: payload.headers || {},
    body: payload.body,
    credentials: payload.credentials || "omit",
    redirect: "follow",
  };

  fetch(url, init)
    .then(async (response) => {
      const text = await response.text();
      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        status: 0,
        statusText: "Network Error",
        error: String(error),
      });
    });

  return true;
});
