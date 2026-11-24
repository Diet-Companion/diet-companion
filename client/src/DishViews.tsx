import type { Dish, DishState } from "./dishApi";
import { UNSELECTABLE_PRODUCT_TEXT, filterDishes, lineIsMarked, lineText, type DishScreen } from "./dishes";
import { formatNumber } from "./edit";

export interface DishScreensProps {
  screen: DishScreen;
  onFilter: (text: string) => void;
  onShowView: (view: DishState) => void;
  onOpen: (dish: Dish) => void;
  onRestore: (dish: Dish) => void;
  onBack: () => void;
  onBackToList: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: (dish: Dish) => void;
}

function DishList(props: DishScreensProps & { screen: Extract<DishScreen, { name: "dishes" }> }) {
  const { screen } = props;
  const deleted = screen.view === "deleted";
  const shown = filterDishes(screen.dishes, screen.filter);
  return (
    <section data-testid="dishes">
      <h2>{deleted ? "Deleted dishes" : "Dishes"}</h2>
      {screen.notice ? (
        <p role="status" data-testid="dishes-notice">
          {screen.notice}
        </p>
      ) : null}
      <button type="button" data-testid="dishes-back" onClick={props.onBack}>
        Back
      </button>
      <button type="button" data-testid="dishes-toggle" onClick={() => props.onShowView(deleted ? "selectable" : "deleted")}>
        {deleted ? "Show dishes" : "Show deleted"}
      </button>
      <div className="field">
        <label htmlFor="dishes-filter">Filter by name</label>
        <input
          id="dishes-filter"
          type="search"
          autoComplete="off"
          value={screen.filter}
          onChange={(e) => props.onFilter(e.target.value)}
          data-testid="dishes-filter"
        />
      </div>
      {shown.length === 0 ? (
        <p data-testid="dishes-empty">{deleted ? "No deleted dishes." : "No dishes found."}</p>
      ) : (
        <ul>
          {shown.map((d) => (
            <li key={d.id} data-testid="dish-item">
              {deleted ? (
                <strong>{d.name}</strong>
              ) : (
                <button type="button" data-testid={`open-dish-${d.id}`} onClick={() => props.onOpen(d)}>
                  {d.name}
                </button>
              )}
              <p>{`${formatNumber(d.total_weight_grams)} g`}</p>
              {deleted ? (
                <button type="button" data-testid={`restore-dish-${d.id}`} onClick={() => props.onRestore(d)}>
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

function DishPage(props: DishScreensProps & { screen: Extract<DishScreen, { name: "dish" }> }) {
  const { dish, confirmDelete } = props.screen;
  return (
    <section data-testid="dish">
      <h2>{dish.name}</h2>
      <ul>
        {dish.lines.map((line) => (
          <li key={line.position} data-testid="dish-line">
            {lineText(line)}
            {lineIsMarked(line) ? (
              <em data-testid="dish-line-marked">{` ${UNSELECTABLE_PRODUCT_TEXT}`}</em>
            ) : null}
          </li>
        ))}
      </ul>
      <p>{`Total: ${formatNumber(dish.total_weight_grams)} g`}</p>
      {confirmDelete ? (
        <div data-testid="dish-delete-confirm">
          <p role="alert">Delete this dish? It stays in past records and can be restored later.</p>
          <button type="button" data-testid="confirm-delete-dish" onClick={() => props.onConfirmDelete(dish)}>
            Yes, delete
          </button>
          <button type="button" data-testid="cancel-delete-dish" onClick={props.onCancelDelete}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" data-testid="delete-dish" onClick={props.onAskDelete}>
          Delete
        </button>
      )}
      <button type="button" data-testid="dish-back" onClick={props.onBackToList}>
        Back to dishes
      </button>
    </section>
  );
}

export function DishScreens(props: DishScreensProps) {
  const { screen } = props;
  switch (screen.name) {
    case "dishes_busy":
      return (
        <p role="status" data-testid="dishes-busy">
          Working on it...
        </p>
      );
    case "dishes":
      return <DishList {...props} screen={screen} />;
    case "dish":
      return <DishPage {...props} screen={screen} />;
  }
}
