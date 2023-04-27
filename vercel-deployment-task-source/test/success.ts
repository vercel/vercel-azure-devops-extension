import { TaskMockRunner } from "azure-pipelines-task-lib/mock-run";

const taskMockRunner = new TaskMockRunner(require.resolve("../src/index"));
taskMockRunner.setInput("vercelProject", "");
taskMockRunner.setInput("vercelToken", "");
taskMockRunner.setInput("production", "false");
taskMockRunner.setInput("azureToken", "");
taskMockRunner.run();
