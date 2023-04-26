import tap from "tap";
import { MockTestRunner } from "azure-pipelines-task-lib/mock-test";

// Testing is incomplete due to a lack of documentation and examples from
// azure-pipelines-task-lib/mock-* libraries.

tap.test("ok", { skip: true }, (t) => {
  t.plan(1);
  const testRunner = new MockTestRunner(require.resolve("./success"));
  testRunner.run();
  t.equal(testRunner.succeeded, true);
});
