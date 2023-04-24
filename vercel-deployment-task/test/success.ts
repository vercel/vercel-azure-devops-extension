import { TaskMockRunner } from "azure-pipelines-task-lib/mock-run";

const taskMockRunner = new TaskMockRunner(require.resolve("../src/index"));
taskMockRunner.setInput("vercelProject", "foo");
taskMockRunner.setInput("vercelToken", "bar");
taskMockRunner.registerMock('child_process', {
    spawnSync: (command: string, args: string[]) => {
        console.log(`${command} called with`, args);
        return {
            status: 0,
            stdout: '',
            stderr: ''
        }
    }
})
taskMockRunner.run();
