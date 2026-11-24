import { useMemo, useState, type FormEvent } from "react";
import { createApi, type FetchLike, type MissingField, type NewProduct, type Recognised } from "./api";
import {
  buildNewProduct,
  clearSignedIn,
  initialScreen,
  markSignedIn,
  screenAfterProduct,
  type FieldErrors,
  type KeyValueStorage,
  type Screen,
} from "./flow";

const LABELS: Record<MissingField, string> = {
  name: "Product name",
  shop: "Shop",
  calories: "Calories (kcal per 100 g)",
  protein: "Protein (g per 100 g)",
  fat: "Fat (g per 100 g)",
};

export const DUPLICATE_TEXT = "A product with that name and shop already exists. Nothing was saved.";
export const FAILED_TEXT = "The photo couldn't be read. Try again.";

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

export interface ScreenViewProps {
  screen: Screen;
  onLogin: (password: string) => void;
  onLogout: () => void;
  onPhoto: (photo: File) => void;
  onCreate: (product: NewProduct) => void;
  onAddAnother: () => void;
}

export function ScreenView(props: ScreenViewProps) {
  const { screen } = props;
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
          <button type="button" onClick={props.onAddAnother}>
            Add another
          </button>
        </section>
      );
    }
    case "missing":
      return <MissingForm missing={screen.missing} recognised={screen.recognised} onCreate={props.onCreate} />;
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
  }
}

export interface AppProps {
  fetchFn?: FetchLike;
  storage?: KeyValueStorage | null;
  newRunId?: () => string;
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
  const [screen, setScreen] = useState<Screen>(() => initialScreen(storage));
  const signedIn = screen.name !== "login";

  async function apply(pending: ReturnType<typeof api.createProduct>) {
    setScreen({ name: "busy" });
    const result = await pending;
    if (result.kind === "unauthorized") clearSignedIn(storage);
    setScreen(screenAfterProduct(result));
  }

  async function login(password: string) {
    const result = await api.loginOwner(password);
    if (result.kind === "ok") {
      markSignedIn(storage);
      setScreen({ name: "add" });
    } else {
      setScreen({ name: "login", error: result.message ?? "Could not log in. Try again." });
    }
  }

  async function logout() {
    await api.logout();
    clearSignedIn(storage);
    setScreen({ name: "login", error: null });
  }

  return (
    <main>
      <h1 data-testid="app-title">Diet Companion</h1>
      <ScreenView
        screen={screen}
        onLogin={(pw) => void login(pw)}
        onLogout={() => void logout()}
        onPhoto={(photo) => void apply(api.addProductFromLabelPhoto(photo))}
        onCreate={(product) => void apply(api.createProduct(product))}
        onAddAnother={() => setScreen({ name: "add" })}
      />
      {signedIn ? (
        <button type="button" className="link-button" onClick={() => void logout()}>
          Log out
        </button>
      ) : null}
    </main>
  );
}
