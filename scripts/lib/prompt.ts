// Minimal terminal prompts. Hidden input never echoes; passwords are never
// accepted as command-line arguments. When stdin is not a TTY (automated tests),
// lines are read from stdin instead.
import readline from "node:readline";

let piped: string[] | undefined;
async function pipedLines(): Promise<string[]> {
  if (piped) return piped;
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  piped = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  return piped;
}

export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write(question + "\n");
    return (await pipedLines()).shift() ?? "";
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

export async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write(question + "(hidden)\n");
    return (await pipedLines()).shift() ?? "";
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (s: string) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else value += ch; // pasted text arrives here too
      }
    };
    stdin.on("data", onData);
  });
}
