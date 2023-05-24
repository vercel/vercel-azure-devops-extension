import {
  getInput,
  getBoolInput,
  TaskResult,
  setResult,
  which,
  tool,
  setResourcePath,
  setVariable,
  getVariable
} from "azure-pipelines-task-lib";
import path from "path";
import fs from 'fs';
import { request } from 'undici';

function errorHandler(error: unknown) {
  setResult(TaskResult.Failed, `Unknown error thrown: ${error}`);
}

process.on("unhandledRejection", errorHandler);
process.on("unhandledException", errorHandler);

async function getStagingPrefix (token: string) {
  const projectJSONPath = path.join(getVariable('System.DefaultWorkingDirectory')!, '.vercel', 'project.json')
  const projectJSONData = fs.readFileSync(projectJSONPath, 'utf-8');
  const projectJSON = JSON.parse(projectJSONData);
  const orgId: string = projectJSON.orgId;

  const isTeam = orgId.startsWith('team_');
  const apiURL = isTeam
    ? `https://api.vercel.com/v2/teams/${orgId}`
    : `https://api.vercel.com/v2/user`;

  const { statusCode, body } = await request(apiURL, {
    "headers": {
      "Authorization": `Bearer ${token}`
    },
    "method": "GET"
  });

  const result = await body.json();

  if (statusCode !== 200) {
    throw new Error(`Failed to get project owner information. Error: ${result.message}`)
  }

  return isTeam ? result.stagingPrefix : result.user.stagingPrefix;
}

async function run() {
  try {
    setResourcePath(path.join(__dirname, "..", "task.json"));
    // assert type as defined since, the `required` option is set to `true` (and `getInput` will throw if the variables are undefined).
    const vercelProject = getInput("vercelProject", true)!;
    const vercelToken = getInput("vercelToken", true)!;
    const deployToProduction = getBoolInput("production", false);

    const VERCEL_CLI_VERSION = getVariable("VERCEL_CLI_VERSION") ?? 'latest';

    let tarballURL;
    try {
      tarballURL = new URL(VERCEL_CLI_VERSION);
    } catch (e) {};

    const npm = tool(which("npm", true));
    const npmInstall = npm.arg(["install", "-g", tarballURL ? tarballURL.toString() : `vercel@${VERCEL_CLI_VERSION}`]);
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

    if (code !== 0) {
      throw new Error(
        `vercel deploy failed with exit code ${code}. Error: ${stderr}`
      );
    }

    let deployURL = stdout;

    if (!deployToProduction) {
      // This might break for non Azure Dev Ops PRs
      const branchName = getVariable('System.PullRequest.SourceBranch')!.replace('refs/heads/', '');

      const stagingPrefix = await getStagingPrefix(vercelToken);
      const aliasHostname = `${vercelProject}-${branchName}-${stagingPrefix}.vercel.app`;
      deployURL = `https://${aliasHostname}`;
      vercel = tool(which("vercel", true));
      const vercelAlias = vercel.arg(
        ["alias", stdout, aliasHostname, '--token', vercelToken]
      );
      ({ stdout, stderr, code } = vercelAlias.execSync());
      if (code !== 0) {
        throw new Error(
          `vercel alias failed with exit code ${code}. Error: ${stderr}`
        );
      }
    }

    const message = `Successfully deployed to ${deployURL}`;

    setVariable('deploymentTaskMessage', message, false, true);
    
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
