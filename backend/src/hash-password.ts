import { hashPassword } from "./auth/password.js";

/** Reads the password without echoing it: hidden on a terminal, plain stdin otherwise. */
function readPassword(): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    if (stdin.isTTY) {
      process.stderr.write("Password (hidden): ");
      let text = "";
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      const onData = (chunk: string): void => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off("data", onData);
            process.stderr.write("\n");
            resolve(text);
            return;
          }
          if (ch === "\u0003") {
            stdin.setRawMode(false);
            reject(new Error("cancelled"));
            return;
          }
          if (ch === "\u007f") text = text.slice(0, -1);
          else text += ch;
        }
      };
      stdin.on("data", onData);
      return;
    }
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "")));
    stdin.on("error", reject);
  });
}

/** Prints a salted scrypt hash for the password on stdin. Set it as OWNER_PASSWORD_HASH (ADR-004/C-006). */
async function main(): Promise<void> {
  const password = await readPassword();
  if (password === "") throw new Error("The password is empty.");
  console.log(await hashPassword(password));
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "failed");
    process.exit(1);
  });
}
