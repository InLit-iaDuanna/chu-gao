export const REPORT_REASON_VALUES = [
  "COPYRIGHT",
  "HARASSMENT",
  "SPAM",
  "NSFW",
  "MISINFORMATION",
  "OTHER",
] as const;

export type InspirationReportReason = (typeof REPORT_REASON_VALUES)[number];

export const REPORT_REASON_OPTIONS: Array<{
  value: InspirationReportReason;
  label: string;
  description: string;
}> = [
  {
    value: "COPYRIGHT",
    label: "版权或来源问题",
    description: "未经授权转载、冒用原创，或来源标注不清。",
  },
  {
    value: "HARASSMENT",
    label: "骚扰或攻击",
    description: "人身攻击、歧视、威胁或针对个人的恶意内容。",
  },
  {
    value: "SPAM",
    label: "广告或刷屏",
    description: "无关推广、恶意引流，或大量重复发布。",
  },
  {
    value: "NSFW",
    label: "不适宜内容",
    description: "色情、血腥暴力，或其他不适合公开展示的内容。",
  },
  {
    value: "MISINFORMATION",
    label: "虚假或误导信息",
    description: "捏造事实、冒充身份，或可能造成明显误导。",
  },
  {
    value: "OTHER",
    label: "其他问题",
    description: "以上分类都不符合时选择，可在下方补充说明。",
  },
];
