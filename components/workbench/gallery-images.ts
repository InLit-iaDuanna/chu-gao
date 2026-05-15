export interface GalleryImage {
  id?: string;
  src?: string;
  url?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
}

export function timestampForFilename(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];

  return parts.map((part) => String(part).padStart(2, "0")).join("");
}

function extensionForMimeType(mimeType?: string | null): string | null {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  if (mimeType === "image/png") {
    return "png";
  }

  return null;
}

function extensionFromUrl(url?: string): string | null {
  if (!url) {
    return null;
  }

  const pathname = url.split("?")[0] ?? "";
  const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") {
    return "jpg";
  }

  if (extension === "webp") {
    return "webp";
  }

  if (extension === "png") {
    return "png";
  }

  return null;
}

export function filenameForImage(image: GalleryImage, index: number): string {
  const extension =
    extensionForMimeType(image.mimeType) ??
    extensionFromUrl(image.downloadUrl ?? image.src ?? image.url) ??
    "png";

  return `chugao-${timestampForFilename()}-${index + 1}.${extension}`;
}

export function primaryImageUrl(image?: GalleryImage): string | undefined {
  return image?.src ?? image?.url;
}

export function previewImageUrl(image?: GalleryImage): string | undefined {
  return image?.thumbnailUrl ?? primaryImageUrl(image);
}

export function downloadImageUrl(image?: GalleryImage): string | undefined {
  return image?.downloadUrl ?? primaryImageUrl(image);
}
