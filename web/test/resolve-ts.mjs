// `npm test` runs the TypeScript sources directly (node --experimental-strip-types). The app imports
// them bundler-style, without an extension ("./schema", "@/lib/format"); this hook adds the ".ts"
// Node's resolver needs. Test-only: the Next build never loads it.
import { registerHooks } from "node:module";

const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    try {
      return nextResolve(target, context);
    } catch (err) {
      if (target.startsWith(".") || target.startsWith("file:")) return nextResolve(`${target}.ts`, context);
      throw err;
    }
  },
});
