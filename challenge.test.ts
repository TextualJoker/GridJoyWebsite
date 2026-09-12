/**
 * @file challenge.test.ts
 * @description Source-shape guard for challenge.html — the viral share-link
 * landing page served to users who tap a /challenge?g=... link without the
 * app installed. Silent failure mode: if a puzzle type is added to the app
 * but TYPE_LABELS in challenge.html isn't updated, the share-card renders
 * "undefined" instead of the puzzle name for every challenge of that type.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { ALL_PUZZLE_TYPES, PUZZLE_LABELS } from "@gridjoy/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, "challenge.html"), "utf8");

// ALL_PUZZLE_TYPES / PUZZLE_LABELS are imported from @gridjoy/core (the
// canonical source of truth) rather than copied. This is what makes this a
// real drift guard: adding a 19th puzzle type to core automatically fails
// these tests until challenge.html's TYPE_LABELS is updated to match. A
// hardcoded local copy would have to be hand-updated too, so it could not
// catch the very drift it claims to guard against.

/** Extracts the TYPE_LABELS object literal from the HTML source. */
const typeLabelBlock = (() => {
  const start = SRC.indexOf("var TYPE_LABELS");
  const end = SRC.indexOf("};", start) + 2;
  return start >= 0 && end > start ? SRC.slice(start, end) : "";
})();

/** The TYPE_LABELS object literal, parsed out of challenge.html. */
const typeLabels = (() => {
  if (!typeLabelBlock) return {} as Record<string, string>;
  // typeLabelBlock is "var TYPE_LABELS = {...}" — evaluate the literal in an
  // isolated VM context (no globals reachable) to get the real object.
  const literal = typeLabelBlock
    .replace(/^var TYPE_LABELS\s*=\s*/, "")
    .replace(/;\s*$/, "");
  return runInNewContext(`(${literal})`) as Record<string, string>;
})();

describe("challenge.html — TYPE_LABELS coverage", () => {
  it("TYPE_LABELS block is present and parses", () => {
    expect(typeLabelBlock.length).toBeGreaterThan(0);
    expect(Object.keys(typeLabels).length).toBeGreaterThan(0);
  });

  it("TYPE_LABELS key-set exactly matches @gridjoy/core ALL_PUZZLE_TYPES", () => {
    // Bidirectional: catches both a core type missing from challenge.html
    // (link renders "undefined") AND a stale type core has since removed.
    expect(new Set(Object.keys(typeLabels))).toEqual(new Set(ALL_PUZZLE_TYPES));
  });

  for (const type of ALL_PUZZLE_TYPES) {
    const label = PUZZLE_LABELS[type];
    it(`TYPE_LABELS["${type}"] === "${label}" (matches core)`, () => {
      expect(typeLabels[type]).toBe(label);
    });
  }
});

describe("challenge.html — TIER_LABELS", () => {
  it("has EASY tier (1)", () => expect(SRC).toContain('1: "EASY"'));
  it("has MEDIUM tier (2)", () => expect(SRC).toContain('2: "MEDIUM"'));
  it("has HARD tier (3)", () => expect(SRC).toContain('3: "HARD"'));
  it("has EXPERT tier (4)", () => expect(SRC).toContain('4: "EXPERT"'));
  it("has MASTER tier (5)", () => expect(SRC).toContain('5: "MASTER"'));
});

describe("challenge.html — Play Store URL", () => {
  it("PLAY_STORE_URL targets the correct package ID", () => {
    expect(SRC).toContain("id=app.gridjoy.puzzle");
  });

  it("PLAY_STORE_URL (legacy ?g= path) uses gift_link UTM campaign", () => {
    expect(SRC).toContain("utm_campaign%3Dgift_link");
  });

  it("ARENA_PLAY_STORE_URL (?id= path) uses arena_challenge UTM campaign", () => {
    expect(SRC).toContain("utm_campaign%3Darena_challenge");
  });

  it("renderInstallPrompt uses ARENA_PLAY_STORE_URL (not PLAY_STORE_URL)", () => {
    // The ?id= (public-arena) install CTA must use the arena_challenge
    // campaign so GA4 can distinguish arena→install from gift→install.
    expect(SRC).toContain("cta.href = ARENA_PLAY_STORE_URL");
  });
});

