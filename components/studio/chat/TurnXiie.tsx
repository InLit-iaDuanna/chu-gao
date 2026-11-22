"use client";

import { useEffect, useState } from "react";

import { Xiie, type XiieCue, type XiiePose } from "./Xiie";
import styles from "./Xiie.module.css";

/** How long Xiie celebrates a finished reply before it sinks away. */
const CHEER_MS = 2_600;
/** A little longer than the slot's closing transition in Xiie.module.css. */
const LEAVE_MS = 340;

/** Which Xiie goes with what a running turn is doing right now. */
export function turnPose({
  status,
  activity,
  hasText,
  connection = "connected",
}: {
  status?: string;
  activity?: string;
  hasText?: boolean;
  connection?: "connected" | "reconnecting" | "disconnected";
}): XiiePose {
  if (connection === "disconnected") return "sleeping";
  if (connection === "reconnecting" || activity === "retrying") return "debugging";
  if (status === "queued" || activity === "queued") return "running";
  switch (activity) {
    case "context":
    case "preparing_context":
    case "searching":
      return "reading";
    case "reasoning":
      return "focus";
    case "image_tool":
      return "idea";
    case "image_generating":
      return "building";
    case "answering":
      return "coding";
    default:
      return hasText ? "coding" : "thinking";
  }
}

/** Holds Xiie's place under a turn, and lets it sink away when `pose` clears. */
export function XiieSlot({
  pose,
  cue,
}: {
  pose: XiiePose | null;
  /** A reaction to play, such as a nod or a little heart. */
  cue?: XiieCue | null;
}) {
  const [last, setLast] = useState(pose);
  useEffect(() => {
    if (pose) {
      setLast(pose);
      return;
    }
    const timer = setTimeout(() => setLast(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [pose]);
  const shown = pose ?? last;
  if (!shown) return null;
  return (
    <div className={pose ? styles.slot : `${styles.slot} ${styles.leaving}`}>
      <Xiie pose={shown} cue={pose ? cue : null} />
    </div>
  );
}

/**
 * Xiie keeping an assistant turn company: a pose for each stage of the work,
 * a cheer when the reply lands (only for a turn it watched running), and a
 * worried look from behind its screen if the latest turn broke off.
 */
export function TurnXiie({
  active,
  status,
  activity,
  hasText,
  connection,
  latest,
}: {
  active: boolean;
  status?: string;
  activity?: string;
  hasText: boolean;
  connection?: "connected" | "reconnecting" | "disconnected";
  /** Whether this is the newest reply in the conversation. */
  latest: boolean;
}) {
  const [wasActive, setWasActive] = useState(active);
  const [cheering, setCheering] = useState(false);
  // Decided while rendering, so the cheer follows the work without a gap.
  if (wasActive !== active) {
    setWasActive(active);
    setCheering(!active && status === "completed");
  }
  useEffect(() => {
    if (!cheering) return;
    const timer = setTimeout(() => setCheering(false), CHEER_MS);
    return () => clearTimeout(timer);
  }, [cheering]);

  const broken = ["failed", "incomplete", "interrupted"].includes(status ?? "");
  const pose = active
    ? turnPose({ status, activity, hasText, connection })
    : cheering
      ? "done"
      : broken && latest
        ? "debugging"
        : null;
  return <XiieSlot pose={pose} />;
}
