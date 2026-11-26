/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { createAnthropicLabelProvider, type AnthropicLabelProviderOptions } from "./anthropic-provider.js";
import type { LabelProvider } from "./index.js";
import { checkSmoke } from "./smoke.js";

/** Everything the CLI touches outside itself, so a test can pass fakes and never make a real call. */
export interface SmokeDeps {
  imagePath: string | undefined;
  env: Record<string, string | undefined>;
  readImage: (path: string) => Promise<Uint8Array>;
  createProvider: (options: AnthropicLabelProviderOptions) => LabelProvider;
  print: (line: string) => void;
  printError: (line: string) => void;
}

/** Runs one read and returns the exit code: 0 ok, 1 mismatch or provider failure, 2 missing input. */
export async function runSmoke(deps: SmokeDeps): Promise<number> {
  const apiKey = deps.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    deps.printError("label.smoke: ANTHROPIC_API_KEY is not set.");
    return 2;
  }
  if (!deps.imagePath) {
    deps.printError("label.smoke: pass the image path as the first argument.");
    return 2;
  }
  let image: Uint8Array;
  try {
    image = await deps.readImage(deps.imagePath);
  } catch {
    deps.printError("label.smoke: the image cannot be read.");
    return 2;
  }
  // The provider logs its own failure line (outcome, status, error type); the key is never logged.
  const provider = deps.createProvider({
    apiKey,
    model: deps.env.ANTHROPIC_MODEL?.trim() || undefined,
    log: (message: string) => deps.print(message),
  });
  let values;
  try {
    values = await provider.readLabel(image, "smoke");
  } catch {
    return 1;
  }
  const result = checkSmoke(values);
  if (result.ok) {
    deps.print(`label.smoke outcome=ok calories=${values.calories} protein=${values.protein} fat=${values.fat}`);
    return 0;
  }
  deps.print(`label.smoke outcome=mismatch fields=${result.mismatched.join(",")}`);
  return 1;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  runSmoke({
    imagePath: process.argv[2],
    env: process.env,
    readImage: async (path) => new Uint8Array(await readFile(path)),
    createProvider: createAnthropicLabelProvider,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
  }).then(
    (code) => process.exit(code),
    () => {
      console.error("label.smoke: unexpected failure.");
      process.exit(1);
    },
  );
}
