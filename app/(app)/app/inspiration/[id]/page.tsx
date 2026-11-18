import { PostDetail } from "@/components/inspiration/PostDetail";

export default async function InspirationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <PostDetail postId={id} basePath="/app/inspiration" />
    </div>
  );
}
