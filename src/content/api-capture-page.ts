const ENABLED_KEY = 'mobbinViewerApiCaptureEnabled';
const HIGH_RES_IMAGE_MAP_STORAGE_KEY = 'mobbinViewerHighResImageMap';
const RECORDS_KEY = 'mobbinViewerApiCaptureRecords';
const MAX_RECORDS = 12;
const MAX_TEXT_LENGTH = 2_000_000;
const WATCH_PATTERN = /(graphql|api|trpc|screens|flows?|screen)/i;
const EXCLUDED_PATTERN = /(\/auth\/|refresh_token|access_token|id_token|password|credential)/i;
const SENSITIVE_KEY_PATTERN = /^(access_token|refresh_token|id_token|authorization|password|credential)$/i;
const HIGH_RES_IMAGE_REGEX =
  /^https:\/\/ujasntkfphywizsdaapi\.supabase\.co\/storage\/v1\/object\/public\/content\/app_screens\/[^"\\]+\.png$/i;
const SIGNED_IMAGE_REGEX =
  /^https:\/\/bytescale\.mobbin\.com\/[^"\\]+\/image\/mobbin\.com\/prod\/file\.webp\?enc=[^"\\]+$/i;
const SUPABASE_SCREEN_URL_REGEX =
  /^https:\/\/ujasntkfphywizsdaapi\.supabase\.co\/storage\/v1\/object\/public\/content\/app_screens\/([^/?#]+\.(?:png|jpg|jpeg|webp))$/i;

declare global {
  interface Window {
    __mobbinViewerApiCapture?: {
      dump: () => unknown[];
      dumpFlow: () => unknown[];
      clear: () => void;
      disable: () => void;
    };
    __mobbinViewerApiCaptureInstalled?: boolean;
  }

  interface XMLHttpRequest {
    __mobbinViewerApiCapture?: {
      method: string;
      url: string;
      startedAt: number;
      requestBody: string;
    };
  }
}

type CaptureRecord = {
  transport: 'fetch' | 'xhr';
  url: string;
  method: string;
  status: number;
  durationMs: number;
  requestBody: string;
  response: unknown;
  capturedAt?: string;
};

type HighResImageMap = Record<string, string>;

function readRecords(): CaptureRecord[] {
  try {
    const records = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeRecords(records: CaptureRecord[]): void {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch {
    const smaller = records.slice(Math.ceil(records.length / 2));
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(smaller.slice(-MAX_RECORDS)));
    } catch {
      // Ignore storage quota failures.
    }
  }
}

function readHighResImageMap(): HighResImageMap {
  try {
    const value = localStorage.getItem(HIGH_RES_IMAGE_MAP_STORAGE_KEY);
    if (!value) {
      return {};
    }

    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as HighResImageMap)
      : {};
  } catch {
    return {};
  }
}

function writeHighResImageMap(map: HighResImageMap): void {
  try {
    localStorage.setItem(HIGH_RES_IMAGE_MAP_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota failures.
  }
}

function convertSupabaseScreenUrlToBytescaleUrl(url: string): string {
  const match = url.match(SUPABASE_SCREEN_URL_REGEX);
  if (!match?.[1]) {
    return url;
  }

  const parsed = new URL(
    `https://bytescale.mobbin.com/FW25bBB/image/mobbin.com/prod/content/app_screens/${match[1]}`,
  );
  parsed.searchParams.set('f', 'webp');
  parsed.searchParams.set('w', '1920');
  parsed.searchParams.set('q', '85');
  parsed.searchParams.set('fit', 'shrink-cover');
  return parsed.toString();
}

function toShortText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
}

function toBodyText(body: unknown): string {
  if (!body) {
    return '';
  }

  if (typeof body === 'string') {
    return toShortText(body);
  }

  if (body instanceof URLSearchParams) {
    return toShortText(body.toString());
  }

  try {
    return toShortText(JSON.stringify(body));
  } catch {
    return '';
  }
}

function parsePayload(text: string): unknown {
  const shortText = toShortText(text);
  try {
    return JSON.parse(shortText);
  } catch {
    return shortText;
  }
}

function shouldCapture(url: string, requestBody: string): boolean {
  if (EXCLUDED_PATTERN.test(url) || EXCLUDED_PATTERN.test(requestBody)) {
    return false;
  }

  return WATCH_PATTERN.test(url) || WATCH_PATTERN.test(requestBody);
}

function redactSensitive(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitive(entry),
    ]),
  );
}

function storeRecord(record: CaptureRecord): void {
  if (!shouldCapture(record.url, record.requestBody)) {
    return;
  }

  const records = readRecords();
  records.push({
    ...record,
    response: redactSensitive(record.response),
    capturedAt: new Date().toISOString(),
  });
  writeRecords(records);
  window.postMessage({ source: 'mobbin-viewer-api-capture', recordCount: records.length }, '*');
}

