import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Nav from "@/components/Nav.tsx";
import { PreferencesProvider } from "@/components/PreferencesContext.tsx";
import { ProfileProvider } from "@/components/ProfileContext.tsx";
import { getDb } from "@/lib/db";
import { makePrefsRepo } from "@/lib/repo/prefsRepo.ts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Budget",
  description: "Personal finance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const prefs = makePrefsRepo(getDb()).getAll();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ProfileProvider>
          <PreferencesProvider value={{ hideExcludedByDefault: prefs.hideExcludedByDefault }}>
            <Nav />
            {children}
          </PreferencesProvider>
        </ProfileProvider>
      </body>
    </html>
  );
}
