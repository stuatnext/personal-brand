"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Today" },
  { href: "/briefing", label: "Briefing" },
  { href: "/paste", label: "Paste" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/stories", label: "Stories" },
  { href: "/theses", label: "Theses" },
  { href: "/people", label: "People" },
  { href: "/drafts", label: "Drafts" },
  { href: "/archive", label: "Archive" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex-1 py-3">
      {LINKS.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link key={l.href} href={l.href} className={`nav-link ${active ? "active" : ""}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
