import type {
  Announcement,
  AnnouncementDisplayMode as DbDisplayMode,
  AnnouncementTone as DbTone,
} from "@prisma/client";

import { db } from "@/lib/db";

export type AnnouncementTone = "info" | "warning" | "success" | "danger";
export type AnnouncementDisplayMode = "banner" | "popup" | "both";

/** 面向公众的已生效公告（小写枚举、只含必要字段）。 */
export interface PublicAnnouncement {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementTone;
  displayMode: AnnouncementDisplayMode;
  linkLabel: string | null;
  linkUrl: string | null;
}

/** 管理端使用的完整公告记录。 */
export interface AdminAnnouncement extends PublicAnnouncement {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const TONE_TO_PUBLIC: Record<DbTone, AnnouncementTone> = {
  INFO: "info",
  WARNING: "warning",
  SUCCESS: "success",
  DANGER: "danger",
};

const DISPLAY_MODE_TO_PUBLIC: Record<DbDisplayMode, AnnouncementDisplayMode> = {
  BANNER: "banner",
  POPUP: "popup",
  BOTH: "both",
};

const TONE_TO_DB: Record<AnnouncementTone, DbTone> = {
  info: "INFO",
  warning: "WARNING",
  success: "SUCCESS",
  danger: "DANGER",
};

const DISPLAY_MODE_TO_DB: Record<AnnouncementDisplayMode, DbDisplayMode> = {
  banner: "BANNER",
  popup: "POPUP",
  both: "BOTH",
};

export function toneToDb(tone: AnnouncementTone): DbTone {
  return TONE_TO_DB[tone];
}

export function displayModeToDb(mode: AnnouncementDisplayMode): DbDisplayMode {
  return DISPLAY_MODE_TO_DB[mode];
}

export function serializeAnnouncement(row: Announcement): AdminAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tone: TONE_TO_PUBLIC[row.tone],
    displayMode: DISPLAY_MODE_TO_PUBLIC[row.displayMode],
    linkLabel: row.linkLabel,
    linkUrl: row.linkUrl,
    enabled: row.enabled,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 当前对用户可见的公告：启用且在投放时间窗内，按最新创建排序。 */
export async function listActiveAnnouncements(
  now = new Date(),
): Promise<PublicAnnouncement[]> {
  const rows = await db.announcement.findMany({
    where: {
      enabled: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return rows.map((row) => {
    const { id, title, body, tone, displayMode, linkLabel, linkUrl } =
      serializeAnnouncement(row);
    return { id, title, body, tone, displayMode, linkLabel, linkUrl };
  });
}

export async function listAllAnnouncements(): Promise<AdminAnnouncement[]> {
  const rows = await db.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(serializeAnnouncement);
}
