import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { AccentColorProvider } from "@/components/shared/AccentColorProvider";
import { AppThemeProvider } from "@/components/shared/AppThemeProvider";
import { AnnouncementBanner } from "@/components/shared/AnnouncementBanner";
import { ToastProvider, TooltipProvider } from "@/components/ui";
import {
  listActiveAnnouncements,
  type PublicAnnouncement,
} from "@/lib/announcements";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chūgǎo Studio",
  description: "为设计学生提供统一的海外图像生成工作台。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

async function getAnnouncements(): Promise<PublicAnnouncement[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    return await listActiveAnnouncements();
  } catch {
    return [];
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const announcements = await getAnnouncements();

  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">
        <AppThemeProvider>
          <AccentColorProvider>
            <TooltipProvider delayDuration={350}>
              <ToastProvider>
                <Suspense fallback={null}>
                  <AnnouncementBanner announcements={announcements} />
                </Suspense>
                {children}
              </ToastProvider>
            </TooltipProvider>
          </AccentColorProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
