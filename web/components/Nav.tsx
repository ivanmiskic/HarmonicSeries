"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const links = [
  { href: "/#project", label: "Project" },
  { href: "/#performance", label: "Performance" },
  { href: "/#calculator", label: "Calculator" },
  { href: "/dashboard", label: "Lab" },
  { href: "https://github.com/ivanmiskic/HarmonicSeries", label: "GitHub", external: true },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-40 w-max max-w-[95vw]">
      <div className="flex items-center gap-1 rounded-full px-2 py-2 ring-1 ring-white/10 bg-base/80 backdrop-blur-xl">
        <Link href="/" className="px-3 py-1.5 text-sm font-semibold text-accent">Harmonic</Link>
        {links.map((l) => (
          l.external ? (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm rounded-full transition-colors text-muted hover:text-foreground"
            >
              {l.label}
            </a>
          ) : (
          <Link
            key={l.href}
            href={l.href}
            className={clsx(
              "px-3 py-1.5 text-sm rounded-full transition-colors",
              path === l.href ? "bg-white/10 text-foreground" : "text-muted hover:text-foreground"
            )}
          >
            {l.label}
          </Link>
          )
        ))}
      </div>
    </nav>
  );
}
