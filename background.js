/**
 * Chrome Extension Background Service Worker
 * 代理 content.js 向 Google Apps Script (script.google.com) 发起的请求，避免受页面 CSP 限制。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'GAS_HTTP_REQUEST') {
    return false;
  }

  const { url, method, body } = message;

  // 安全校验：仅允许向官方 Google Apps Script 部署地址发起请求，防止将凭证或校验码发往第三方域名
  try {
    const parsedUrl = new URL(String(url || '').trim());
    const isValidGas =
      parsedUrl.protocol === 'https:' &&
      parsedUrl.hostname === 'script.google.com' &&
      /^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(parsedUrl.pathname);
    if (!isValidGas) {
      sendResponse({
        ok: false,
        error: '安全拦截：仅允许请求 https://script.google.com/macros/s/.../exec 官方接口地址！'
      });
      return false;
    }
  } catch (_) {
    sendResponse({ ok: false, error: '无效的接口 URL 格式！' });
    return false;
  }

  const fetchOptions = {
    method: method || 'GET',
    redirect: 'follow'
  };

  if (method === 'POST' && body) {
    fetchOptions.headers = {
      'Content-Type': 'text/plain;charset=utf-8'
    };
    fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  fetch(url, fetchOptions)
    .then(async (response) => {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        sendResponse({ ok: true, data: json });
      } catch (_) {
        sendResponse({
          ok: false,
          error: '接口返回的不是有效 JSON 数据（请检查部署权限是否为“所有人”以及网址是否正确）。状态码: ' + response.status
        });
      }
    })
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err && err.message ? err.message : String(err)
      });
    });

  return true;
});
