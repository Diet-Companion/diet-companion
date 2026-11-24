// The dish form (REQ-006, IF-001@1.3.0 createDish, editDish): one form for a new dish and for an edit.
// The checks and the body to send are in dishFormLogic.ts; this file only shows and collects values.

import { useState, type FormEvent } from "react";
import type { Product } from "./api";
import type { Dish } from "./dishApi";
import { addLine, removeLine, type AmountUnit, type DishFormValues, type FormErrors, type LineValues } from "./dishFormLogic";

export interface DishFormViewProps {
  original: Dish | null;
  products: readonly Product[];
  values: DishFormValues;
  errors: FormErrors;
  notice: string | null;
  onSubmit: (values: DishFormValues) => void;
  onCancel: () => void;
}

function productLabel(p: Product): string {
  return p.shop ? `${p.name} (${p.shop})` : p.name;
}

export function DishFormView(props: DishFormViewProps) {
  const { original, products, errors } = props;
  const [values, setValues] = useState<DishFormValues>(props.values);
  // Line errors are keyed by line index; once a line is removed they no longer match.
  const [stale, setStale] = useState(false);

  function setLine(index: number, patch: Partial<LineValues>) {
    setValues((v) => ({ ...v, lines: v.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStale(false);
    props.onSubmit(values);
  }

  function unavailableName(id: string): string {
    return original?.lines.find((l) => l.product.id === id)?.product.name ?? id;
  }

  return (
    <form onSubmit={submit} noValidate data-testid="dish-form">
      <h2>{original ? "Edit dish" : "New dish"}</h2>
      {props.notice ? (
        <p role="alert" data-testid="dish-form-notice">
          {props.notice}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="dish-name">Dish name</label>
        <input
          id="dish-name"
          name="name"
          type="text"
          autoComplete="off"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          aria-invalid={errors.name ? true : undefined}
          data-testid="dish-name"
        />
        {errors.name ? (
          <p role="alert" data-testid="dish-name-error">
            {errors.name}
          </p>
        ) : null}
      </div>
      {errors.lines ? (
        <p role="alert" data-testid="dish-lines-error">
          {errors.lines}
        </p>
      ) : null}
      {values.lines.map((line, i) => {
        const known = products.find((p) => p.id === line.productId);
        const noPieceWeight = known !== undefined && known.piece_weight === undefined;
        const lineError = stale ? undefined : errors.line[i];
        return (
          <div className="field" key={i} data-testid="dish-form-line">
            <label htmlFor={`line-product-${i}`}>{`Product ${i + 1}`}</label>
            <select
              id={`line-product-${i}`}
              value={line.productId}
              onChange={(e) => setLine(i, { productId: e.target.value })}
              data-testid={`line-product-${i}`}
            >
              <option value="">Pick a product</option>
              {line.productId !== "" && known === undefined ? (
                <option value={line.productId}>{unavailableName(line.productId)}</option>
              ) : null}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {productLabel(p)}
                </option>
              ))}
            </select>
            <label htmlFor={`line-amount-${i}`}>{`Amount ${i + 1}`}</label>
            <input
              id={`line-amount-${i}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={line.amount}
              onChange={(e) => setLine(i, { amount: e.target.value })}
              aria-invalid={lineError ? true : undefined}
              data-testid={`line-amount-${i}`}
            />
            <label htmlFor={`line-unit-${i}`}>{`Unit ${i + 1}`}</label>
            <select
              id={`line-unit-${i}`}
              value={line.unit}
              onChange={(e) => setLine(i, { unit: e.target.value as AmountUnit })}
              data-testid={`line-unit-${i}`}
            >
              <option value="grams">grams</option>
              <option value="pieces" disabled={noPieceWeight}>
                pieces
              </option>
            </select>
            <button
              type="button"
              data-testid={`remove-line-${i}`}
              onClick={() => {
                setStale(true);
                setValues((v) => removeLine(v, i));
              }}
            >
              Remove line
            </button>
            {lineError ? (
              <p role="alert" data-testid={`line-error-${i}`}>
                {lineError}
              </p>
            ) : null}
          </div>
        );
      })}
      <button type="button" data-testid="add-line" onClick={() => setValues((v) => addLine(v))}>
        Add line
      </button>
      <button type="submit" data-testid="save-dish">
        Save dish
      </button>
      <button type="button" data-testid="cancel-dish-form" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}
