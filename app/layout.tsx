import type { Metadata } from "next";

import { AppThemeProvider } from "@/components/shared/AppThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chūgǎo Studio",
  description: "为设计学生提供统一的海外图像生成工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
