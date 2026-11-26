import { expect, it } from "vitest";
import { LabelProviderError } from "./anthropic-provider.js";
import type { LabelProvider, LabelValues } from "./index.js";
import { runSmoke, type SmokeDeps } from "./smoke-cli.js";
import { checkSmoke } from "./smoke.js";

// Synthetic values. Expected numbers come from ticket #98, which has no REQ, R or IF ID.
const GOOD: LabelValues = {
  name: "Smoke Test Crackers",
  shop: null,
  brand: null,
  calories: 250,
  protein: 9,
  fat: 3.5,
};

// characterization
it("checkSmoke accepts values inside every tolerance", () => {
  expect(checkSmoke(GOOD)).toEqual({ ok: true });
  expect(checkSmoke({ ...GOOD, calories: 252, protein: 9.5, fat: 3 })).toEqual({ ok: true });
  expect(checkSmoke({ ...GOOD, calories: 248, protein: 8.5, fat: 4 })).toEqual({ ok: true });
});

// characterization
it("checkSmoke accepts the name in any case", () => {
  expect(checkSmoke({ ...GOOD, name: "the SMOKE test CRACKERS box" })).toEqual({ ok: true });
});

// characterization
it("checkSmoke names every field out of range", () => {
  expect(checkSmoke({ ...GOOD, calories: 253 })).toEqual({ ok: false, mismatched: ["calories"] });
  expect(checkSmoke({ ...GOOD, name: "Other", protein: 9.6, fat: 4.1 })).toEqual({
    ok: false,
    mismatched: ["name", "protein", "fat"],
  });
});

// characterization
it("checkSmoke treats missing values as mismatches", () => {
  const empty: LabelValues = { name: null, shop: null, brand: null, calories: null, protein: null, fat: null };
  expect(checkSmoke(empty)).toEqual({ ok: false, mismatched: ["name", "calories", "protein", "fat"] });
});

interface Harness {
  deps: SmokeDeps;
  out: string[];
  err: string[];
}

function harness(
  overrides: Partial<SmokeDeps> = {},
  provider: (log: (m: string) => void) => LabelProvider = () => ({ readLabel: async () => GOOD }),
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const deps: SmokeDeps = {
    imagePath: "label.png",
    env: { ANTHROPIC_API_KEY: "test-key" },
    readImage: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    createProvider: (options) => provider(options.log ?? (() => undefined)),
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
    ...overrides,
  };
  return { deps, out, err };
}

// characterization
it("runSmoke prints ok and exits 0", async () => {
  const h = harness();
  expect(await runSmoke(h.deps)).toBe(0);
  expect(h.out).toEqual(["label.smoke outcome=ok calories=250 protein=9 fat=3.5"]);
});

// characterization
it("runSmoke prints mismatch fields and exits 1", async () => {
  const h = harness({}, () => ({ readLabel: async () => ({ ...GOOD, calories: 300 }) }));
  expect(await runSmoke(h.deps)).toBe(1);
  expect(h.out).toEqual(["label.smoke outcome=mismatch fields=calories"]);
});

// characterization
it("runSmoke prints the provider failure line and exits 1", async () => {
  const h = harness({}, (log) => ({
    readLabel: async () => {
      log("label.read run_id=smoke outcome=provider.http status=400 error_type=invalid_request_error");
      throw new LabelProviderError("provider.http", "The provider answered status 400.", { status: 400 });
    },
  }));
  expect(await runSmoke(h.deps)).toBe(1);
  expect(h.out).toEqual(["label.read run_id=smoke outcome=provider.http status=400 error_type=invalid_request_error"]);
});

// characterization
it("runSmoke exits 2 without a key or an image path", async () => {
  const noKey = harness({ env: {} });
  expect(await runSmoke(noKey.deps)).toBe(2);
  expect(noKey.err).toHaveLength(1);
  const noPath = harness({ imagePath: undefined });
  expect(await runSmoke(noPath.deps)).toBe(2);
  expect(noPath.err).toHaveLength(1);
  expect(noKey.out.concat(noPath.out)).toEqual([]);
});

// characterization
it("runSmoke exits 2 when the image cannot be read", async () => {
  const h = harness({
    readImage: async () => {
      throw new Error("missing");
    },
  });
  expect(await runSmoke(h.deps)).toBe(2);
  expect(h.err).toHaveLength(1);
  expect(h.err[0]).not.toContain("test-key");
});
