import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createApi, type FetchLike, type MissingField, type NewProduct, type Product, type Recognised } from "./api";
import { createDishApi, type Dish, type DishState } from "./dishApi";
import { DishScreens } from "./DishViews";
import { TargetsScreen } from "./TargetsScreen";
import { TargetsSetupView } from "./TargetsSetupView";
import { CHECKING, OPEN, gateAfterRanges, gateAfterSave, saveNutrient, setField, withResult, type TargetsGate } from "./targets";
import { createTargetsApi, type Nutrient } from "./targetsApi";
import {
  buildCreate,
  buildEdit,
  dishToForm,
  emptyErrors,
  emptyForm,
  writeOutcome,
  type DishFormOutcome,
  type DishFormValues,
} from "./dishFormLogic";
import {
  DISH_LIST_FAILED_TEXT,
  deleteDishOutcome,
  nextAfterDishList,
  restoreDishOutcome,
  type DishNext,
  type DishOutcome,
  type DishScreen,
} from "./dishes";
import { NO_CHANGES_TEXT, buildPatch, editOutcome, productToValues } from "./edit";
import {
  MANUAL_FIELDS,
  buildManualProduct,
  buildNewProduct,
  clearSignedIn,
  deleteOutcome,
  filterProducts,
  initialScreen,
  markSignedIn,
  restoreOutcome,
  screenAfterList,
  screenAfterManual,
  screenAfterProduct,
  type CatalogView,
  type ChangeOutcome,
  type FieldErrors,
  type KeyValueStorage,
  type ManualErrors,
  type ManualField,
  type ManualValues,
  type Screen,
} from "./flow";

const LABELS: Record<MissingField, string> = {
  name: "Product name",
  shop: "Shop",
  calories: "Calories (kcal per 100 g)",
  protein: "Protein (g per 100 g)",
  fat: "Fat (g per 100 g)",
};

const MANUAL_LABELS: Record<ManualField, string> = {
  name: "Product name (required)",
  shop: "Shop (required)",
  brand: "Brand (optional)",
  calories: "Calories (kcal per 100 g) (required)",
  protein: "Protein (g per 100 g) (required)",
  fat: "Fat (g per 100 g) (required)",
  carbohydrate: "Carbohydrate (g per 100 g) (optional)",
  sugars: "Sugars (g per 100 g) (optional)",
  fibre: "Fibre (g per 100 g) (optional)",
  salt: "Salt (g per 100 g) (optional)",
  portion_size: "Portion size (g) (optional)",
  portion_calories: "Portion calories (kcal) (optional)",
  piece_weight: "Average piece weight (g) (optional)",
};

const TEXT_FIELDS: readonly ManualField[] = ["name", "shop", "brand"];

export const DUPLICATE_TEXT = "A product with that name and shop already exists. Nothing was saved.";
export const FAILED_TEXT = "The photo couldn't be read. Try again.";
export const BASIS_NOTE = "All values are per 100 g. If the label gives values per 100 ml, enter the same numbers.";

function MissingForm(props: {
  missing: MissingField[];
  recognised: Recognised;
  onCreate: (product: NewProduct) => void;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const supplied: Partial<Record<MissingField, string>> = {};
    for (const f of props.missing) {
      const v = data.get(f);
      supplied[f] = typeof v === "string" ? v : "";
    }
    const built = buildNewProduct(props.recognised, props.missing, supplied);
    if (built.ok) {
      setErrors({});
      props.onCreate(built.product);
    } else {
      setErrors(built.errors);
    }
  }
  return (
    <form onSubmit={submit} noValidate data-testid="missing-form">
      <p>Some values could not be read from the photo. Please enter them. Nothing is saved yet.</p>
      {props.missing.map((f) => (
        <div className="field" key={f}>
          <label htmlFor={`field-${f}`}>{LABELS[f]}</label>
          <input
            id={`field-${f}`}
            name={f}
            type="text"
            inputMode={f === "name" || f === "shop" ? "text" : "decimal"}
            autoComplete="off"
            data-testid={`field-${f}`}
          />
          {errors[f] ? (
            <p role="alert" data-testid={`error-${f}`}>
              {errors[f]}
            </p>
          ) : null}
        </div>
      ))}
      <button type="submit">Save product</button>
    </form>
  );
}

