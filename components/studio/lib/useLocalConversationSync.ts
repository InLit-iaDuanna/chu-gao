"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { updateConversation } from "./api";
import {
  deleteLocalConversation,
  isLocalStoreAvailable,
  saveConversationSnapshot,
} from "./local-conversations";
import type { Conversation } from "./types";
import { hasNativeBridge, onNativeEvent } from "@/lib/native-bridge";

/** 新建对话的保存位置。 */
export type DraftStorageChoice = "local" | "cloud";

const TIP_STORAGE_KEY = "chugao.native.local-storage-tip.v1";
const SNAPSHOT_DEBOUNCE_MS = 1_500;

function readTipDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TIP_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function rememberTipDismissed() {
  try {
    window.localStorage.setItem(TIP_STORAGE_KEY, "1");
  } catch {
    // 隐私模式下无法持久化，最多每次启动再提示一次。
  }
}

/**
 * 安卓 APP 内的本机对话同步：
 * - 新对话默认「仅保存在本机」，可切换为云端；
 * - LOCAL 对话在打开与每轮对话结束后把服务端完整对话写入本机快照（防抖 1.5s）；
 * - 已有对话可在两种保存位置之间切换（PATCH /api/conversations/:id）。
 * 网页端（无原生桥）所有能力关闭，行为保持不变。
 */
export function useLocalConversationSync({
  conversation,
  busy,
}: {
  conversation: Conversation | null;
  busy: boolean;
}) {
  const [isNativeApp, setIsNativeApp] = useState(false);
  const [draftStorage, setDraftStorage] = useState<DraftStorageChoice>("local");
  const [tipVisible, setTipVisible] = useState(false);
  const [switchingStorage, setSwitchingStorage] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 只在浏览器端判断原生桥，避免 SSR/水合结果不一致。
  useEffect(() => {
    setIsNativeApp(hasNativeBridge());
  }, []);

  // 首次在 APP 内看到新对话时提示一次。
  useEffect(() => {
    if (!isNativeApp || conversation || readTipDismissed()) return;
    setTipVisible(true);
    rememberTipDismissed();
  }, [conversation, isNativeApp]);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /** 立即写入本机快照；CLOUD 对话直接跳过。 */
  const writeSnapshot = useCallback(
    (target: Conversation | null) => {
      if (!isNativeApp || !target) return;
      if (target.storage !== "local") return;
      void saveConversationSnapshot(target);
    },
    [isNativeApp],
  );

  /** 防抖 1.5 秒后写入本机快照。 */
  const scheduleSnapshot = useCallback(
    (target: Conversation | null) => {
      if (!isNativeApp || !target) return;
      if (target.storage !== "local") return;
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        void saveConversationSnapshot(target);
      }, SNAPSHOT_DEBOUNCE_MS);
    },
    [clearTimer, isNativeApp],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  // 一轮对话结束（完成 / 失败 / 取消）后落盘；打开 LOCAL 对话也会触发。
  useEffect(() => {
    if (!isNativeApp || busy) return;
    if (!conversation || conversation.storage !== "local") return;
    scheduleSnapshot(conversation);
  }, [
    busy,
    conversation,
    conversation?.id,
    conversation?.messages.length,
    conversation?.storage,
    isNativeApp,
    scheduleSnapshot,
  ]);

  const dismissTip = useCallback(() => {
    setTipVisible(false);
    rememberTipDismissed();
  }, []);

  /** 切换已有对话的保存位置。返回更新后的对话（失败时抛错，由调用方 toast）。 */
  const changeStorage = useCallback(
    async (
      id: string,
      storage: DraftStorageChoice,
    ): Promise<Conversation | null> => {
      if (!isNativeApp) return null;
      setSwitchingStorage(true);
      try {
        const updated = await updateConversation(id, { storage });
        if (storage === "local") {
          void saveConversationSnapshot(updated);
        } else {
          // CLOUD 对话不做本机快照，切回云端时删掉旧的本地副本。
          await deleteLocalConversation(id);
        }
        return updated;
      } finally {
        setSwitchingStorage(false);
      }
    },
    [isNativeApp],
  );

  return {
    isNativeApp,
    localStoreAvailable: isLocalStoreAvailable(),
    draftStorage,
    setDraftStorage,
    tipVisible,
    dismissTip,
    switchingStorage,
    scheduleSnapshot,
    writeSnapshot,
    changeStorage,
  };
}

/** 订阅原生 app.resume（APP 回到前台）。网页端不生效。 */
export function useNativeResumeEvent(callback: () => void) {
  const handler = useRef(callback);

  useEffect(() => {
    handler.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!hasNativeBridge()) return;
    return onNativeEvent("app.resume", () => handler.current());
  }, []);
}
