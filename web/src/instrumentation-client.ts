// Runs in the browser before hydration (Next's client instrumentation file). Starts PostHog when the
// build has NEXT_PUBLIC_POSTHOG_KEY; without it this does nothing (src/lib/analytics.ts).
import { initAnalytics } from "./lib/analytics";

initAnalytics();
