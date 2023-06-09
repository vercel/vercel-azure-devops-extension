import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { $ } from "execa";

const sources = ["vercel-deployment-task-source", "vercel-azdo-pr-comment-task-source"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const $$ = $({ cwd: root });

/**
 * 
 * @param {string} taskSourceDirname 
 */
async function build (taskSourceDirname) {
  const taskDir = join(root, taskSourceDirname);
  await $$`pnpm -C ${taskDir} build`;
  
  const taskFilePath = join(taskDir, "task.json");
  // removing for now - script will publish currently committed versions
  // const taskFileData = await readFile(taskFilePath);
  // const taskFileJSON = JSON.parse(taskFileData);
  // taskFileJSON.version.Patch = taskFileJSON.version.Patch + 1;
  // await writeFile(taskFilePath, JSON.stringify(taskFileJSON, undefined, 2));
  
  const out = join(root, taskSourceDirname.replace('-source', ''));
  
  await rm(out, { recursive: true, force: true });
  await mkdir(out);
  await $$`cp -r ${join(taskDir, "dist")} ${taskFilePath} ${join(
    taskDir,
    "package.json"
  )} ${out}`;
  
  await $$`npm -C ${out} install --production --package-lock=false`;

  return out;
}

const outputs = await Promise.all(sources.map(source => build(source)));

const args = process.argv.slice(2);
const publish = args[0] === "--publish";

const pat = process.env.AZURE_TOKEN;

await $$`tfx extension ${
  publish ? ["publish", "--token", pat, "--no-wait-validation"] : "create"
} --manifest-globs vss-extension.json`;

await Promise.all(outputs.map(output => rm(output, { recursive: true, force: true })))