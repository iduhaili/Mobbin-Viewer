import { PROCESSED_MEDIA_ATTR, PROCESSED_MEDIA_SOURCE_ATTR } from '../shared/constants';
import {
  convertPosterToVideoSrc,
  isImageRepresentingVideo,
  isMobbinSignedFileRawImage,
  isMobbinScreenImage,
  isMobbinVideoPoster,
  isMobbinVideoSource,
  normalizePresentationImageUrl,
} from './media-url-normalizer';
import { ensureMediaControls } from './overlay-ui';
import {
  ensureContainerState,
  findSuitableContainer,
  isInDetailView,
  isInExcludedPanel,
  removeBlurFromAncestors,
} from './unblur-engine';

function ensureContainerControls(media: HTMLImageElement | HTMLVideoElement): void {
  if (isInDetailView(media) || isInExcludedPanel(media)) {
    return;
  }

  const container = findSuitableContainer(media);
  if (!container) {
    return;
  }

  ensureContainerState(container);
  ensureMediaControls(container, media);
}

function parseSrcsetCandidate(candidate: string): string {
  return candidate.trim().split(/\s+/)[0] ?? '';
}

function getMobbinImageFromSrcset(srcset: string): string {
  return srcset
    .split(',')
    .map(parseSrcsetCandidate)
    .find((candidate) => isMobbinScreenImage(candidate)) ?? '';
}

function getImageSource(image: HTMLImageElement): string {
  const directSource = image.currentSrc || image.src;
  if (isMobbinScreenImage(directSource)) {
    return directSource;
  }

  const srcsetSource = getMobbinImageFromSrcset(image.getAttribute('srcset') ?? '');
  if (srcsetSource) {
    return srcsetSource;
  }

  const picture = image.closest('picture');
  if (!picture) {
    return directSource;
  }

  for (const source of Array.from(picture.querySelectorAll('source[srcset]'))) {
    const candidate = getMobbinImageFromSrcset(source.getAttribute('srcset') ?? '');
    if (candidate) {
      return candidate;
    }
  }

  return directSource;
}

function normalizeSrcset(srcset: string): string {
  return srcset
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      const [url, ...descriptors] = trimmed.split(/\s+/);

      if (!url || !isMobbinScreenImage(url)) {
        return trimmed;
      }

      return [normalizePresentationImageUrl(url), ...descriptors].join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

function normalizePictureSources(image: HTMLImageElement): void {
  const picture = image.closest('picture');
  if (!picture) {
    return;
  }

  picture.querySelectorAll('source[srcset]').forEach((source) => {
    const srcset = source.getAttribute('srcset') ?? '';
    const normalized = normalizeSrcset(srcset);

    if (normalized !== srcset) {
      source.setAttribute('srcset', normalized);
    }
  });
}

function applyNormalizedImageSource(image: HTMLImageElement, source: string): void {
  const normalized = normalizePresentationImageUrl(source);
  const previousNormalized = image.getAttribute(PROCESSED_MEDIA_SOURCE_ATTR);
  const normalizedIsRawSignedFile = isMobbinSignedFileRawImage(normalized);

  if (!normalizedIsRawSignedFile) {
    normalizePictureSources(image);
  }

  const imageSrcset = image.getAttribute('srcset');
  if (imageSrcset && !normalizedIsRawSignedFile) {
    const normalizedSrcset = normalizeSrcset(imageSrcset);
    if (normalizedSrcset !== imageSrcset) {
      image.setAttribute('srcset', normalizedSrcset);
    }
  }

  if (normalizedIsRawSignedFile) {
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
  }

  if (previousNormalized !== normalized || image.src !== normalized) {
    image.src = normalized;
    image.setAttribute(PROCESSED_MEDIA_SOURCE_ATTR, normalized);
  }
}

function convertImageToVideo(image: HTMLImageElement): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = convertPosterToVideoSrc(getImageSource(image));
  video.loop = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.className = image.className;

  const style = image.getAttribute('style');
  if (style) {
    video.setAttribute('style', style);
  }

  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('disableremoteplayback', '');
  video.setAttribute(PROCESSED_MEDIA_ATTR, 'true');

  image.parentNode?.replaceChild(video, image);
  return video;
}

function processImage(image: HTMLImageElement): void {
  const source = getImageSource(image);

  if (!isMobbinScreenImage(source) || isInExcludedPanel(image)) {
    return;
  }

  if (isImageRepresentingVideo(source)) {
    const video = image.hasAttribute(PROCESSED_MEDIA_ATTR)
      ? (image.parentElement?.querySelector('video') as HTMLVideoElement | null)
      : convertImageToVideo(image);

    if (video) {
      processVideo(video);
    }

    return;
  }

  applyNormalizedImageSource(image, source);

  image.setAttribute(PROCESSED_MEDIA_ATTR, 'true');
  removeBlurFromAncestors(image);
  ensureContainerControls(image);
}

function processVideo(video: HTMLVideoElement): void {
  const source = video.currentSrc || video.src;
  const poster = video.getAttribute('poster');

  if (!source && !poster) {
    return;
  }

  if (!isMobbinVideoSource(source) && !(poster && isMobbinVideoPoster(poster))) {
    return;
  }

  if (video.hasAttribute(PROCESSED_MEDIA_ATTR)) {
    removeBlurFromAncestors(video);
    ensureContainerControls(video);
    return;
  }

  if (!source && poster && isMobbinVideoPoster(poster)) {
    video.src = convertPosterToVideoSrc(poster);
  }

  if (poster && isMobbinVideoPoster(poster)) {
    try {
      const parsed = new URL(poster);
      parsed.searchParams.set('w', '1920');
      video.setAttribute('poster', parsed.toString());
    } catch {
      // Ignore poster normalization failures.
    }
  }

  video.setAttribute(PROCESSED_MEDIA_ATTR, 'true');
  removeBlurFromAncestors(video);
  ensureContainerControls(video);
}

export function scanDocument(): void {
  document.querySelectorAll('img').forEach((node) => {
    processImage(node as HTMLImageElement);
  });

  document.querySelectorAll('video').forEach((node) => {
    processVideo(node as HTMLVideoElement);
  });
}
