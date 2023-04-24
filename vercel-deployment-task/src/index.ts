import { getInput, getBoolInput, TaskResult, setResult, which, tool, setResourcePath } from "azure-pipelines-task-lib";
import path from "path";

// function executeCommand (
//     command: string,
//     args: string[],
// ) {
//     const { status, stdout, stderr } = spawnSync(command, args, { encoding: 'utf-8'});
//     if (status !== 0) {
//         throw new Error(`Command ${command} ${args.join(' ')} failed with status code: ${status}. Stderr: ${stderr}`)
//     }
// }

async function run() {
  try {
    setResourcePath(path.join(__dirname, '..', 'task.json'));
    // assert type as defined since, the `required` option is set to `true` (and `getInput` will throw if the variables are undefined).
    const vercelProject = getInput("vercelProject", true)!;
    const vercelToken = getInput("vercelToken", true)!;
    const deployToProduction = getBoolInput("production", false);

    const npm = tool(which('npm', true))
    const npmInstall = npm.arg(['install', '-g', 'vercel']);
    await npmInstall.exec();

    const vercel = tool(which('vercel', true));
    const vercelLink = vercel.arg(['link', '--yes', '--project', vercelProject, '--token', vercelToken]);
    await vercelLink.exec();
    const vercelDeploy = vercel.arg(deployToProduction ? ['deploy', '--prod', '--token', vercelToken] : ['deploy', '--token', vercelToken])
    await vercelDeploy.exec();

    setResult(TaskResult.Succeeded, `Successfully deployed project ${vercelProject}`)
  } catch (err) {
    if (err instanceof Error) {
      setResult(TaskResult.Failed, err.message);
      return;
    }

    setResult(TaskResult.Failed, `Unknown error thrown: ${err}`);
  }
}

run();
