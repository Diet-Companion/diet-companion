import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { App } from "./App";

// characterization: no source defines the shell text
it("renders the app shell title", () => {
  expect(renderToString(<App />)).toContain("Diet Companion");
});
