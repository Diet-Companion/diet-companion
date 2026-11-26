import { describe, expect, it } from "vitest";
import { EMPTY_FORM, entryInput, errorText, nextDate, writeOutcome } from "./planLogic";

describe("plan logic", () => {
  // cites: REQ-013/AC-002, REQ-013/AC-003
  it("computes the next day from the date string, across month and year ends", () => {
    expect(nextDate("2026-01-05")).toBe("2026-01-06");
    expect(nextDate("2026-01-31")).toBe("2026-02-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
    expect(nextDate("not a date")).toBeNull();
  });

  // cites: REQ-013/AC-001
  it("builds a whole dish entry without an amount, even when amounts were typed", () => {
    const input = entryInput("breakfast", { subject: "d:d1", grams: "100", pieces: "" });
    expect(input).toEqual({ meal: "breakfast", dish_id: "d1" });
  });

  // cites: REQ-013/AC-005
  it("builds a product entry with 150 g", () => {
    expect(entryInput("lunch", { subject: "p:p1", grams: "150", pieces: "" })).toEqual({
      meal: "lunch",
      product_id: "p1",
      grams: 150,
    });
  });

  // cites: REQ-013/AC-006
  it("does not round a fractional amount, so the server can refuse it", () => {
    expect(entryInput("lunch", { subject: "p:p1", grams: "150.5", pieces: "" }).grams).toBe(150.5);
  });

  // cites: REQ-013/AC-008
  it("sends pieces as typed", () => {
    expect(entryInput("lunch", { subject: "p:p1", grams: "", pieces: "2" })).toEqual({
      meal: "lunch",
      product_id: "p1",
      pieces: 2,
    });
    expect(entryInput("lunch", EMPTY_FORM)).toEqual({ meal: "lunch" });
  });

  // cites: REQ-013/AC-004, REQ-013/AC-006, REQ-013/AC-007, REQ-013/AC-008
  it("words each server refusal and keeps the screen on it", () => {
    const refused = (code: string, reasons: string[]) => ({ code, reasons, message: null });
    expect(errorText(refused("plan.day_out_of_range", []))).toContain("Only today and the next day");
    expect(errorText(refused("day.closed", []))).toContain("closed");
    expect(errorText(refused("entry.invalid", ["amount_invalid"]))).toContain("whole number");
    expect(errorText(refused("entry.invalid", ["piece_without_weight"]))).toContain("no piece weight");
    expect(writeOutcome({ kind: "refused", error: refused("day.closed", []) }).kind).toBe("stay");
    expect(writeOutcome({ kind: "unauthorized" }).kind).toBe("login");
    expect(writeOutcome({ kind: "ok" }).kind).toBe("saved");
  });
});
