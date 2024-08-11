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

// https://vercel.com/docs/rest-api/endpoints/projects#find-a-project-by-id-or-name-response
type Framework = 'blitzjs' | 'nextjs' | 'gatsby' | 'remix' | 'astro' | 'hexo' | 'eleventy' | 'docusaurus-2' | 'docusaurus' | 'preact' | 'solidstart-1' | 'solidstart' | 'dojo' | 'ember' | 'vue' | 'scully' | 'ionic-angular' | 'angular' | 'polymer' | 'svelte' | 'sveltekit' | 'sveltekit-1' | 'ionic-react' | 'create-react-app' | 'gridsome' | 'umijs' | 'sapper' | 'saber' | 'stencil' | 'nuxtjs' | 'redwoodjs' | 'hugo' | 'jekyll' | 'brunch' | 'middleman' | 'zola' | 'hydrogen' | 'vite' | 'vitepress' | 'vuepress' | 'parcel' | 'fasthtml' | 'sanity' | 'storybook' | null;
type Project = { autoExposeSystemEnvs: boolean; framework: Framework; name: string; }

async function getProject(
  projectId: string,
  orgId: string,
  token: string
): Promise<Project> {
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

  return result;
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

  if (!envVarValue) {
    if (!inputValue) {
      if (!defaultValue) {
        throw new Error(
          `${name} must be specified using input \`${inputKey}\` or environment variable \`${envVarKey}\``
        );
      }

      setVariable(envVarKey, defaultValue);
      return defaultValue;
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

    const archive = getBoolInput("archive");

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

    const vercelCurrentWorkingDirectory = reconcileConfigurationInput(
      "vercelCWD",
      "VERCEL_CWD",
      "Vercel Current Working Directory",
      getVariable("System.DefaultWorkingDirectory")
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
    if (vercelCurrentWorkingDirectory) {
      vercelDeployArgs.push(`--cwd=${vercelCurrentWorkingDirectory}`);
    }
    if (debug) {
      vercelDeployArgs.push("--debug");
    }
    if (archive) {
      vercelDeployArgs.push("--archive=tgz");
    }

    const project = await getProject(vercelProjectId, vercelOrgId, vercelToken)

    // Get branch name
    // If triggered by a PR use `System.PullRequest.SourceBranch` (and replace the `refs/heads/`)
    // If not triggered by a PR use `Build.SourceBranchName`
    let branchName: string | undefined;
    const buildReason = getVariable("Build.Reason");
    if (buildReason === "PullRequest") {
      branchName = getVariable("System.PullRequest.SourceBranch");
      if (branchName) {
        branchName = branchName.replace("refs/heads/", "");
      }
    } else {
      branchName = getVariable("Build.SourceBranchName");
    }

    // adding predefined DevOps variables which can be useful during build as env vars in a similiar style as the regular Vercel git integration would (replacing VERCEL with DEVOPS)
    if (project.autoExposeSystemEnvs) {
      const addEnvVar = (envVar: string) => {
        vercelDeployArgs.push(`--build-env ${envVar}`);
        vercelDeployArgs.push(`--env ${envVar}`);
      }

      const commitSha = getVariable("Build.SourceVersion");
      const pullRequestId = getVariable("System.PullRequest.PullRequestId");
      const teamProject = getVariable("System.TeamProject");
      const teamProjectId = getVariable("System.TeamProjectId");

      addEnvVar(`DEVOPS_GIT_COMMIT_SHA=${commitSha}`);
      addEnvVar(`DEVOPS_GIT_COMMIT_REF=${branchName}`);
      addEnvVar(`DEVOPS_GIT_PULL_REQUEST_ID=${pullRequestId}`);
      addEnvVar(`DEVOPS_GIT_PROVIDER=devops`);
      addEnvVar(`DEVOPS_GIT_REPO_ID=${teamProjectId}`);
      addEnvVar(`DEVOPS_GIT_REPO_SLUG=${teamProject}`);

      // adding framework specific vars as with regular integration (currently only Next.js is supported) https://vercel.com/docs/projects/environment-variables/system-environment-variables#framework-environment-variables 
      switch (project.framework) {
        case 'nextjs':
          vercelDeployArgs.push(`--build-env NEXT_PUBLIC_DEVOPS_GIT_COMMIT_SHA=${commitSha}`);
          vercelDeployArgs.push(`--build-env NEXT_PUBLIC_DEVOPS_GIT_COMMIT_REF=${branchName}`);
          vercelDeployArgs.push(`--build-env NEXT_PUBLIC_DEVOPS_GIT_PULL_REQUEST_ID=${pullRequestId}`);
          vercelDeployArgs.push(`--build-env NEXT_PUBLIC_DEVOPS_GIT_PROVIDER=devops`);
          vercelDeployArgs.push(`--build-env NEXT_PUBLIC_DEVOPS_GIT_REPO_ID=${teamProjectId}`);
          vercelDeployArgs.push(`--build-env NEXT_PUBLIC_DEVOPS_GIT_REPO_SLUG=${teamProject}`);
          break;
      }
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
      if (branchName) {
        const stagingPrefix = await getStagingPrefix(vercelOrgId, vercelToken);
        const escapedBranchName = branchName.replace(/[^a-zA-Z0-9\-]-?/g, "-");
        /**
         * Truncating branch name according to RFC 1035 if necessary
         * Maximum length is 63 characters.
         *
         * Read more: https://vercel.com/guides/why-is-my-vercel-deployment-url-being-shortened
         *
         * project.name has a fixedLength `x`
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
          50 - project.name.length - stagingPrefix.length;
        let aliasHostname = `${project.name}-${escapedBranchName}-${stagingPrefix}.vercel.app`;

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
          aliasHostname = `${project.name}-${aliasingBranchName}.vercel.app`;
        }

        deployURL = `https://${aliasHostname}`;
        vercel = tool(which("vercel", true));
        const vercelAliasArgs = [
          "alias",
          stdout,
          aliasHostname,
          `--token=${vercelToken}`,
          `--scope=${vercelOrgId}`,
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
