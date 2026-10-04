import { GenericContainer, Wait } from "testcontainers";

export async function createSkillTestStorage() {
  const container = await new GenericContainer("chrislusf/seaweedfs:4.48")
    .withCommand([
      "mini",
      "-dir=/data",
      "-bucket=skill-tests",
      "-s3.config=/etc/s3.json",
    ])
    .withCopyContentToContainer([
      {
        target: "/etc/s3.json",
        content: JSON.stringify({
          identities: [
            {
              name: "test",
              credentials: [
                { accessKey: "test-key", secretKey: "test-secret" },
              ],
              actions: ["Admin", "Read", "Write", "List"],
            },
          ],
        }),
      },
    ])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forHttp("/", 8333).forStatusCode(403))
    .start();

  process.env.SKILL_S3_ENDPOINT = `http://${container.getHost()}:${container.getMappedPort(8333)}`;
  process.env.SKILL_S3_BUCKET = "skill-tests";
  process.env.SKILL_S3_REGION = "us-east-1";
  process.env.SKILL_S3_FORCE_PATH_STYLE = "true";
  process.env.AWS_ACCESS_KEY_ID = "test-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

  return container;
}
