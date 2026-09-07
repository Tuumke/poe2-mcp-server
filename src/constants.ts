/**
 * Project-wide constants.
 * Single source of truth for values shared across tools and services.
 *
 * DEFAULT_LEAGUE can be overridden at startup via `--league "League Name"` CLI argument.
 * When not provided, falls back to the hardcoded current challenge league.
 */

import { z } from 'zod';

/** Hardcoded fallback league. Update each league rotation. */
const FALLBACK_LEAGUE = 'Forbidden Rites';

/**
 * Read a named CLI argument value from process.argv.
 * @param flag - CLI flag name (e.g., '--league')
 * @returns The argument value, or undefined if not provided
 */
function readCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

/** Default league for all tools. Overridable via `--league` CLI argument. */
export const DEFAULT_LEAGUE = readCliArg('--league') ?? FALLBACK_LEAGUE;

/** Shared Zod schema for the league parameter used by all tools. */
export const LeagueSchema = z
  .string()
  .default(DEFAULT_LEAGUE)
  .describe(
    `PoE2 league name. Current default: "${DEFAULT_LEAGUE}". ` +
      `Challenge leagues: "Forbidden Rites", "Runes of Aldur", "Fate of the Vaal", "Rise of the Abyssal", ` +
      `"Dawn of the Hunt". ` +
      `Permanent leagues: "Standard", "Hardcore". ` +
      `Hardcore variants: "HC Forbidden Rites", "HC Runes of Aldur".`,
  );