function ManualForm(props: {
  values: ManualValues;
  errors: ManualErrors;
  notice: string | null;
  onSubmit: (values: ManualValues) => void;
  onCancel: () => void;
  testId?: string;
  submitLabel?: string;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const values: ManualValues = {};
    for (const f of MANUAL_FIELDS) {
      const v = data.get(f);
      values[f] = typeof v === "string" ? v : "";
    }
    props.onSubmit(values);
  }
  return (
    <form onSubmit={submit} noValidate data-testid={props.testId ?? "manual-form"}>
      <p>{BASIS_NOTE}</p>
      {props.notice ? (
        <p role="alert" data-testid="manual-notice">
          {props.notice}
        </p>
      ) : null}
      {MANUAL_FIELDS.map((f) => (
        <div className="field" key={f}>
          <label htmlFor={`field-${f}`}>{MANUAL_LABELS[f]}</label>
          <input
            id={`field-${f}`}
            name={f}
            type="text"
            inputMode={TEXT_FIELDS.includes(f) ? "text" : "decimal"}
            autoComplete="off"
            defaultValue={props.values[f] ?? ""}
            aria-invalid={props.errors[f] ? true : undefined}
            data-testid={`field-${f}`}
          />
          {props.errors[f] ? (
            <p role="alert" data-testid={`error-${f}`}>
              {props.errors[f]}
            </p>
          ) : null}
        </div>
      ))}
      <button type="submit">{props.submitLabel ?? "Save product"}</button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

const SHOWN_NUMBERS = [
  ["carbohydrate", "Carbohydrate"],
  ["sugars", "Sugars"],
  ["fibre", "Fibre"],
  ["salt", "Salt"],
] as const;

/** The lines of a saved product beyond name, shop and the three required values. */
export function extraLines(p: Product): string[] {
  const lines: string[] = [];
  if (p.brand) lines.push(`Brand: ${p.brand}`);
  for (const [key, label] of SHOWN_NUMBERS) {
    const v = p[key];
    if (v !== undefined) lines.push(`${label}: ${v} g per 100 g`);
  }
  if (p.sodium !== undefined) lines.push(`Sodium: ${p.sodium} mg per 100 g`);
  if (p.portion_size !== undefined) lines.push(`Portion size: ${p.portion_size} g`);
  if (p.portion_calories !== undefined) lines.push(`Portion calories: ${p.portion_calories} kcal`);
  if (p.counted_by_piece === true && p.piece_weight !== undefined) {
    lines.push(`Counted by the piece: ${p.piece_weight} g`);
  }
  return lines;
}

function LoginForm(props: { error: string | null; onLogin: (password: string) => void }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = new FormData(form).get("password");
    form.reset();
    props.onLogin(typeof v === "string" ? v : "");
  }
  return (
    <form onSubmit={submit} data-testid="login-form">
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {props.error ? (
        <p role="alert" data-testid="login-error">
          {props.error}
        </p>
      ) : null}
      <button type="submit">Log in</button>
    </form>
  );
}

function productLine(p: Product): string {
  return [p.shop, p.brand].filter((x) => x !== undefined && x !== "").join(" / ");
}

function CatalogList(props: {
  screen: Extract<Screen, { name: "catalog" }>;
  onFilter: (text: string) => void;
  onShowView: (view: CatalogView) => void;
  onOpen: (product: Product) => void;
  onRestore: (product: Product) => void;
  onBack: () => void;
}) {
  const { screen } = props;
  const deleted = screen.view === "deleted";
  const shown = filterProducts(screen.products, screen.filter);
  return (
    <section data-testid="catalog">
      <h2>{deleted ? "Deleted products" : "Catalog"}</h2>
      {screen.notice ? (
        <p role="status" data-testid="catalog-notice">
          {screen.notice}
        </p>
      ) : null}
      <button type="button" data-testid="catalog-back" onClick={props.onBack}>
        Back
      </button>
      <button type="button" data-testid="catalog-toggle" onClick={() => props.onShowView(deleted ? "selectable" : "deleted")}>
        {deleted ? "Show catalog" : "Show deleted"}
      </button>
      <div className="field">
        <label htmlFor="catalog-filter">Filter by name or shop</label>
        <input
          id="catalog-filter"
          type="search"
          autoComplete="off"
          value={screen.filter}
          onChange={(e) => props.onFilter(e.target.value)}
          data-testid="catalog-filter"
        />
      </div>
      {shown.length === 0 ? (
        <p data-testid="catalog-empty">{deleted ? "No deleted products." : "No products found."}</p>
      ) : (
        <ul>
          {shown.map((p) => (
            <li key={p.id} data-testid="catalog-item">
              {deleted ? (
                <strong>{p.name}</strong>
              ) : (
                <button type="button" data-testid={`open-${p.id}`} onClick={() => props.onOpen(p)}>
                  {p.name}
                </button>
              )}
              <p>{productLine(p)}</p>
              <p>{`${p.calories} kcal per 100 g`}</p>
              {deleted ? (
                <button type="button" data-testid={`restore-${p.id}`} onClick={() => props.onRestore(p)}>
                  Restore
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductPage(props: {
  screen: Extract<Screen, { name: "product" }>;
  onBack: () => void;
  onEdit: (product: Product) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: (product: Product) => void;
}) {
  const p = props.screen.product;
  return (
    <section data-testid="product">
      <h2>{p.name}</h2>
      {props.screen.notice ? (
        <p role="status" data-testid="product-notice">
          {props.screen.notice}
        </p>
      ) : null}
      <p>{`Name: ${p.name}`}</p>
      <p>{`Shop: ${p.shop}`}</p>
      <p>{`Calories: ${p.calories} kcal per 100 g`}</p>
      <p>{`Protein: ${p.protein} g per 100 g`}</p>
      <p>{`Fat: ${p.fat} g per 100 g`}</p>
      {extraLines(p).map((line) => (
        <p key={line}>{line}</p>
      ))}
      {props.screen.confirmDelete ? (
        <div data-testid="delete-confirm">
          <p role="alert">Delete this product? It stays in past records and can be restored later.</p>
          <button type="button" data-testid="confirm-delete" onClick={() => props.onConfirmDelete(p)}>
            Yes, delete
          </button>
          <button type="button" data-testid="cancel-delete" onClick={props.onCancelDelete}>
            Keep it
          </button>
        </div>
      ) : (
        <>
          <button type="button" data-testid="edit-product" onClick={() => props.onEdit(p)}>
            Edit
          </button>
          <button type="button" data-testid="delete-product" onClick={props.onAskDelete}>
            Delete
          </button>
        </>
      )}
      <button type="button" data-testid="product-back" onClick={props.onBack}>
        Back to catalog
      </button>
    </section>
  );
}

export interface ScreenViewProps {
  screen: Screen;
  onLogin: (password: string) => void;
  onLogout: () => void;
  onPhoto: (photo: File) => void;
  onCreate: (product: NewProduct) => void;
  onAddAnother: () => void;
  onAddByHand?: () => void;
  onManualSubmit?: (values: ManualValues) => void;
  onOpenCatalog?: () => void;
  onShowView?: (view: CatalogView) => void;
  onFilter?: (text: string) => void;
  onOpenProduct?: (product: Product) => void;
  onAskDelete?: () => void;
  onCancelDelete?: () => void;
  onConfirmDelete?: (product: Product) => void;
  onRestore?: (product: Product) => void;
  onEdit?: (product: Product) => void;
  onEditSubmit?: (product: Product, values: ManualValues) => void;
  onCancelEdit?: (product: Product) => void;
}

export function ScreenView(props: ScreenViewProps) {
  const { screen } = props;
  const none = () => undefined;
  switch (screen.name) {
    case "login":
      return <LoginForm error={screen.error} onLogin={props.onLogin} />;
    case "add":
      return (
        <section data-testid="add">
          <label className="big-button">
            Add from photo
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="photo-input"
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (file) props.onPhoto(file);
                input.value = "";
              }}
            />
          </label>
          <button type="button" className="big-button" data-testid="add-by-hand" onClick={() => props.onAddByHand?.()}>
            Add by hand
          </button>
          <button type="button" className="big-button" data-testid="open-catalog" onClick={() => props.onOpenCatalog?.()}>
            Catalog
          </button>
        </section>
      );
    case "busy":
      return (
        <p role="status" data-testid="busy">
          Working on it...
        </p>
      );

    case "saved": {
      const p = screen.product;
      return (
        <section data-testid="saved">
          <p role="status">Product saved.</p>
          <p>{`Name: ${p.name}`}</p>
          <p>{`Shop: ${p.shop}`}</p>
          <p>{`Calories: ${p.calories} kcal per 100 g`}</p>
          <p>{`Protein: ${p.protein} g per 100 g`}</p>
          <p>{`Fat: ${p.fat} g per 100 g`}</p>
          {extraLines(p).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <button type="button" onClick={props.onAddAnother}>
            Add another
          </button>
        </section>
      );
    }
    case "missing":
      return <MissingForm missing={screen.missing} recognised={screen.recognised} onCreate={props.onCreate} />;
    case "manual":
      return (
        <ManualForm
          values={screen.values}
          errors={screen.errors}
          notice={screen.notice}
          onSubmit={(values) => props.onManualSubmit?.(values)}
          onCancel={props.onAddAnother}
        />
      );
    case "duplicate":
      return (
        <section data-testid="duplicate">
          <p role="alert">{screen.message ?? DUPLICATE_TEXT}</p>
          <button type="button" onClick={props.onAddAnother}>
            Try another photo
          </button>
        </section>
      );
    case "failed":
      return (
        <section data-testid="failed">
          <p role="alert">{screen.message ?? FAILED_TEXT}</p>
          <button type="button" onClick={props.onAddAnother}>
            Try again
          </button>
        </section>
      );
    case "catalog":
      return (
        <CatalogList
          screen={screen}
          onFilter={props.onFilter ?? none}
          onShowView={props.onShowView ?? none}
          onOpen={props.onOpenProduct ?? none}
          onRestore={props.onRestore ?? none}
          onBack={props.onAddAnother}
        />
      );
    case "product":
      return (
        <ProductPage
          screen={screen}
          onBack={props.onOpenCatalog ?? none}
          onEdit={props.onEdit ?? none}
          onAskDelete={props.onAskDelete ?? none}
          onCancelDelete={props.onCancelDelete ?? none}
          onConfirmDelete={props.onConfirmDelete ?? none}
        />
      );
    case "edit":
      return (
        <ManualForm
          values={screen.values}
          errors={screen.errors}
          notice={screen.notice}
          testId="edit-form"
          submitLabel="Save changes"
          onSubmit={(values) => props.onEditSubmit?.(screen.product, values)}
          onCancel={() => props.onCancelEdit?.(screen.product)}
        />
      );
  }
}

export interface AppProps {
  fetchFn?: FetchLike;
  storage?: KeyValueStorage | null;
  newRunId?: () => string;
  /** Starts the targets gate in a given phase; tests use it to show the gate without running effects. */
  initialGate?: TargetsGate;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);
const defaultRunId = (): string => globalThis.crypto?.randomUUID?.() ?? String(Date.now());

export function App(props: AppProps = {}) {
  const storage = props.storage === undefined ? browserStorage() : props.storage;
  const api = useMemo(
    () => createApi(props.fetchFn ?? defaultFetch, props.newRunId ?? defaultRunId),
    [props.fetchFn, props.newRunId],
  );
  const dishApi = useMemo(
    () => createDishApi(props.fetchFn ?? defaultFetch, props.newRunId ?? defaultRunId),
    [props.fetchFn, props.newRunId],
  );
  const targetsApi = useMemo(
    () => createTargetsApi(props.fetchFn ?? defaultFetch, props.newRunId ?? defaultRunId),
    [props.fetchFn, props.newRunId],
  );
  const [screen, setScreen] = useState<Screen>(() => initialScreen(storage));
  // The dish screens sit on top of the product screens; null means the product screens show.
  const [dishScreen, setDishScreen] = useState<DishScreen | null>(null);
  // The targets screen (change ranges) sits on top of the other screens while it is open.
  const [targetsOpen, setTargetsOpen] = useState(false);
  // Until all three target ranges are saved, only the targets setup shows (REQ-009/AC-001).
  const [gate, setGate] = useState<TargetsGate>(
    () => props.initialGate ?? (initialScreen(storage).name === "login" ? OPEN : CHECKING),
  );
  const signedIn = screen.name !== "login";

  async function apply(pending: ReturnType<typeof api.createProduct>) {
    setScreen({ name: "busy" });
    const result = await pending;
    if (result.kind === "unauthorized") clearSignedIn(storage);
    setScreen(screenAfterProduct(result));
  }

  async function applyManual(values: ManualValues) {
    const built = buildManualProduct(values);
    if (!built.ok) {
      setScreen({ name: "manual", values, errors: built.errors, notice: null });
      return;
    }
    setScreen({ name: "busy" });
    const result = await api.createProduct(built.product);
    if (result.kind === "unauthorized") clearSignedIn(storage);
    setScreen(screenAfterManual(result, values));
  }

  async function openCatalog(view: CatalogView = "selectable", notice: string | null = null) {
    setScreen({ name: "busy" });
    const result = await api.listProducts(view);
    if (result.kind === "unauthorized") clearSignedIn(storage);
    setScreen(screenAfterList(result, view, notice));
  }

  async function change<R extends { kind: string }>(pending: Promise<R>, outcomeOf: (r: R) => ChangeOutcome) {
    const before = screen;
    setScreen({ name: "busy" });
    const result = await pending;
    if (result.kind === "unauthorized") clearSignedIn(storage);
    const outcome = outcomeOf(result);
    if (outcome.kind === "reload") {
      await openCatalog(outcome.view, outcome.notice);
    } else if (outcome.kind === "keep" && before.name === "catalog") {
      setScreen({ ...before, notice: outcome.notice });
    } else if (outcome.kind === "screen") {
      setScreen(outcome.screen);
    } else {
      setScreen({ name: "failed", message: outcome.notice });
    }
  }

  // Send only the changed fields; with none changed, say so and send nothing.
  async function applyEdit(original: Product, values: ManualValues) {
    const built = buildPatch(original, values);
    if (!built.ok) {
      setScreen({ name: "edit", product: original, values, errors: built.errors, notice: null });
      return;
    }
    if (Object.keys(built.patch).length === 0) {
      setScreen({ name: "edit", product: original, values, errors: {}, notice: NO_CHANGES_TEXT });
      return;
    }
    await change(api.editProduct(original.id, built.patch), (r) => editOutcome(r, values, original));
  }

  function applyDishNext(next: DishNext) {
    if (next.kind === "screen") {
      setDishScreen(next.screen);
    } else if (next.kind === "login") {
      setDishScreen(null);
      setScreen({ name: "login", error: null });
    } else {
      setDishScreen(null);
      setScreen({ name: "failed", message: next.message });
    }
  }

  async function openDishes(view: DishState = "selectable", notice: string | null = null) {
    setDishScreen({ name: "dishes_busy" });
    const result = await dishApi.listDishes(view);
    if (result.kind === "unauthorized") clearSignedIn(storage);
    applyDishNext(nextAfterDishList(result, view, notice));
  }

  async function changeDish<R extends { kind: string }>(pending: Promise<R>, outcomeOf: (r: R) => DishOutcome) {
    const before = dishScreen;
    setDishScreen({ name: "dishes_busy" });
    const result = await pending;
    if (result.kind === "unauthorized") clearSignedIn(storage);
    const outcome = outcomeOf(result);
    if (outcome.kind === "reload") {
      await openDishes(outcome.view, outcome.notice);
    } else if (outcome.kind === "keep") {
      setDishScreen(before && before.name === "dishes" ? { ...before, notice: outcome.notice } : before);
    } else {
      applyDishNext(outcome);
    }
  }

  // The dish form needs the selectable products for its picker. original is null for a new dish.
  async function openDishForm(original: Dish | null) {
    setDishScreen({ name: "dishes_busy" });
    const result = await api.listProducts("selectable");
    if (result.kind === "unauthorized") clearSignedIn(storage);
    if (result.kind === "ok") {
      setDishScreen({
        name: "dish_form",
        original,
        products: result.products,
        values: original ? dishToForm(original) : emptyForm(),
        errors: emptyErrors(),
        notice: null,
      });
    } else if (result.kind === "unauthorized") {
      applyDishNext({ kind: "login" });
    } else {
      applyDishNext({ kind: "failed", message: result.message ?? DISH_LIST_FAILED_TEXT });
    }
  }

  async function applyFormOutcome(
    outcome: DishFormOutcome,
    form: Extract<DishScreen, { name: "dish_form" }>,
    values: DishFormValues,
  ) {
    if (outcome.kind === "reload") {
      await openDishes("selectable", outcome.notice);
    } else if (outcome.kind === "dish") {
      setDishScreen({ name: "dish", dish: outcome.dish, confirmDelete: false, notice: outcome.notice });
    } else if (outcome.kind === "stay") {
      setDishScreen({ ...form, values, errors: outcome.errors, notice: outcome.notice });
    } else {
      setDishScreen(null);
      setScreen({ name: "login", error: null });
    }
  }

  // Check the form first; send only what the logic builds. A refusal keeps the form filled.
  async function submitDishForm(form: Extract<DishScreen, { name: "dish_form" }>, values: DishFormValues) {
    const { original, products } = form;
    let pending;
    let sent: number[];
    if (original === null) {
      const built = buildCreate(values, products);
      if (!built.ok) {
        setDishScreen({ ...form, values, errors: built.errors, notice: null });
        return;
      }
      sent = built.sent;
      pending = dishApi.createDish(built.input);
    } else {
      const built = buildEdit(original, values, products);
      if (!built.ok) {
        setDishScreen({ ...form, values, errors: built.errors, notice: null });
        return;
      }
      if (built.update === null) {
        setDishScreen({ ...form, values, errors: emptyErrors(), notice: NO_CHANGES_TEXT });
        return;
      }
      sent = built.sent;
      pending = dishApi.editDish(original.id, built.update);
    }
    setDishScreen({ name: "dishes_busy" });
    const result = await pending;
    if (result.kind === "unauthorized") clearSignedIn(storage);
    await applyFormOutcome(writeOutcome(result, sent, original !== null), form, values);
  }

  // Read whether setup is complete; the gate keeps everything else closed until it is.
  async function checkTargets() {
    setGate(CHECKING);
    const result = await targetsApi.getTargetRanges();
    if (result.kind === "unauthorized") {
      clearSignedIn(storage);
      setScreen({ name: "login", error: null });
    }
    setGate(gateAfterRanges(result));
  }

  async function saveTarget(nutrient: Nutrient) {
    if (gate.phase !== "setup") return;
    const result = await saveNutrient(targetsApi, nutrient, gate.state.fields[nutrient]);
    if (result.unauthorized) {
      clearSignedIn(storage);
      setGate(OPEN);
      setScreen({ name: "login", error: null });
      return;
    }
    setGate((g) => (g.phase === "setup" ? gateAfterSave(withResult(g.state, nutrient, result)) : g));
  }

  useEffect(() => {
    if (gate.phase === "checking") void checkTargets();
  }, []);

  async function login(password: string) {
    const result = await api.loginOwner(password);
    if (result.kind === "ok") {
      markSignedIn(storage);
      setGate(CHECKING);
      setScreen({ name: "add" });
      await checkTargets();
    } else {
      setScreen({ name: "login", error: result.message ?? "Could not log in. Try again." });
    }
  }

  async function logout() {
    await api.logout();
    clearSignedIn(storage);
    setDishScreen(null);
    setTargetsOpen(false);
    setGate(OPEN);
    setScreen({ name: "login", error: null });
  }

  if (gate.phase !== "open") {
    return (
      <main>
        <h1 data-testid="app-title">Diet Companion</h1>
        {gate.phase === "setup" ? (
          <TargetsSetupView
            state={gate.state}
            onChange={(n, which, value) =>
              setGate((g) => (g.phase === "setup" ? { ...g, state: setField(g.state, n, which, value) } : g))
            }
            onSave={(n) => void saveTarget(n)}
          />
        ) : gate.phase === "failed" ? (
          <section data-testid="targets-check-failed">
            <p role="alert">Your targets could not be checked. Try again.</p>
            <button type="button" onClick={() => void checkTargets()}>
              Try again
            </button>
          </section>
        ) : (
          <p role="status" data-testid="targets-checking">
            Working on it...
          </p>
        )}
        <button type="button" className="link-button" onClick={() => void logout()}>
          Log out
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1 data-testid="app-title">Diet Companion</h1>
      {targetsOpen ? (
        <TargetsScreen
          api={targetsApi}
          onBack={() => setTargetsOpen(false)}
          onUnauthorized={() => {
            clearSignedIn(storage);
            setTargetsOpen(false);
            setDishScreen(null);
            setScreen({ name: "login", error: null });
          }}
        />
      ) : dishScreen ? (
        <DishScreens
          screen={dishScreen}
          onFilter={(text) => setDishScreen((s) => (s && s.name === "dishes" ? { ...s, filter: text } : s))}
          onShowView={(view) => void openDishes(view)}
          onOpen={(dish) => setDishScreen({ name: "dish", dish, confirmDelete: false })}
          onRestore={(dish) => void changeDish(dishApi.restoreDish(dish.id), restoreDishOutcome)}
          onBack={() => setDishScreen(null)}
          onBackToList={() => void openDishes()}
          onAskDelete={() => setDishScreen((s) => (s && s.name === "dish" ? { ...s, confirmDelete: true } : s))}
          onCancelDelete={() => setDishScreen((s) => (s && s.name === "dish" ? { ...s, confirmDelete: false } : s))}
          onConfirmDelete={(dish) => void changeDish(dishApi.deleteDish(dish.id), deleteDishOutcome)}
          onNewDish={() => void openDishForm(null)}
          onEditDish={(dish) => void openDishForm(dish)}
          onSubmitForm={(form, values) => void submitDishForm(form, values)}
          onCancelForm={(form) => {
            if (form.original) setDishScreen({ name: "dish", dish: form.original, confirmDelete: false });
            else void openDishes();
          }}
        />
      ) : (
        <ScreenView
          screen={screen}
          onLogin={(pw) => void login(pw)}
          onLogout={() => void logout()}
          onPhoto={(photo) => void apply(api.addProductFromLabelPhoto(photo))}
          onCreate={(product) => void apply(api.createProduct(product))}
          onAddAnother={() => setScreen({ name: "add" })}
          onAddByHand={() => setScreen({ name: "manual", values: {}, errors: {}, notice: null })}
          onManualSubmit={(values) => void applyManual(values)}
          onOpenCatalog={() => void openCatalog()}
          onShowView={(view) => void openCatalog(view)}
          onFilter={(text) => setScreen((s) => (s.name === "catalog" ? { ...s, filter: text } : s))}
          onOpenProduct={(product) => setScreen({ name: "product", product, confirmDelete: false })}
          onAskDelete={() => setScreen((s) => (s.name === "product" ? { ...s, confirmDelete: true } : s))}
          onCancelDelete={() => setScreen((s) => (s.name === "product" ? { ...s, confirmDelete: false } : s))}
          onConfirmDelete={(product) => void change(api.deleteProduct(product.id), deleteOutcome)}
          onRestore={(product) => void change(api.restoreProduct(product.id), restoreOutcome)}
          onEdit={(product) =>
            setScreen({ name: "edit", product, values: productToValues(product), errors: {}, notice: null })
          }
          onEditSubmit={(product, values) => void applyEdit(product, values)}
          onCancelEdit={(product) => setScreen({ name: "product", product, confirmDelete: false })}
        />
      )}
      {!targetsOpen && !dishScreen && screen.name === "add" ? (
        <>
          <button type="button" className="big-button" data-testid="open-dishes" onClick={() => void openDishes()}>
            Dishes
          </button>
          <button type="button" className="big-button" data-testid="open-targets" onClick={() => setTargetsOpen(true)}>
            Daily targets
          </button>
        </>
      ) : null}
      {signedIn ? (
        <button type="button" className="link-button" onClick={() => void logout()}>
          Log out
        </button>
      ) : null}
    </main>
  );
}
