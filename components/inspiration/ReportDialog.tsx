"use client";

import { Flag } from "lucide-react";
import { useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  RadioGroup,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  REPORT_REASON_OPTIONS,
  type InspirationReportReason,
} from "@/lib/inspiration-report";

import {
  inspirationRequest,
  InspirationApiError,
  loginForCurrentPage,
} from "./api";

interface ReportDialogProps {
  postId: string;
  commentId?: string;
  triggerClassName?: string;
}

export function ReportDialog({
  postId,
  commentId,
  triggerClassName,
}: ReportDialogProps): React.ReactElement {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<InspirationReportReason | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const resetForm = () => {
    setReason("");
    setNote("");
    setError("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await inspirationRequest(`/api/inspiration/posts/${postId}/report`, {
        method: "POST",
        body: JSON.stringify({
          reason,
          note: note.trim() || null,
          ...(commentId ? { commentId } : {}),
        }),
      });
      setOpen(false);
      resetForm();
      toast({
        title: "举报已提交",
        description: "管理员会在审核队列中复核这条内容。",
      });
    } catch (cause) {
      if (cause instanceof InspirationApiError && cause.status === 401) {
        setOpen(false);
        return loginForCurrentPage();
      }
      const message = cause instanceof Error ? cause.message : "请稍后重试";
      setError(message);
      toast({ title: "举报失败", description: message, variant: "danger" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button
          variant="ghost"
          className={triggerClassName}
          aria-label="举报内容"
        >
          <Flag size={15} aria-hidden="true" /> 举报
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(720px,calc(100vh-32px))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{commentId ? "举报这条评论" : "举报这条内容"}</DialogTitle>
          <DialogDescription>
            请选择最符合的原因。举报会交由管理员复核，不会直接通知作者。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 pb-5">
          <div>
            <p id="report-reason-label" className="mb-3 text-sm font-medium">
              举报原因 <span className="text-danger">*</span>
            </p>
            <RadioGroup
              name="report-reason"
              value={reason}
              onValueChange={(value) => {
                setReason(value as InspirationReportReason);
                setError("");
              }}
              options={REPORT_REASON_OPTIONS}
              aria-labelledby="report-reason-label"
              disabled={submitting}
              className="gap-3.5"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="report-note" className="text-sm font-medium">
                补充说明{" "}
                <span className="font-normal text-text-faint">（可选）</span>
              </label>
              <span id="report-note-count" className="text-xs text-text-faint">
                {note.length}/2000
              </span>
            </div>
            <Textarea
              id="report-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2_000}
              disabled={submitting}
              aria-describedby="report-note-help report-note-count"
              placeholder="请描述具体位置、出处或可能造成的影响，方便管理员判断。"
              className="min-h-24"
            />
            <p
              id="report-note-help"
              className="mt-1.5 text-xs leading-5 text-text-muted"
            >
              请勿填写联系方式、账号密码等敏感信息。
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            disabled={!reason}
            loading={submitting}
          >
            提交举报
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