describe("challenge.html — GA4 share-attribution", () => {
  it("loads the gtag.js bundle for the GridJoy GA4 property", () => {
    // Without gtag on this static page, challenge-invite arrivals
    // (`?via=challenge_invite`) are invisible to GA4.
    expect(SRC).toContain("googletagmanager.com/gtag/js?id=G-ZD2GJG5JS9");
    expect(SRC).toContain('gtag("config", "G-ZD2GJG5JS9")');
  });

  it("fires share_referral_landed only for the known challenge_invite via", () => {
    // Whitespace-tolerant on purpose. This was an exact one-line `toContain`
    // until 2026-09-03, when gating the tag moved the call inside the loader
    // and prettier wrapped it across four lines — the assertion went red on a
    // reflow while the behaviour it guards was untouched ([[fmt-reflow]]). The
    // pairing is what matters: this event name carrying THIS via value.
    expect(SRC).toMatch(
      /gtag\(\s*"event",\s*"share_referral_landed",\s*\{\s*via:\s*"challenge_invite",?\s*\}/,
    );
    // Guarded on the exact tag so a spoofed/stale ?via= can't pollute GA4.
    expect(SRC).toContain('.get("via") ===');
    expect(SRC).toMatch(/get\("via"\)\s*===\s*"challenge_invite"/);
  });
});

describe("challenge.html — OG / social meta", () => {
  it("og:image uses challenge.png", () => {
    expect(SRC).toContain("og/challenge.png");
  });

  it("og:url is the canonical challenge page", () => {
    expect(SRC).toContain('content="https://gridjoy.app/challenge"');
  });

  it("twitter:title is present (explicit, not relying on OG fallback)", () => {
    expect(SRC).toContain('name="twitter:title"');
  });

  it("twitter:description is present", () => {
    expect(SRC).toContain('name="twitter:description"');
  });
});

describe("challenge.html — decode function", () => {
  it("validates TYPE_LABELS membership before accepting a gift code", () => {
    expect(SRC).toContain("!TYPE_LABELS[type]");
  });

  it("validates difficulty bounds (1–5)", () => {
    expect(SRC).toContain("difficulty < 1");
    expect(SRC).toContain("difficulty > 5");
  });

  it("parses seed as base-36", () => {
    expect(SRC).toContain("parseInt(parts[2], 36)");
  });
});

describe("challenge.html — renderChallenge copy", () => {
  it("no-time fallback description does not falsely promise a time to beat", () => {
    // When the ?g= URL has no ?t= param, timeStr is null and the page
    // must NOT say "beat their time" (there is no known time). The fix
    // replaced the misleading phrase with "see how fast you can solve it".
    expect(SRC).not.toContain("see if you can beat their time");
    expect(SRC).toContain("see how fast you can solve it");
  });
});

/**
 * Extracts a `function name(...) {...}` declaration from source by
 * brace-matching, so challenge.html's inline logic can be executed in a
 * test (not just string-matched). The page's script block can't be run
 * wholesale — its top-level `try` touches window/document/navigator — so we
 * lift the pure helpers out individually and run them in a vm sandbox.
 */
function extractFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in source`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

interface DecodedGift {
  type: string;
  difficulty: number;
  seed: number;
  sender: string | null;
}

/** Runs an extracted helper (plus any deps) in a sandbox, returns the fn. */
function loadHelper<T>(deps: string, name: string): T {
  return runInNewContext(
    `${deps}\n${extractFunction(SRC, name)}\n${name};`,
  ) as T;
}

const formatTime = loadHelper<(n: unknown) => string | null>("", "formatTime");
const decode = loadHelper<(e: string | null) => DecodedGift | null>(
  typeLabelBlock,
  "decode",
);

describe("challenge.html — formatTime (executed)", () => {
  it("pads minutes and seconds under ten", () => {
    expect(formatTime(9)).toBe("00:09");
    expect(formatTime(65)).toBe("01:05");
  });

  it("renders durations over an hour as MM:SS, not H:MM:SS (regression)", () => {
    // The 2026-05-10 reviewer caught this page emitting H:MM:SS while the
    // mobile receiver used MM:SS, so the same share link showed two times.
    expect(formatTime(3903)).toBe("65:03");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(90.9)).toBe("01:30");
  });

  it("returns null for non-positive, non-finite, or non-numeric input", () => {
    expect(formatTime(0)).toBeNull();
    expect(formatTime(-5)).toBeNull();
    expect(formatTime(NaN)).toBeNull();
    expect(formatTime(Infinity)).toBeNull();
    expect(formatTime("90")).toBeNull();
  });
});

describe("challenge.html — decode (executed)", () => {
  it("decodes a valid type:difficulty:seed code", () => {
    expect(decode("sudoku:3:zz")).toEqual({
      type: "sudoku",
      difficulty: 3,
      seed: parseInt("zz", 36),
      sender: null,
    });
  });

  it("decodes and URL-decodes an optional sender segment", () => {
    expect(decode("kakuro:1:1a:Al%20ice")?.sender).toBe("Al ice");
  });

  it("rejects unknown puzzle types", () => {
    expect(decode("bogus:3:zz")).toBeNull();
  });

  it("rejects out-of-range difficulty (0 and 6)", () => {
    expect(decode("sudoku:0:zz")).toBeNull();
    expect(decode("sudoku:6:zz")).toBeNull();
  });

  it("rejects too-few segments and empty input", () => {
    expect(decode("sudoku:3")).toBeNull();
    expect(decode("")).toBeNull();
    expect(decode(null)).toBeNull();
  });

  it("rejects a non-base36 seed", () => {
    expect(decode("sudoku:3:!!")).toBeNull();
  });
});

describe("challenge.html — renderInstallPrompt ?t= time-to-beat", () => {
  it("renderInstallPrompt accepts a second argument (timeStr)", () => {
    // The ?id= path now passes arenaTimeStr so the time-to-beat block
    // renders without a Firestore fetch — time is already in the share
    // message text so including it in the URL adds no privacy risk.
    expect(SRC).toContain("function renderInstallPrompt(rawId, timeStr)");
  });

  it("renderInstallPrompt shows a time-block when timeStr is truthy", () => {
    expect(SRC).toContain("TIME TO BEAT");
    // Verify it's in the install-prompt branch, not only in renderChallenge.
    const installPromptStart = SRC.indexOf("function renderInstallPrompt");
    const installPromptEnd = SRC.indexOf(
      "function renderInvalid",
      installPromptStart,
    );
    const installBlock = SRC.slice(installPromptStart, installPromptEnd);
    expect(installBlock).toContain("TIME TO BEAT");
    expect(installBlock).toContain("time-value");
  });

  it("call site passes arenaTimeStr to renderInstallPrompt", () => {
    expect(SRC).toContain("renderInstallPrompt(rawId, arenaTimeStr)");
  });

  it("?t= param is parsed before the renderInstallPrompt call", () => {
    expect(SRC).toContain("arenaTimeSeconds");
    expect(SRC).toContain("formatTime(arenaTimeSeconds)");
  });
});
