import type { DaySheetResult, MealTotals, NutrientResult } from "./planApi";

// Shows what the server sent, never computes anything (ADR-021, CMP-001). The colour comes from status only.

type Prefix = "plan" | "log";

const LABELS: Record<NutrientResult["nutrient"], string> = { calories: "Calories", protein: "Protein", fat: "Fat" };

const COLOURS: Record<NutrientResult["status"], string> = {
  green: "#1b7f3b",
  yellow: "#b58900",
  red: "#c0392b",
  no_range: "#666666",
};

function NutrientLine(props: { prefix: Prefix; item: NutrientResult }) {
  const { prefix, item } = props;
  const n = item.nutrient;
  const showNumber = item.status !== "no_range" && item.signed_number !== null;
  return (
    <li data-testid={`${prefix}-result-${n}`} data-status={item.status} style={{ color: COLOURS[item.status] }}>
      <span>{LABELS[n]}</span> <span data-testid={`${prefix}-result-total-${n}`}>{`${item.total}`}</span>{" "}
      <span>{item.unit}</span>
      {showNumber ? (
        <>
          {" "}
          <span data-testid={`${prefix}-result-number-${n}`}>{item.signed_number}</span>
        </>
      ) : null}
    </li>
  );
}

/** The day result per nutrient, in the server's order. Renders nothing when the response had none. */
export function DayResultList(props: { prefix: Prefix; result: DaySheetResult | undefined }) {
  if (!props.result) return null;
  return (
    <ul>
      {props.result.nutrients.map((item) => (
        <NutrientLine key={item.nutrient} prefix={props.prefix} item={item} />
      ))}
    </ul>
  );
}

/** The totals of a meal as whole numbers, with no colour, status or range. */
export function MealTotalsLine(props: { prefix: Prefix; meal: string; totals: MealTotals | undefined }) {
  const { prefix, meal, totals } = props;
  if (!totals) return null;
  return (
    <p>
      <span data-testid={`${prefix}-meal-total-${meal}-calories`}>{`${totals.calories}`}</span> kcal{" "}
      <span data-testid={`${prefix}-meal-total-${meal}-protein`}>{`${totals.protein}`}</span> g protein{" "}
      <span data-testid={`${prefix}-meal-total-${meal}-fat`}>{`${totals.fat}`}</span> g fat
    </p>
  );
}
