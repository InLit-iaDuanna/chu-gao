import type { Metadata } from "next";
import { Suspense } from "react";

import { AppThemeProvider } from "@/components/shared/AppThemeProvider";
import { AnnouncementBanner } from "@/components/shared/AnnouncementBanner";
import { ToastProvider } from "@/components/ui";
import {
  getPublicRuntimeConfig,
  SystemConfigUnavailableError,
} from "@/lib/system-config";
import "./globals.css";

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
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <AppThemeProvider>
          <ToastProvider>
            <Suspense fallback={null}>
              <AnnouncementBanner announcement={announcement} />
            </Suspense>
            {children}
          </ToastProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
