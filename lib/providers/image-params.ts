import type { AspectRatio, Resolution } from "@/lib/models/types";

export const SIZE_BY_RESOLUTION_AND_ASPECT: Record<
  Resolution,
  Partial<Record<AspectRatio, string>>
> = {
  "1K": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "4:3": "1536x1152",
    "3:4": "1152x1536",
    "5:4": "1280x1024",
    "4:5": "1024x1280",
    "16:9": "1536x864",
    "9:16": "864x1536",
  },
  "2K": {
    "1:1": "2048x2048",
    "3:2": "3072x2048",
    "2:3": "2048x3072",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "5:4": "2048x1632",
    "4:5": "1632x2048",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
  },
  "4K": {
    "1:1": "2880x2880",
    "3:2": "3504x2336",
    "2:3": "2336x3504",
    "4:3": "3072x2304",
    "3:4": "2304x3072",
    "5:4": "2880x2304",
    "4:5": "2304x2880",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
  },
};

export const RESOLUTION_TO_QUALITY: Record<Resolution, string> = {
  "1K": "low",
  "2K": "medium",
  "4K": "high",
};

export function imagePixelSizeForRequest(
  aspectRatio: AspectRatio,
  resolution: Resolution,
  providerName: string,
): string {
  const size = SIZE_BY_RESOLUTION_AND_ASPECT[resolution]?.[aspectRatio];

  if (!size) {
    throw new Error(
      `unsupported ${providerName} image size: ${aspectRatio} ${resolution}`,
    );
  }

  return size;
}
