import type { AspectRatio, Resolution } from "@/lib/models/types";

export const SIZE_BY_RESOLUTION_AND_ASPECT: Record<
  Resolution,
  Partial<Record<AspectRatio, string>>
> = {
  "1K": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
  },
  "2K": {
    "1:1": "2048x2048",
    "3:2": "2048x1360",
    "2:3": "1360x2048",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "5:4": "2560x2048",
    "4:5": "2048x2560",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
    "2:1": "2688x1344",
    "1:2": "1344x2688",
    "21:9": "2688x1152",
    "9:21": "1152x2688",
  },
  "4K": {
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "2:1": "3840x1920",
    "1:2": "1920x3840",
    "21:9": "3840x1648",
    "9:21": "1648x3840",
  },
  High: {
    "1:1": "2048x2048",
    "3:2": "2048x1360",
    "2:3": "1360x2048",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "5:4": "2560x2048",
    "4:5": "2048x2560",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
    "2:1": "2688x1344",
    "1:2": "1344x2688",
    "21:9": "2688x1152",
    "9:21": "1152x2688",
  },
};

export const RESOLUTION_TO_QUALITY: Record<Resolution, string> = {
  "1K": "low",
  "2K": "medium",
  "4K": "high",
  High: "high",
};

export const RESOLUTION_TO_SYSRV_QUALITY: Record<Resolution, string> = {
  "1K": "1k",
  "2K": "2k",
  "4K": "4k",
  High: "high",
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
