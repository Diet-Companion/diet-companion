import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LogView } from "./LogView";
import type { LogDay } from "./logApi";
import type { LogState } from "./logScreenLogic";
import { PlanView } from "./PlanView";
import { MEALS, type DaySheet, type DaySheetResult, type NutrientResult } from "./planApi";
import type { PlanState } from "./planScreenLogic";

const noop = () => undefined;
const TODAY = "2026-03-10";

function nutrient(n: NutrientResult["nutrient"], total: number, status: NutrientResult["status"], num: string | null): NutrientResult {
  return {
    nutrient: n,
    unit: n === "calories" ? "kcal" : "g",
    total,
    minimum: status === "no_range" ? null : 1800,
    maximum: status === "no_range" ? null : 2200,
    status,
    signed_number: num,
  };
}

function result(total: number, status: NutrientResult["status"], num: string): DaySheetResult {
  return {
    ranges_source: "in_force",
    nutrients: [nutrient("calories", total, status, num), nutrient("protein", 90, "no_range", null), nutrient("fat", 60, "green", "-10")],
  };
}

const TOTALS = { calories: 612, protein: 31, fat: 22 };

function logDay(res: DaySheetResult, closed = false): LogDay {
  return {
    date: TODAY,
    today: TODAY,
    closed,
    editable: !closed,
    meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: [], totals: TOTALS })),
    result: res,
  };
}

function planDay(date: string, res: DaySheetResult, closed = false): DaySheet {
  return {
    date,
    today: TODAY,
    closed,
    editable: !closed,
    meals: MEALS.map((meal) => ({ meal, entries: [], totals: TOTALS })),
    result: res,
  };
}

function renderLog(d: LogDay): string {
  const s: LogState = { today: TODAY, day: d, forms: {}, edits: {}, error: null };
  return renderToString(
    <LogView state={s} products={[]} dishes={[]} busy={false} onForm={noop} onSubmit={noop} onEdit={noop} onChange={noop} onRemove={noop} onConfirm={noop} onEarlier={noop} onLater={noop} onBack={noop} />,
  );
}

function renderPlan(days: DaySheet[]): string {
  const s: PlanState = { today: TODAY, days, forms: {}, edits: {}, error: null };
  return renderToString(
    <PlanView state={s} products={[]} dishes={[]} busy={false} onForm={noop} onSubmit={noop} onEdit={noop} onChange={noop} onRemove={noop} onBack={noop} />,
  );
}

