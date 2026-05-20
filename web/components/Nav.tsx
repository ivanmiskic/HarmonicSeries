"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";

const SECTION_IDS = ["harmonic", "project", "performance", "calculator"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const sectionLinks: { id: SectionId; href: string; label: string }[] = [
  { id: "project", href: "/#project", label: "Project" },
  { id: "performance", href: "/#performance", label: "Performance" },
  { id: "calculator", href: "/#calculator", label: "Calculator" },
];

function activeFromScroll(): SectionId {
  const offset = window.scrollY + window.innerHeight * 0.35;
  let current: SectionId = "harmonic";
  for (const id of SECTION_IDS) {
    const el = document.getElementById(id);
    if (el && el.offsetTop <= offset) current = id;
  }
  return current;
}

export function Nav() {
  const path = usePathname();
  const onHome = path === "/";
  const [activeSection, setActiveSection] = useState<SectionId>("harmonic");

  useEffect(() => {
    if (!onHome) return;

    const update = () => setActiveSection(activeFromScroll());
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [onHome]);

  const linkClass = (active: boolean) =>
    clsx(
      "px-3 py-1.5 text-sm rounded-full transition-colors",
      active ? "bg-white/10 text-foreground" : "text-muted hover:text-foreground",
    );

  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-40 w-max max-w-[95vw]">
      <div className="flex items-center gap-1 rounded-full px-2 py-2 ring-1 ring-white/10 bg-base/80 backdrop-blur-xl">
        <Link
          href="/#harmonic"
          className={clsx(
            "px-3 py-1.5 text-sm font-semibold rounded-full transition-colors",
            onHome && activeSection === "harmonic" ? "text-accent bg-white/10" : "text-accent hover:bg-white/5",
          )}
        >
          Harmonic
        </Link>
        {sectionLinks.map((l) => (
          <Link key={l.id} href={l.href} className={linkClass(onHome && activeSection === l.id)}>
            {l.label}
          </Link>
        ))}
        <Link href="/dashboard" className={linkClass(path === "/dashboard")}>
          Lab
        </Link>
      </div>
    </nav>
  );
}
