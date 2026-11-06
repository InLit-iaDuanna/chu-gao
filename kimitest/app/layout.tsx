import type { Metadata } from "next";
import { Suspense } from "react";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { AppThemeProvider } from "@/components/shared/AppThemeProvider";
import { AnnouncementBanner } from "@/components/shared/AnnouncementBanner";
import { DeferredStylesheet } from "@/components/shared/DeferredStylesheet";
import { ToastProvider } from "@/components/ui";
import {
  getPublicRuntimeConfig,
  SystemConfigUnavailableError,
} from "@/lib/system-config";
import "./globals.css";

// Fraunces — 编辑级高对比衬线，驱动 Display 排版（variable 全字重 + 斜体）。
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

// LXGW WenKai is a large, optional CJK serif fallback — load it off the critical path.
const CJK_SERIF_HREF =
  "https://chinese-fonts-cdn.deno.dev/packages/lxgwwenkai/dist/LXGWWenKai-Regular/result.css";

export const metadata: Metadata = {
  title: "Chūgǎo Studio",
  description: "为设计学生提供统一的海外图像生成工作台。",
};

export const dynamic = "force-dynamic";

async function getAnnouncement() {
  try {
    const config = await getPublicRuntimeConfig();
    return config.announcement;
  } catch (error) {
    if (error instanceof SystemConfigUnavailableError) {
      return null;
    }

    throw error;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const announcement = await getAnnouncement();

  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">
        <AppThemeProvider>
          <ToastProvider>
            <Suspense fallback={null}>
              <AnnouncementBanner announcement={announcement} />
            </Suspense>
            {children}
          </ToastProvider>
        </AppThemeProvider>
        <DeferredStylesheet href={CJK_SERIF_HREF} />
      </body>
    </html>
  );
}
