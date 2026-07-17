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
  // suppressHydrationWarning on <html>: the inline script below sets data-theme on it before hydration,
  // so its attributes intentionally differ from the server render — scoped to <html>'s own attributes
  // only (children still hydrate normally).
  return (
    <html lang="en" className="overscroll-x-none" suppressHydrationWarning>
      {/* overscroll-x-none disables the macOS two-finger swipe-back gesture so panning the
          canvas left at its edge can't navigate the browser back (set on both html and body
          to cover viewport overscroll-behavior propagation). */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} antialiased overscroll-x-none`}
        suppressHydrationWarning
      >
        {/* Apply the saved theme before paint so light mode doesn't flash dark. No saved pref → dark (default). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('reels:theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');else document.documentElement.removeAttribute('data-theme');}catch(e){}})();`,
          }}
        />
        <RangeSliderSync />
        {children}
      </body>
    </html>
  );
}
