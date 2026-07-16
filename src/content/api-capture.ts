const ENABLED_KEY = 'mobbinViewerApiCaptureEnabled';

function persistCaptureFlagFromQuery(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mobbinViewerApiCapture') === '1') {
      window.localStorage.setItem(ENABLED_KEY, '1');
    }
  } catch {
    // Ignore storage failures.
  }
}

function injectCaptureScript(): void {
  const parent = document.documentElement || document.head;
  if (!parent) {
    window.addEventListener('DOMContentLoaded', injectCaptureScript, { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('api-capture-page.js');
  script.async = false;
  parent.appendChild(script);
  script.remove();
}

persistCaptureFlagFromQuery();
injectCaptureScript();
