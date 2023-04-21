import { getInput, TaskResult, setResult } from "azure-pipelines-task-lib";
import { execSync } from "child_process";

async function run() {
  try {
    // assert type as defined since, the `required` option is set to `true` (and `getInput` will throw if the variables are undefined).
    const vercelProject = getInput("vercelProject", true)!;
    const vercelToken = getInput("vercelToken", true)!;

    console.log(`Deploying ${vercelProject}`);
  } catch (err) {
    if (err instanceof Error) {
      setResult(TaskResult.Failed, err.message);
      return;
    }

    setResult(TaskResult.Failed, `Unknown error thrown: ${err}`);
  }
}

run();
