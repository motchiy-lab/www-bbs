import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replenishCredits } from "./credits.js";

const settings = {
  maxCredits: 100,
  creditsPerRegen: 5,
  regenIntervalSeconds: 60,
};

describe("replenishCredits", () => {
  it("keeps the existing balance until a full interval has elapsed", () => {
    const updatedAt = new Date(0);
    const result = replenishCredits(
      { credits: 20, creditUpdatedAt: updatedAt },
      59_999,
      settings,
    );

    assert.deepEqual(result, { credits: 20, creditUpdatedAt: updatedAt });
  });

  it("adds credits for each elapsed interval and advances the timestamp", () => {
    const result = replenishCredits(
      { credits: 20, creditUpdatedAt: new Date(0) },
      125_000,
      settings,
    );

    assert.deepEqual(result, {
      credits: 30,
      creditUpdatedAt: new Date(120_000),
    });
  });

  it("caps the balance and resets the timestamp when full", () => {
    const now = 125_000;
    const result = replenishCredits(
      { credits: 98, creditUpdatedAt: new Date(0) },
      now,
      settings,
    );

    assert.deepEqual(result, {
      credits: 100,
      creditUpdatedAt: new Date(now),
    });
  });

  it("normalizes an already-full balance to the configured maximum", () => {
    const now = 125_000;
    const result = replenishCredits(
      { credits: 150, creditUpdatedAt: new Date(0) },
      now,
      settings,
    );

    assert.deepEqual(result, {
      credits: 100,
      creditUpdatedAt: new Date(now),
    });
  });
});
