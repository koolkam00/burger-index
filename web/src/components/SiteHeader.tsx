"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ComponentType, type MouseEvent } from "react";
import { fromPath, track } from "@/lib/analytics";
import { isRankingPath, NAV, PEOPLES_TOP_PATH, RANKER_FOCUS_EVENT, RANKER_HREF } from "@/lib/site";
import { Buoy, CompassRose, LifeRing, RopeLadder, ShipWheel, Spyglass, type IconProps } from "./icons/nautical";
import { ThemeToggle } from "./theme";
import { Wordmark } from "./Wordmark";

/**
 * Restaurant and ranking pages belong to Burgers; borough pages to the Index, whose borough section
 * they grew from.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/boroughs/");
  return pathname === href || pathname.startsWith(`${href}/`) || (href === "/burgers" && (pathname.startsWith("/restaurants/") || isRankingPath(pathname)));
}

/** Menu-sheet row icons (DESIGN.md "Original nautical set"). */
const SHEET_ICON: Record<string, ComponentType<IconProps>> = {
  "/": LifeRing,
  "/burgers": Spyglass,
  [PEOPLES_TOP_PATH]: RopeLadder,
  "/map": CompassRose,
  "/neighborhoods": Buoy,
};

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const sheetRef = useRef<HTMLDialogElement>(null);

  // Close the menu sheet on navigation.
  useEffect(() => {
    sheetRef.current?.close();
  }, [pathname]);

  /** The search button (the header's, and the menu sheet's below sm): already on /burgers, it just focuses the search box. */
  const searchClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const input = document.getElementById("search");
    if (pathname === "/burgers" && input) {
      e.preventDefault();
      sheetRef.current?.close();
      input.focus();
      input.scrollIntoView({ block: "center" });
    }
  };

  /**
   * "Rank your burgers" (the header's and the menu sheet's): links to the home ranker (/#rank). On the home
   * page it scrolls to the ranker and focuses it instead (after the sheet has handed focus back).
   */
  const rankClick = (e: MouseEvent<HTMLAnchorElement>) => {
    sheetRef.current?.close();
    if (pathname !== "/" || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    requestAnimationFrame(() => window.dispatchEvent(new Event(RANKER_FOCUS_EVENT)));
  };

  /** A nav link followed: the People's Top 10 is reported (peoples_top_clicked), the others aren't. */
  const navClick = (href: string, surface: "nav" | "menu_sheet") => {
    if (href === PEOPLES_TOP_PATH) track("peoples_top_clicked", { surface, from_path: fromPath(pathname) });
  };

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
                  <Link href={item.href} className="nav-link" aria-current={isActive(pathname, item.href) ? "page" : undefined} onClick={() => navClick(item.href, "nav")}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-none items-center gap-1 sm:gap-2">
            {/* One-tap search at every width (user decision 2026-09-25), next to "Rank your burgers"; the menu
                sheet keeps its own "Search" below sm. */}
            <Link href="/burgers#search" className="wood-btn search-btn" aria-label="Search burgers" title="Search burgers" onClick={searchClick}>
              <Search strokeWidth={2} aria-hidden="true" />
            </Link>
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            <Link href={RANKER_HREF} className="btn btn-primary rank-cta" onClick={rankClick}>
              <RopeLadder className="hidden sm:block" aria-hidden="true" />
              Rank your burgers
            </Link>
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
            <div className="sheet-actions">
              <Link href={RANKER_HREF} className="btn btn-primary btn-lg sheet-cta" onClick={rankClick}>
                <RopeLadder aria-hidden="true" />
                Rank your burgers
              </Link>
              <Link href="/burgers#search" className="btn btn-secondary btn-lg sm:hidden" onClick={searchClick}>
                <Search strokeWidth={2} aria-hidden="true" />
                Search
              </Link>
            </div>
            <p className="kicker t-kicker mt-6 mb-2">On the menu</p>
            <ul>
              {NAV.map((item) => {
                const Icon = SHEET_ICON[item.href] ?? LifeRing;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="sheet-link t-display-s"
                      aria-current={isActive(pathname, item.href) ? "page" : undefined}
                      onClick={() => {
                        navClick(item.href, "menu_sheet");
                        sheetRef.current?.close();
                      }}
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
