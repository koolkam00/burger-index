"use client";

import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { NAV } from "@/lib/site";
import { ThemeToggle } from "./theme";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`) || (href === "/burgers" && pathname.startsWith("/restaurants/"));
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-the">The</span>Burger Index
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const sheetRef = useRef<HTMLDialogElement>(null);

  // Close the menu sheet on navigation.
  useEffect(() => {
    sheetRef.current?.close();
  }, [pathname]);

  return (
    <header className="site-header no-print">
      <div className="wrap flex h-full items-center justify-between gap-4">
        <Link href="/" className="flex h-11 items-center" aria-label="The Burger Index, home">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden h-full lg:block">
          <ul className="flex h-full items-center gap-6">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="nav-link" aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-1">
          <Link
            href="/burgers#search"
            className="icon-btn"
            aria-label="Search burgers"
            title="Search burgers"
            onClick={(e) => {
              // Already on /burgers: just focus the search box.
              const input = document.getElementById("search");
              if (pathname === "/burgers" && input) {
                e.preventDefault();
                input.focus();
                input.scrollIntoView({ block: "center" });
              }
            }}
          >
            <Search strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <ThemeToggle />
          <button
            type="button"
            className="icon-btn lg:hidden"
            aria-label="Open menu"
            aria-haspopup="dialog"
            onClick={() => sheetRef.current?.showModal()}
          >
            <Menu strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      <dialog
        ref={sheetRef}
        className="sheet sheet-full lg:hidden"
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="wrap flex h-[var(--nav-h)] flex-none items-center justify-between border-b border-line">
            <Wordmark />
            <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => sheetRef.current?.close()}>
              <X strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Main" className="wrap flex-1 overflow-y-auto py-4">
            <ul>
              {NAV.map((item) => (
                <li key={item.href} className="border-b border-line">
                  <Link
                    href={item.href}
                    className="t-display-s flex min-h-14 items-center py-3"
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                    onClick={() => sheetRef.current?.close()}
                  >
                    <span className={isActive(pathname, item.href) ? "border-b-2 border-accent" : undefined}>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </dialog>
    </header>
  );
}
