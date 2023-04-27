import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { $ } from "execa";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const $$ = $({ cwd: root });

const taskDir = join(root, "vercel-deployment-task-source");
await $$`pnpm -C ${taskDir} build`;

const taskFilePath = join(taskDir, "task.json");
const taskFileData = await readFile(taskFilePath);
const taskFileJSON = JSON.parse(taskFileData);
taskFileJSON.version.Patch = taskFileJSON.version.Patch + 1;
await writeFile(taskFilePath, JSON.stringify(taskFileJSON, undefined, 2));

const out = join(root, "vercel-deployment-task");

await rm(out, { recursive: true, force: true });
await mkdir(out);
await $$`cp -r ${join(taskDir, "dist")} ${taskFilePath} ${join(
  taskDir,
  "package.json"
)} ${out}`;

await $$`npm -C ${out} install --production --package-lock=false`;

const args = process.argv.slice(2);
const publish = args[0] === "--publish";

const pat = process.env.AZURE_TOKEN;

await $$`tfx extension ${
  publish ? ["publish", "--token", pat, "--no-wait-validation"] : "create"
} --manfiest-globs vss-extension.json`;

await rm(out, { recursive: true, force: true });
