import type { GenerationStatus } from "./types";

export function generationStatusLabel(status: GenerationStatus): string {
  switch (status) {
    case "PENDING":
      return "排队中";
    case "RUNNING":
      return "生成中";
    case "SUCCEEDED":
      return "已完成";
    case "FAILED":
      return "失败";
    case "CANCELED":
      return "已取消";
  }
}

export function generationStatusTone(status: GenerationStatus): string {
  switch (status) {
    case "SUCCEEDED":
      return "text-success";
    case "FAILED":
      return "text-danger";
    case "CANCELED":
      return "text-text-faint";
    default:
      return "text-accent";
  }
}
