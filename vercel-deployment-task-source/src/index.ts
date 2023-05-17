import {
  getInput,
  getBoolInput,
  TaskResult,
  setResult,
  which,
  tool,
  setResourcePath,
  setVariable
} from "azure-pipelines-task-lib";
import path from "path";

function errorHandler(error: unknown) {
  setResult(TaskResult.Failed, `Unknown error thrown: ${error}`);
}

process.on("unhandledRejection", errorHandler);
process.on("unhandledException", errorHandler);

async function run() {
  try {
    setResourcePath(path.join(__dirname, "..", "task.json"));
    // assert type as defined since, the `required` option is set to `true` (and `getInput` will throw if the variables are undefined).
    const vercelProject = getInput("vercelProject", true)!;
    const vercelToken = getInput("vercelToken", true)!;
    const deployToProduction = getBoolInput("production", false);

    const npm = tool(which("npm", true));
    const npmInstall = npm.arg(["install", "-g", "vercel"]);
    let { stdout, stderr, code } = npmInstall.execSync();

    if (code !== 0) {
      throw new Error(
        `npm install failed with exit code ${code}. Error: ${stderr}`
      );
    }

    let vercel = tool(which("vercel", true));
    const vercelLink = vercel.arg([
      "link",
      "--yes",
      "--project",
      vercelProject,
      "--token",
      vercelToken,
    ]);
    ({ stdout, stderr, code } = vercelLink.execSync());

    if (code !== 0) {
      throw new Error(
        `vercel link failed with exit code ${code}. Error: ${stderr}`
      );
    }

    vercel = tool(which("vercel", true));
    const vercelDeploy = vercel.arg(
      deployToProduction
        ? ["deploy", "--prod", "--token", vercelToken]
        : ["deploy", "--token", vercelToken]
    );
    ({ stdout, stderr, code } = vercelDeploy.execSync());

    const message =
      code === 0
        ? `Successfully deployed to ${stdout}`
        : `Failed to deploy ${vercelProject}.\n\nError:\n${stderr}`;

    setVariable('deploymentTaskMessage', message, false, true);

    if (code !== 0) {
      throw new Error(
        `vercel deploy failed with exit code ${code}. Error: ${stderr}`
      );
    }

    console.log(message);

    setResult(TaskResult.Succeeded, "Success");
  } catch (err) {
    if (err instanceof Error) {
      setResult(TaskResult.Failed, err.message);
      return;
    }

    setResult(TaskResult.Failed, `Unknown error thrown: ${err}`);
  }
}

run();
