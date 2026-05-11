export function generationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: "排队中",
    RUNNING: "生成中",
    SUCCEEDED: "已完成",
    FAILED: "失败",
    CANCELED: "已取消",
  };

  return labels[status] ?? status;
}

export function generationStatusTone(status: string) {
  if (status === "FAILED") {
    return "text-danger";
  }

  if (status === "SUCCEEDED") {
    return "text-success";
  }

  if (status === "PENDING" || status === "RUNNING") {
    return "text-warning";
  }

  return "text-text-muted";
}
