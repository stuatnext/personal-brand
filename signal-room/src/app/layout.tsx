import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { passcodeConfigured } from "@/lib/auth";
import { getProvider } from "@/lib/ai/provider";
import { backendName } from "@/lib/db/client";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Signal Room",
  description: "Stuart Crowley's private prediction-markets editorial intelligence system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const provider = getProvider();
  const localMode = !passcodeConfigured();
  return (
    <html lang="en-GB" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <div className="flex min-h-screen">
          <aside className="fixed inset-y-0 left-0 z-20 flex w-[210px] flex-col border-r hairline bg-[#0a0a09]">
            <div className="border-b hairline px-4 pb-4 pt-5">
              <div className="font-mono text-[15px] font-semibold leading-tight tracking-[0.22em] text-[--color-fg]">
                SIGNAL
                <br />
                <span className="text-[--color-signal]">ROOM</span>
              </div>
              <div className="k-label mt-2">Editorial intelligence</div>
            </div>
            <Nav />
            <div className="mt-auto space-y-2 border-t hairline px-4 py-4">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${provider.isReal ? "bg-[--color-ok]" : "bg-[--color-signal]"}`}
                />
                <span className="k-label !text-[--color-mut]">
                  {provider.isReal ? "claude live" : "mock provider"}
                </span>
              </div>
              <div className="k-label">db · {backendName()}</div>
              {localMode ? <div className="tag tag-signal">local mode</div> : null}
            </div>
          </aside>
          <main className="ml-[210px] min-h-screen flex-1">
            <div className="mx-auto max-w-[1180px] px-7 py-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
