"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ComponentType } from "react";
import { NAV } from "@/lib/site";
import { Buoy, CompassRose, LifeRing, Scales, ShipWheel, Spyglass, type IconProps } from "./icons/nautical";
import { ThemeToggle } from "./theme";
import { Wordmark } from "./Wordmark";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`) || (href === "/burgers" && pathname.startsWith("/restaurants/"));
}

/** Menu-sheet row icons (DESIGN.md "Original nautical set"). */
const SHEET_ICON: Record<string, ComponentType<IconProps>> = {
  "/": LifeRing,
  "/burgers": Spyglass,
  "/peoples-price": Scales,
  "/map": CompassRose,
  "/neighborhoods": Buoy,
  "/boroughs": ShipWheel,
};

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const sheetRef = useRef<HTMLDialogElement>(null);

  // Close the menu sheet on navigation.
  useEffect(() => {
    sheetRef.current?.close();
  }, [pathname]);

  return (
    <header className="site-header atmo no-print">
      {/* The facade: honey-wood planks with a rope trim along the bottom edge. */}
      <div className="facade">
        <div className="wrap flex h-full items-center justify-between gap-3">
          <Link href="/" className="home-link flex h-11 min-w-0 items-center rounded-[10px]" aria-label="The Burger Index, home">
            <Wordmark />
          </Link>

          <nav aria-label="Main" className="hidden h-full lg:block">
            <ul className="flex h-full items-center gap-1 xl:gap-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="nav-link" aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-none items-center gap-1 sm:gap-2">
            <Link
              href="/burgers#search"
              className="wood-btn"
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
              <Search strokeWidth={2} aria-hidden="true" />
            </Link>
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            {/* A wheel alone is not a recognizable menu icon, so the word "Menu" is shown too. */}
            <button type="button" className="wood-btn menu-btn lg:hidden" aria-haspopup="dialog" onClick={() => sheetRef.current?.showModal()}>
              <ShipWheel aria-hidden="true" />
              Menu
            </button>
          </div>
        </div>
      </div>
      <span className="rope rope-flat" aria-hidden="true" />

      <dialog
        ref={sheetRef}
        className="sheet sheet-full atmo lg:hidden"
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="flex h-full flex-col">
          <span className="rope rope-flat" aria-hidden="true" />
          <div className="wrap flex h-16 flex-none items-center justify-between">
            <Wordmark />
            <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => sheetRef.current?.close()}>
              <X strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Main" className="wrap flex-1 overflow-y-auto pb-4">
            <p className="kicker t-kicker mb-2">On the menu</p>
            <ul>
              {NAV.map((item) => {
                const Icon = SHEET_ICON[item.href] ?? LifeRing;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="sheet-link t-display-s"
                      aria-current={isActive(pathname, item.href) ? "page" : undefined}
                      onClick={() => sheetRef.current?.close()}
                    >
                      <span className="sheet-label min-w-0">{item.label}</span>
                      <span className="menu-leader" aria-hidden="true" />
                      <Icon />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 border-t-2 border-line pt-4">
              <ThemeToggle label="always" />
            </div>
          </nav>
        </div>
      </dialog>
    </header>
  );
}
