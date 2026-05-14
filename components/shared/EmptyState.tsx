import type { ReactNode } from "react";

import { EmptyState as UiEmptyState } from "@/components/ui";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}): React.ReactElement {
  return (
    <UiEmptyState action={action} description={description} title={title} />
  );
}
