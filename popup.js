document.addEventListener('DOMContentLoaded', () => {
  const openUrl = (url) => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url });
      window.close();
    } else {
      window.open(url, '_blank');
    }
  };

  const mainBtn = document.getElementById('openConsoleBtn');
  if (mainBtn) {
    mainBtn.addEventListener('click', () => {
      openUrl('https://console.cloud.google.com/');
    });
  }

  document.querySelectorAll('[data-url]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetUrl = btn.getAttribute('data-url');
      if (targetUrl) openUrl(targetUrl);
    });
  });
});
