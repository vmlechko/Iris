import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const NAME = "Iris";
const TITLE = "Iris — support that arrives on time";
const DESCRIPTION =
  "Send money across a border as a commitment the person on the other side can see coming.";

export const metadata: Metadata = {
  applicationName: NAME,
  title: { default: TITLE, template: "%s · Iris" },
  description: DESCRIPTION,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: NAME,
  },
  other: { "mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: NAME,
    title: { default: TITLE, template: "%s · Iris" },
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: { default: TITLE, template: "%s · Iris" },
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#101014" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
