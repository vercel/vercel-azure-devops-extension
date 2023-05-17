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

process.on("unhandledRejection", errorHandler);
process.on("unhandledException", errorHandler);

async function run() {
  try {
    setResourcePath(path.join(__dirname, "..", "task.json"));

    const message = getInput("deploymentTaskMessage", true)!;

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
          status: CommentThreadStatus.Active,
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