function storeHighResImageMapFromText(text: string): void {
  const pairRegex =
    /"screenUrl":"(https:\/\/ujasntkfphywizsdaapi\.supabase\.co\/storage\/v1\/object\/public\/content\/app_screens\/[^"\\]+\.png)"[\s\S]{0,6000}?"screenCdnImgSources":\{"src":"(https:\/\/bytescale\.mobbin\.com\/[^"\\]+\/image\/mobbin\.com\/prod\/file\.webp\?enc=[^"\\]+)"/gi;
  const map = readHighResImageMap();
  let added = 0;

  for (const match of text.matchAll(pairRegex)) {
    const highResUrl = convertSupabaseScreenUrlToBytescaleUrl(match[1] ?? '');
    const signedUrl = match[2];
    if (
      highResUrl &&
      signedUrl &&
      HIGH_RES_IMAGE_REGEX.test(match[1] ?? '') &&
      SIGNED_IMAGE_REGEX.test(signedUrl) &&
      map[signedUrl] !== highResUrl
    ) {
      map[signedUrl] = highResUrl;
      added += 1;
    }
  }

  if (added > 0) {
    writeHighResImageMap(map);
    window.postMessage(
      { source: 'mobbin-viewer-image-map', added, total: Object.keys(map).length },
      '*',
    );
  }
}

function installFetchCapture(): void {
  const originalFetch = window.fetch;

  window.fetch = async function mobbinViewerCapturedFetch(input, init) {
    const request = input instanceof Request ? input : null;
    const url = typeof input === 'string' ? input : request?.url || input?.toString() || '';
    const method = init?.method || request?.method || 'GET';
    const requestBody = toBodyText(init?.body);
    const startedAt = Date.now();
    const response = await originalFetch.apply(this, [input, init] as Parameters<typeof fetch>);

    if (shouldCapture(url, requestBody) || /\b_rsc=|\/screens/.test(url)) {
      response
        .clone()
        .text()
        .then((text) => {
          storeHighResImageMapFromText(text);

          if (window.localStorage.getItem(ENABLED_KEY) === '1') {
            storeRecord({
              transport: 'fetch',
              url,
              method,
              status: response.status,
              durationMs: Date.now() - startedAt,
              requestBody,
              response: parsePayload(text),
            });
          }
        })
        .catch(() => {
          // Ignore clone/read failures.
        });
    }

    return response;
  };
}

function installXhrCapture(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function mobbinViewerCapturedOpen(method, url) {
    this.__mobbinViewerApiCapture = {
      method,
      url: String(url || ''),
      startedAt: 0,
      requestBody: '',
    };
    return originalOpen.apply(this, arguments as unknown as Parameters<typeof originalOpen>);
  };

  XMLHttpRequest.prototype.send = function mobbinViewerCapturedSend(body) {
    const meta = this.__mobbinViewerApiCapture;
    if (meta) {
      meta.startedAt = Date.now();
      meta.requestBody = toBodyText(body);
      this.addEventListener('loadend', () => {
        if (!shouldCapture(meta.url, meta.requestBody) && !/\b_rsc=|\/screens/.test(meta.url)) {
          return;
        }

        let responseText = '';
        if (!this.responseType || this.responseType === 'text') {
          responseText = this.responseText || '';
        }

        storeHighResImageMapFromText(responseText);

        if (window.localStorage.getItem(ENABLED_KEY) === '1') {
          storeRecord({
            transport: 'xhr',
            url: meta.url,
            method: meta.method,
            status: this.status,
            durationMs: Date.now() - meta.startedAt,
            requestBody: meta.requestBody,
            response: parsePayload(responseText),
          });
        }
      });
    }

    return originalSend.apply(this, arguments as unknown as Parameters<typeof originalSend>);
  };
}

if (!window.__mobbinViewerApiCaptureInstalled) {
  window.__mobbinViewerApiCaptureInstalled = true;
  window.__mobbinViewerApiCapture = {
    dump: () => readRecords(),
    dumpFlow: () =>
      readRecords().filter((record) => /\/flows\/|\/screens|\b_rsc=/.test(record.url)),
    clear: () => localStorage.removeItem(RECORDS_KEY),
    disable: () => localStorage.removeItem(ENABLED_KEY),
  };

  installFetchCapture();
  installXhrCapture();

  console.info(
    '[Mobbin Viewer] API Capture enabled. Use copy(JSON.stringify(window.__mobbinViewerApiCapture.dump(), null, 2)) to export.',
  );
}

export {};
