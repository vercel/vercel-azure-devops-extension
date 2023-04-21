import { TaskMockRunner } from 'azure-pipelines-task-lib/mock-run'

const taskMockRunner = new TaskMockRunner(require.resolve('../src/index'));
taskMockRunner.setInput('vercelProject', 'foo');
taskMockRunner.setInput('vercelToken', 'bar');
taskMockRunner.run();