// The markup from one test id up to the next closing tag.
function part(html: string, id: string): string {
  const at = html.indexOf(`data-testid="${id}"`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</", at));
}

// The markup of one result line, up to its closing li.
function line(html: string, id: string): string {
  const at = html.indexOf(`data-testid="${id}"`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</li>", at));
}

function expectCalories(html: string, prefix: string, total: number, status: string, num: string) {
  expect(line(html, `${prefix}-result-calories`)).toContain(`data-status="${status}"`);
  expect(part(html, `${prefix}-result-total-calories`)).toContain(`>${total}`);
  expect(part(html, `${prefix}-result-number-calories`)).toContain(`>${num}`);
}

describe("day result on the log screen", () => {
  // cites: REQ-010/AC-017
  it("shows 1500 yellow with -300", () => {
    expectCalories(renderLog(logDay(result(1500, "yellow", "-300"))), "log", 1500, "yellow", "-300");
  });

  // cites: REQ-010/AC-018
  it("shows 2500 red with +300", () => {
    expectCalories(renderLog(logDay(result(2500, "red", "+300"))), "log", 2500, "red", "+300");
  });

  // cites: REQ-010/AC-019
  it("shows 2000 green with -200", () => {
    expectCalories(renderLog(logDay(result(2000, "green", "-200"))), "log", 2000, "green", "-200");
  });

  // cites: REQ-010/AC-020
  it("shows 1800 green with -400", () => {
    expectCalories(renderLog(logDay(result(1800, "green", "-400"))), "log", 1800, "green", "-400");
  });

  // cites: REQ-010/AC-021
  it("shows 2200 green with 0 and no sign", () => {
    const html = renderLog(logDay(result(2200, "green", "0")));
    expectCalories(html, "log", 2200, "green", "0");
    // The part starts at the test id, which holds a hyphen, so the sign is looked for after the tag end.
    expect(part(html, "log-result-number-calories")).not.toMatch(/>[+-]/);
  });

  // cites: REQ-010/AC-022
  it("shows 2190 green with -10 and no near-limit marker", () => {
    const html = renderLog(logDay(result(2190, "green", "-10")));
    expectCalories(html, "log", 2190, "green", "-10");
    expect(html).not.toMatch(/near|limit|exceed|warning|banner/i);
    expect(html).not.toContain('role="alert"');
  });

  // cites: REQ-010/AC-024
  it("shows a partly logged day 400 yellow -1400 like a full one", () => {
    expectCalories(renderLog(logDay(result(400, "yellow", "-1400"))), "log", 400, "yellow", "-1400");
  });

  // cites: REQ-010/AC-025
  it("shows the server total 1800 for an unrounded 1799.6, green -400", () => {
    const html = renderLog(logDay(result(1800, "green", "-400")));
    expectCalories(html, "log", 1800, "green", "-400");
    expect(html).not.toContain("1799");
  });

  // cites: REQ-010/AC-026
  it("shows 1799 yellow with -1", () => {
    expectCalories(renderLog(logDay(result(1799, "yellow", "-1"))), "log", 1799, "yellow", "-1");
  });

  // cites: REQ-010/AC-027
  it("shows 2201 red with +1", () => {
    expectCalories(renderLog(logDay(result(2201, "red", "+1"))), "log", 2201, "red", "+1");
  });

  // cites: REQ-010/AC-028
  it("shows 2199 green with -1", () => {
    expectCalories(renderLog(logDay(result(2199, "green", "-1"))), "log", 2199, "green", "-1");
  });

  // cites: REQ-010/AC-012
  it("shows a whole total from the server as it is", () => {
    const html = renderLog(logDay(result(100, "yellow", "-1700")));
    expect(part(html, "log-result-total-calories")).toContain(">100");
  });

  // cites: REQ-010/AC-007
  it("shows the log result 1300 for a day whose plan is 2000, and no 2000", () => {
    const html = renderLog(logDay(result(1300, "yellow", "-500")));
    expectCalories(html, "log", 1300, "yellow", "-500");
    expect(html).not.toContain("2000");
  });

  // cites: REQ-010/AC-010
  it("shows the result on an open day and on a closed day", () => {
    expect(renderLog(logDay(result(2000, "green", "-200"), false))).toContain('data-testid="log-result-calories"');
    const closed = renderLog(logDay(result(2000, "green", "-200"), true));
    expect(closed).toContain("This day is closed.");
    expectCalories(closed, "log", 2000, "green", "-200");
  });

  // cites: REQ-010/AC-013
  it("shows calories, protein and fat under each meal as whole numbers, with no status", () => {
    const html = renderLog(logDay(result(2000, "green", "-200")));
    for (const m of MEALS) {
      expect(part(html, `log-meal-total-${m}-calories`)).toContain(">612");
      expect(part(html, `log-meal-total-${m}-protein`)).toContain(">31");
      expect(part(html, `log-meal-total-${m}-fat`)).toContain(">22");
    }
    expect(html).not.toMatch(/log-meal-total-[a-z_-]+"[^>]*data-status/);
  });

  // cites: REQ-015/AC-010
  it("shows no plan-versus-actual difference in a meal", () => {
    const html = renderLog(logDay(result(2000, "green", "-200")));
    const start = html.indexOf('data-testid="log-meal-lunch"');
    const meal = html.slice(start, html.indexOf("</section>", start));
    expect(meal).not.toContain("data-status");
    expect(meal).not.toMatch(/planned|difference|versus/i);
  });

  // cites: REQ-015/AC-011
  it("shows no warning, banner or block above the maximum", () => {
    const html = renderLog(logDay(result(2500, "red", "+300")));
    expect(html).not.toMatch(/warning|banner|blocked|exceed|limit/i);
    expect(html).not.toContain('role="alert"');
  });

  // cites: REQ-010/AC-010
  it("shows a neutral no_range nutrient with a total and no number element", () => {
    const html = renderLog(logDay(result(2000, "green", "-200")));
    expect(line(html, "log-result-protein")).toContain('data-status="no_range"');
    expect(html).toContain('data-testid="log-result-total-protein"');
    expect(html).not.toContain('data-testid="log-result-number-protein"');
  });

  // cites: REQ-010/AC-010
  it("shows the nutrients in the server's order", () => {
    const html = renderLog(logDay(result(2000, "green", "-200")));
    const at = (n: string) => html.indexOf(`data-testid="log-result-${n}"`);
    expect(at("calories")).toBeGreaterThan(-1);
    expect(at("calories")).toBeLessThan(at("protein"));
    expect(at("protein")).toBeLessThan(at("fat"));
  });
});

describe("day result on the plan screen", () => {
  // cites: REQ-010/AC-023
  it("shows a plan day over the maximum as red +300 inside its day section", () => {
    const html = renderPlan([planDay(TODAY, result(2500, "red", "+300"))]);
    const day = html.slice(html.indexOf('data-testid="plan-day-2026-03-10"'));
    expectCalories(day, "plan", 2500, "red", "+300");
  });

  // cites: REQ-010/AC-007
  it("shows each plan day's own result, with no log added", () => {
    const html = renderPlan([planDay(TODAY, result(2000, "green", "-200")), planDay("2026-03-11", result(1500, "yellow", "-300"))]);
    const first = html.indexOf('data-testid="plan-day-2026-03-10"');
    const second = html.indexOf('data-testid="plan-day-2026-03-11"');
    expectCalories(html.slice(first, second), "plan", 2000, "green", "-200");
    expectCalories(html.slice(second), "plan", 1500, "yellow", "-300");
  });

  // cites: REQ-010/AC-010
  it("shows the plan result on a closed day", () => {
    const html = renderPlan([planDay(TODAY, result(2000, "green", "-200"), true)]);
    expect(html).toContain("This day is closed.");
    expectCalories(html, "plan", 2000, "green", "-200");
  });

  // cites: REQ-010/AC-013
  it("shows meal totals on the plan screen with no status", () => {
    const html = renderPlan([planDay(TODAY, result(2000, "green", "-200"))]);
    expect(part(html, "plan-meal-total-lunch-calories")).toContain(">612");
    expect(part(html, "plan-meal-total-lunch-protein")).toContain(">31");
    expect(part(html, "plan-meal-total-lunch-fat")).toContain(">22");
    expect(html).not.toMatch(/plan-meal-total-[a-z_-]+"[^>]*data-status/);
  });

  // cites: REQ-015/AC-011
  it("shows no warning or banner on the plan screen", () => {
    const html = renderPlan([planDay(TODAY, result(2500, "red", "+300"))]);
    expect(html).not.toMatch(/warning|banner|blocked|exceed|limit/i);
    expect(html).not.toContain('role="alert"');
  });

  // cites: REQ-010/AC-024
  it("shows a plan day of 400 yellow -1400 as the server sent it", () => {
    const html = renderPlan([planDay(TODAY, result(400, "yellow", "-1400"))]);
    expectCalories(html, "plan", 400, "yellow", "-1400");
  });
});
