import {
  getInput,
  TaskResult,
  setResult,
  setResourcePath,
  getVariable,
} from "azure-pipelines-task-lib";
import path from "path";
import { getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import {
  CommentThreadStatus,
  CommentType,
} from "azure-devops-node-api/interfaces/GitInterfaces";

function errorHandler(error: unknown) {
  setResult(TaskResult.Failed, `Unknown error thrown: ${error}`);
}

/**
 * Defense-in-depth secret scrubbing for any text we are about to post as a
 * pull request comment. The deployment task already redacts before writing
 * `deploymentTaskMessage`, but we re-scrub here so future regressions or
 * user-provided messages cannot leak Vercel tokens into PR threads.
 */
function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/vcp_[A-Za-z0-9_-]+/g, "vcp_***")
    .replace(/vca_[A-Za-z0-9_-]+/g, "vca_***")
    .replace(/(--token[= ])[^\s"']+/g, "$1***")
    .replace(/([?&]token=)[^\s&"']+/g, "$1***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***");
}

process.on("unhandledRejection", errorHandler);
process.on("unhandledException", errorHandler);

async function run() {
  try {
    setResourcePath(path.join(__dirname, "..", "task.json"));

    const message = redactSecrets(getInput("deploymentTaskMessage", true)!);

    const buildReason = getVariable("Build.Reason");
    if (buildReason === "PullRequest") {
      const token = getInput("azureToken", true)!;

      const organizationURI = getVariable("System.CollectionUri")!;
      const repositoryId = getVariable("Build.Repository.ID")!;
      const pullRequestId = getVariable("System.PullRequest.PullRequestId")!;
      const project = getVariable("System.TeamProject")!;

      const authHandler = getPersonalAccessTokenHandler(token);
      const connection = new WebApi(organizationURI, authHandler);
      const gitClient = await connection.getGitApi();

      gitClient.createThread(
        {
          comments: [
            {
              content: message,
              commentType: CommentType.System,
            },
          ],
          status: CommentThreadStatus.Unknown,
        },
        repositoryId,
        parseInt(pullRequestId),
        project
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
