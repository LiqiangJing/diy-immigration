import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pathway · NIW / EB-1A DIY 助手",
  description: "自己准备 NIW 和 EB-1A 移民申请的 AI 助手",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
