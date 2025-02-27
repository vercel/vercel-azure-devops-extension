import {
  getInput,
  getDelimitedInput,
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

function isTeamID(teamId: string) {
  return teamId.startsWith("team_");
}

async function getStagingPrefix(teamId: string, token: string): Promise<string> {
  const { statusCode, body } = await request(`https://api.vercel.com/v2/teams/${teamId}`, {
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

  return result.stagingPrefix;
}

async function getProjectName(
  projectId: string,
  teamId: string,
  token: string
): Promise<string> {
  const { statusCode, body } = await request(`https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`, {
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
  name: string,
  defaultValue?: string
): string {
  const inputValue = getInput(inputKey);
  const envVarValue = getVariable(envVarKey);

  if (inputValue && envVarValue) {
    console.warn(
      `${name} specified by both \`${inputKey}\` input and \`${envVarKey}\` environment variable. Input field \`${inputKey}\` will be used.`
    );
  }

  if (inputValue) {
    setVariable(envVarKey, inputValue);
    return inputValue;
  }

  if (envVarValue) {
    return envVarValue;
  }

  if (defaultValue) {
    setVariable(envVarKey, defaultValue);
    return defaultValue;
  }

  throw new Error(
    `${name} must be specified using input \`${inputKey}\` or environment variable \`${envVarKey}\``
  );
}

async function run() {
  try {
    setResourcePath(path.join(__dirname, "..", "task.json"));

    const target = getInput("target");

    const debug = getBoolInput("debug");

    const archive = getBoolInput("archive");

    const envs = getDelimitedInput("env", "\n", false);
    const buildEnvs = getDelimitedInput("buildEnv", "\n", false);

    const logs = getBoolInput("logs");

    const vercelProjectId = reconcileConfigurationInput(
      "vercelProjectId",
      "VERCEL_PROJECT_ID",
      "Vercel Project Id"
    );

    let vercelTeamId = reconcileConfigurationInput(
      "vercelTeamId",
      "VERCEL_TEAM_ID",
      "Vercel Team Id"
    );

    if (!vercelTeamId) {
      console.warn('Please set \'vercelTeamId\'. \'vercelOrgId\' is deprecated.');

      vercelTeamId = reconcileConfigurationInput(
        "vercelOrgId",
        "VERCEL_ORG_ID",
        "Vercel Org Id"
      );
    }

    const vercelToken = reconcileConfigurationInput(
      "vercelToken",
      "VERCEL_TOKEN",
      "Vercel Token"
    );

    const vercelCurrentWorkingDirectory = reconcileConfigurationInput(
      "vercelCWD",
      "VERCEL_CWD",
      "Vercel Current Working Directory",
      getVariable("System.DefaultWorkingDirectory")
    );

    const deployToProduction = getBoolInput("production");

    const VERCEL_CLI_VERSION =
      getVariable("VERCEL_CLI_VERSION") ?? "vercel@latest";

    if (!isTeamID(vercelTeamId) && !deployToProduction) {
      throw new Error('Usage of a Personal Vercel ID is deprecated as it breaks Preview Deployments. Exchange your Personal Vercel ID with the Team ID your Project is associated with. The Team ID starts with \'team_\'');
    }

    if (!isTeamID(vercelTeamId)) {
      console.warn('Usage of a Personal Vercel ID is deprecated. Consider switching to using your Team ID (starts with \'team_\') instead.')
    }

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
    if (vercelCurrentWorkingDirectory) {
      vercelDeployArgs.push(`--cwd=${vercelCurrentWorkingDirectory}`);
    }
    if (target) {
      vercelDeployArgs.push(`--target=${target}`);
    }
    if (debug) {
      vercelDeployArgs.push("--debug");
    }
    if (logs) {
      vercelDeployArgs.push("--logs");
    }
    if (archive) {
      vercelDeployArgs.push("--archive=tgz");
    }

    envs.forEach((env) => {
      vercelDeployArgs.push("--env", env);
    });
    buildEnvs.forEach((buildEnv) => {
      vercelDeployArgs.push("--build-env", buildEnv);
    });

    const vercelDeploy = vercel.arg(vercelDeployArgs);
    ({ stdout, stderr, code } = vercelDeploy.execSync());

    if (code !== 0) {
      throw new Error(
        `vercel deploy failed with exit code ${code}. Error: ${stderr}`
      );
    }

    const originalDeployURL = stdout;
    let deployURL = stdout;

    if (!deployToProduction) {
      // Get branch name
      // If triggered by a PR use `System.PullRequest.SourceBranch` (and replace the `refs/heads/`)
      // If not triggered by a PR use `Build.SourceBranchName`
      let branchName: string | undefined;
      const buildReason = getVariable("Build.Reason");
      if (buildReason && buildReason === "PullRequest") {
        branchName = getVariable("System.PullRequest.SourceBranch");
        if (branchName) {
          branchName = branchName.replace("refs/heads/", "");
        }
      } else {
        branchName = getVariable("Build.SourceBranchName");
      }

      if (branchName) {
        const [projectName, stagingPrefix] = await Promise.all([
          getProjectName(vercelProjectId, vercelTeamId, vercelToken),
          getStagingPrefix(vercelTeamId, vercelToken),
        ]);
        const escapedBranchName = branchName.replace(/[^a-zA-Z0-9\-]-?/g, "-");
        const escapedProjectName = projectName.replace(
          /[^a-zA-Z0-9\-]-?/g,
          "-"
        );
        /**
         * Truncating branch name according to RFC 1035 if necessary
         * Maximum length is 63 characters.
         *
         * Read more: https://vercel.com/guides/why-is-my-vercel-deployment-url-being-shortened
         *
         * projectName has a fixedLength `x`
         * stagingPrefix has a fixedLenght `y`
         * .vercel.app has a fixedLength `11`
         * two dashes
         *
         * escapedBranchName can have a maximum length of 63-11-2-y-x
         *
         * This can cause confusion if you have all branches following a scheme, e.g.
         *    feature/PREFIX-12345-my-feature-branch-name
         *    feature/PREFIX-12346-my-second-feature-branch-name
         *
         * which can produce identical branchNames in the alias:
         *    longer-project-name-feature-prefix-12-staging-prefix.vercel.app
         *    longer-project-name-feature-prefix-12-staging-prefix.vercel.app
         *
         * Therefore, if the alias would exceed 63 characters, we remove the
         * stagingPrefix to have the longest branchName substring possible:
         *    longer-project-name-feature-prefix-12345-my-feature.vercel.app
         *    longer-project-name-feature-prefix-12346-my-second-f.vercel.app
         */
        const branchNameAllowedLength =
          50 - escapedProjectName.length - stagingPrefix.length;
        let aliasHostname = `${escapedProjectName}-${escapedBranchName}-${stagingPrefix}.vercel.app`;

        if (escapedBranchName.length > branchNameAllowedLength) {
          // Calculate the maximum length of the branchName by removing the stagingPrefix and the dash
          const branchNameExtendedLength =
            branchNameAllowedLength + stagingPrefix.length + 1;

          let aliasingBranchName = escapedBranchName.substring(
            0,
            branchNameExtendedLength
          );

          // If, after truncation, the last character is a dash, remove it
          if (aliasingBranchName.endsWith("-")) {
            aliasingBranchName = aliasingBranchName.substring(
              0,
              aliasingBranchName.length - 1
            );
          }

          // Remove the stagingPrefix from the aliasHostname and use the extended aliasingBranchName
          aliasHostname = `${escapedProjectName}-${aliasingBranchName}.vercel.app`;
        }

        deployURL = `https://${aliasHostname}`;
        vercel = tool(which("vercel", true));
        const vercelAliasArgs = [
          "alias",
          stdout,
          aliasHostname,
          `--token=${vercelToken}`,
          `--scope=${vercelTeamId}`,
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
      } else {
        console.error(
          `Could not determine branch name for staging alias URL. Skipping alias operation.`
        );
      }
    }

    setVariable("originalDeploymentURL", originalDeployURL, false, true);
    setVariable("deploymentURL", deployURL, false, true);
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
