import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

async function main() {
  const cli = join(
    dirname(createRequire(import.meta.url).resolve("drizzle-kit/api")),
    "bin.cjs",
  );
  const child = spawn(
    process.execPath,
    [
      cli,
      "generate",
      "--config=drizzle.generate.config.ts",
      ...process.argv.slice(2),
    ],
    { stdio: ["inherit", "pipe", "pipe"], windowsHide: true },
  );
  let output = "";
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
    process.stdout.write(data);
  });
  child.stderr.on("data", (data: Buffer) => {
    output += data.toString();
    process.stderr.write(data);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  // The pinned Drizzle CLI can report an error while exiting with status zero.
  if (code !== 0 || /^(?:Error|error)(?::|\s+\[)/m.test(output))
    throw new Error("Migration generation failed.");
}

main().catch(() => {
  console.error(
    "Migration generation failed. Review the Drizzle output above.",
  );
  process.exitCode = 1;
});
