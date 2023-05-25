import {
  getInput,
  getBoolInput,
  TaskResult,
  setResult,
  which,
  tool,
  setResourcePath,
  setVariable,
  getVariable,
} from "azure-pipelines-task-lib";
import path from "path";
import { request } from "undici";

function errorHandler(error: unknown) {
  setResult(TaskResult.Failed, `Unknown error thrown: ${error}`);
}

process.on("unhandledRejection", errorHandler);
process.on("unhandledException", errorHandler);

function isTeamID(orgID: string) {
  return orgID.startsWith("team_");
}

async function getStagingPrefix(orgID: string, token: string): Promise<string> {
  const isTeam = isTeamID(orgID);
  const apiURL = isTeam
    ? `https://api.vercel.com/v2/teams/${orgID}`
    : `https://api.vercel.com/v2/user`;

  const { statusCode, body } = await request(apiURL, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    method: "GET",
  });

  const result = await body.json();

  if (statusCode !== 200) {
    throw new Error(
      `Failed to get project owner information. Error: ${result.message}`
    );
  }

  return isTeam ? result.stagingPrefix : result.user.stagingPrefix;
}

async function getProjectName(
  projectId: string,
  orgId: string,
  token: string
): Promise<string> {
  let apiURL = `https://api.vercel.com/v9/projects/${projectId}`;
  if (isTeamID(orgId)) {
    apiURL += `?teamId=${orgId}`;
  }

  const { statusCode, body } = await request(apiURL, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    method: "GET",
  });

  const result = await body.json();

  if (statusCode !== 200) {
    throw new Error(
      `Failed to get project information. Error: ${result.message}`
    );
  }

  return result.name;
}

/**
 * To reconcile configuration inputs, get both the _input_ and the _environment variable_.
 *
 * If neither are defined, throw an error.
 *
 * If both are defined, log a warning that _input_ will be used.
 *
 * If _input_ is defined, and not _environment variable_, set the _environment variable_ to the _input_ value and return the _input_ value.
 *
 * If _environment variable_ is defined, and not _input_, return the _environment variable_ value.
 *
 * @param configurationInput
 * @returns
 */
function reconcileConfigurationInput(
  inputKey: string,
  envVarKey: string,
  name: string
): string {
  const inputValue = getInput(inputKey);
  const envVarValue = getVariable(envVarKey);

  if (inputValue && envVarValue) {
    console.warn(
      `${name} specified by both \`${inputKey}\` input and \`${envVarKey}\` environment variable. Input field \`${inputKey}\` (${inputValue}) will be used.`
    );
  }

  if (!envVarValue) {
    if (!inputValue) {
      throw new Error(
        `${name} must be specified using input \`${inputKey}\` or environment variable \`${envVarKey}\``
      );
    }

    setVariable(envVarKey, inputValue);
    return inputValue;
  }

  return envVarValue;
}

async function run() {
  try {
    setResourcePath(path.join(__dirname, "..", "task.json"));

    const debug = getBoolInput("debug");

    const vercelProjectId = reconcileConfigurationInput(
      "vercelProjectId",
      "VERCEL_PROJECT_ID",
      "Vercel Project Id"
    );
    const vercelOrgId = reconcileConfigurationInput(
      "vercelOrgId",
      "VERCEL_ORG_ID",
      "Vercel Org Id"
    );
    const vercelToken = reconcileConfigurationInput(
      "vercelToken",
      "VERCEL_TOKEN",
      "Vercel Token"
    );

    const deployToProduction = getBoolInput("production");

    const VERCEL_CLI_VERSION =
      getVariable("VERCEL_CLI_VERSION") ?? "vercel@latest";

    const npm = tool(which("npm", true));
    const npmInstall = npm.arg(["install", "-g", VERCEL_CLI_VERSION]);
    let { stdout, stderr, code } = npmInstall.execSync();

    if (code !== 0) {
      throw new Error(
        `npm install failed with exit code ${code}. Error: ${stderr}`
      );
    }

    let vercel = tool(which("vercel", true));
    const vercelPullArgs = [
      "pull",
      "--yes",
      `--environment=${deployToProduction ? "production" : "preview"}`,
      `--token=${vercelToken}`,
    ];
    if (debug) {
      vercelPullArgs.push("--debug");
    }
    const vercelPull = vercel.arg(vercelPullArgs);
    ({ stdout, stderr, code } = vercelPull.execSync());

    vercel = tool(which("vercel", true));
    const vercelDeployArgs = deployToProduction
      ? ["deploy", "--prod", `--token=${vercelToken}`]
      : ["deploy", `--token=${vercelToken}`];
    if (debug) {
      vercelDeployArgs.push("--debug");
    }
    const vercelDeploy = vercel.arg(vercelDeployArgs);
    ({ stdout, stderr, code } = vercelDeploy.execSync());

    if (code !== 0) {
      throw new Error(
        `vercel deploy failed with exit code ${code}. Error: ${stderr}`
      );
    }

    let deployURL = stdout;

    if (!deployToProduction) {
      // This might break for non Azure Dev Ops PRs
      const branchName = getVariable(
        "System.PullRequest.SourceBranch"
      )!.replace("refs/heads/", "");
      const [projectName, stagingPrefix] = await Promise.all([
        getProjectName(vercelProjectId, vercelOrgId, vercelToken),
        getStagingPrefix(vercelOrgId, vercelToken),
      ]);
      const aliasHostname = `${projectName}-${branchName}-${stagingPrefix}.vercel.app`;
      deployURL = `https://${aliasHostname}`;
      vercel = tool(which("vercel", true));
      const vercelAliasArgs = [
        "alias",
        stdout,
        aliasHostname,
        `--token=${vercelToken}`,
      ];
      if (debug) {
        vercelAliasArgs.push("--debug");
      }
      const vercelAlias = vercel.arg(vercelAliasArgs);
      ({ stdout, stderr, code } = vercelAlias.execSync());
      if (code !== 0) {
        throw new Error(
          `vercel alias failed with exit code ${code}. Error: ${stderr}`
        );
      }
    }

    const message = `Successfully deployed to ${deployURL}`;

    setVariable("deploymentTaskMessage", message, false, true);

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
