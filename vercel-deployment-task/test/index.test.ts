import tap from "tap";
import { MockTestRunner } from "azure-pipelines-task-lib/mock-test";

tap.test("ok", (t) => {
  t.plan(2);
  const testRunner = new MockTestRunner(require.resolve("./success"));
  testRunner.run();
  t.equal(testRunner.succeeded, true);
  t.ok(testRunner.stdout.includes("Deploying foo"));
});
