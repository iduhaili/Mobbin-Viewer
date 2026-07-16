import { isMobbinHighResolutionScreenImage, isMobbinSignedFileImage } from './media-url-normalizer';

export const HIGH_RES_IMAGE_MAP_STORAGE_KEY = 'mobbinViewerHighResImageMap';

type ImageMap = Record<string, string>;

const SUPABASE_SCREEN_URL_REGEX =
  /^https:\/\/ujasntkfphywizsdaapi\.supabase\.co\/storage\/v1\/object\/public\/content\/app_screens\/([^/?#]+\.(?:png|jpg|jpeg|webp))$/i;

export function convertSupabaseScreenUrlToBytescaleUrl(url: string): string {
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

function readImageMap(): ImageMap {
  try {
    const value = window.localStorage.getItem(HIGH_RES_IMAGE_MAP_STORAGE_KEY);
    if (!value) {
      return {};
    }

    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as ImageMap)
      : {};
  } catch {
    return {};
  }
}

export function resolveHighResImageUrl(source: string): string {
  if (!isMobbinSignedFileImage(source)) {
    return source;
  }

  const mappedUrl = convertSupabaseScreenUrlToBytescaleUrl(readImageMap()[source] ?? '');
  return mappedUrl && isMobbinHighResolutionScreenImage(mappedUrl) ? mappedUrl : source;
}
