"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui";
import type { ReferenceItem } from "../CommandDock";
import type { ModelInfo } from "./types";
import { uploadReferenceImage } from "./api";

export const REFERENCE_DRAG_MIME = "application/x-chugao-reference";
export const REFERENCE_ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_TYPES = new Set(REFERENCE_ACCEPT.split(","));

export function parseReferenceDrag(raw: string): ReferenceItem | null {
  try {
    const item = JSON.parse(raw) as ReferenceItem;
    if (
      item.kind !== "source" ||
      typeof item.key !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(item.key)
    )
      return null;
    if (
      typeof item.previewUrl !== "string" ||
      !item.previewUrl.startsWith("/api/generations/") ||
      item.previewUrl.includes("..")
    )
      return null;
    return { kind: "source", key: item.key, previewUrl: item.previewUrl };
  } catch {
    return null;
  }
}

export function referenceRequest(references: ReferenceItem[]) {
  return {
    referenceImageKeys: references
      .filter((item) => item.kind === "upload")
      .map((item) => item.key),
    sourceImageIds: references
      .filter((item) => item.kind === "source")
      .map((item) => item.key),
    // Preserves the exact user-defined order so the server can reconstruct it.
    referenceOrder: references.map((item) => `${item.kind}:${item.key}`),
  };
}

export function useReferenceInput({
  model,
  references,
  onChange,
}: {
  model: ModelInfo | null;
  references: ReferenceItem[];
  onChange: (items: ReferenceItem[]) => void;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(0);
  const current = useRef(references);
  const pending = useRef(0);
  const alive = useRef(true);
  const modelId = useRef(model?.id);
  current.current = references;
  modelId.current = model?.id;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const room = () => {
    if (!model?.capabilities.supportsReferenceImage) {
      toast({ title: "当前模型不支持参考图", variant: "danger" });
      return false;
    }
    if (
      current.current.length + pending.current >=
      model.capabilities.maxReferenceImages
    ) {
      toast({
        title: `最多添加 ${model.capabilities.maxReferenceImages} 张参考图`,
      });
      return false;
    }
    return true;
  };

  const add = (item: ReferenceItem) => {
    if (
      current.current.some(
        (ref) => ref.key === item.key && ref.kind === item.kind,
      )
    )
      return false;
    if (!room()) return false;
    current.current = [...current.current, item];
    onChange(current.current);
    return true;
  };

  const upload = async (file: File) => {
    if (!IMAGE_TYPES.has(file.type) || file.size === 0) {
      toast({
        title: "请选择有效的 PNG、JPEG 或 WEBP 图片",
        variant: "danger",
      });
      return;
    }
    if (!room()) return;
    const startedModel = model?.id;
    pending.current += 1;
    setUploading(pending.current);
    try {
      const result = await uploadReferenceImage(file);
      if (!alive.current || modelId.current !== startedModel) return;
      current.current = [
        ...current.current,
        {
          kind: "upload",
          key: result.key,
          previewUrl: `/api/upload?key=${encodeURIComponent(result.key)}`,
        },
      ];
      onChange(current.current);
    } catch (error) {
      if (alive.current)
        toast({
          title: "参考图上传失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "danger",
        });
    } finally {
      pending.current -= 1;
      if (alive.current) setUploading(pending.current);
    }
  };

  return { add, upload, uploading };
}
