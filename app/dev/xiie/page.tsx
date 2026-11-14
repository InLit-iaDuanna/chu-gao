import { notFound } from "next/navigation";

import { Xiie } from "@/components/studio/chat/Xiie";
import { XIIE_POSES } from "@/components/studio/chat/xiie-art";

// Design-review sheet for Xiie: each pose live (poke it), then a strip of
// frozen frames. Never served in production.
export const dynamic = "force-dynamic";

export default async function XiiePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ pose?: string; step?: string; theme?: string; pixel?: string; from?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { pose, step, theme, pixel, from } = await searchParams;
  const poses = XIIE_POSES.filter((name) => !pose || pose.split(",").includes(name));
  const gap = Number(step) || 0.2;
  const start = Number(from) || 0;
  const size = Number(pixel) || (poses.length > 4 ? 2 : 4);
  const frames = Array.from({ length: size > 2 ? 7 : 9 }, (_, index) => start + index * gap);
  const dark = theme === "dark";
  return (
    <main
      className={`${dark ? "dark" : "light"} flex min-h-screen flex-col gap-3 p-4`}
      style={{ background: dark ? "#262626" : "#fff", color: dark ? "#aaa" : "#555" }}
    >
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.className=${JSON.stringify(dark ? "dark" : "light")}`,
        }}
      />
      {poses.map((name) => (
        <section key={name} className="flex items-end gap-2" data-puppet={name}>
          <Xiie pose={name} pixel={size} />
          {frames.map((at) => (
            <Xiie key={at} pose={name} at={at} pixel={size} />
          ))}
          <code className="text-[10px]">{name}</code>
        </section>
      ))}
    </main>
  );
}
