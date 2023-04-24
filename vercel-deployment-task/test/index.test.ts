import tap from "tap";
import { MockTestRunner } from "azure-pipelines-task-lib/mock-test";

tap.test("ok", (t) => {
  t.plan(4);
  const testRunner = new MockTestRunner(require.resolve("./success"));
  testRunner.run();
  t.equal(testRunner.succeeded, true);
  t.ok(testRunner.stdout.includes("npm called with [ 'install', '-g', 'vercel' ]"))
  t.ok(testRunner.stdout.includes("vercel called with [ 'link', '--yes', '--project', 'foo', '--token', 'bar' ]"))
  t.ok(testRunner.stdout.includes("vercel called with [ 'deploy', '--prod', '--token', 'bar' ]"))
});
