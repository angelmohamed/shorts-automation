import type { Metadata } from "next";
import { Geist, Geist_Mono, Anton } from "next/font/google";
import "./globals.css";
import { RangeSliderSync } from "./components/RangeSliderSync";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Reels Studio",
  description: "Client-side reels canvas: paste a link or upload a video, trim, brand, and export MP4s.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="overscroll-x-none">
      {/* overscroll-x-none disables the macOS two-finger swipe-back gesture so panning the
          canvas left at its edge can't navigate the browser back (set on both html and body
          to cover viewport overscroll-behavior propagation). */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} antialiased overscroll-x-none`}
        suppressHydrationWarning
      >
        <RangeSliderSync />
        {children}
      </body>
    </html>
  );
}
