/** Browser-only recovery for an intake POST whose response was lost. */
export interface IntakeSubmissionReceipt {
  clientRequestId: string;
  body: string;
  answer: string;
  projectId: string;
  previousTaskId: string | null;
  acceptedTaskId?: string;
}
const keyFor = (projectId: string) =>
  `chugao.research.intake.pending.v1:${projectId}`;

export function readIntakeReceipt(
  projectId: string,
): IntakeSubmissionReceipt | null {
  if (!projectId || typeof window === "undefined") return null;
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(keyFor(projectId)) || "null",
    );
    if (
      !value ||
      value.projectId !== projectId ||
      typeof value.body !== "string" ||
      typeof value.answer !== "string" ||
      !value.answer.trim() ||
      value.answer.length > 8000
    )
      return null;
    const body = JSON.parse(value.body);
    if (
      body.projectId !== projectId ||
      body.answer !== value.answer ||
      body.previousTaskId !== value.previousTaskId ||
      (value.clientRequestId !== undefined &&
        value.clientRequestId !== body.clientRequestId) ||
      typeof body.clientRequestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.clientRequestId,
      )
    )
      return null;
    if (
      value.acceptedTaskId !== undefined &&
      (typeof value.acceptedTaskId !== "string" ||
        !value.acceptedTaskId ||
        value.acceptedTaskId.length > 100)
    )
      return null;
    // Earlier v1 receipts kept the UUID only in the exact request body.
    return { ...value, clientRequestId: body.clientRequestId };
  } catch {
    return null;
  }
}

export function saveIntakeReceipt(receipt: IntakeSubmissionReceipt) {
  try {
    window.sessionStorage.setItem(
      keyFor(receipt.projectId),
      JSON.stringify(receipt),
    );
  } catch {
    throw new Error("浏览器暂时无法保存发送记录，请保留输入并重试。");
  }
}
export function clearIntakeReceipt(projectId: string) {
  try {
    window.sessionStorage.removeItem(keyFor(projectId));
  } catch {
    /* A later GET can still confirm the persisted task identity. */
  }
}
