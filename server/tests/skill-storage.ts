import { GenericContainer, Wait } from "testcontainers";

const OBJECT_STORE_PORT = 8333;
const UNAUTHENTICATED_STATUS = 403;
// prettier-ignore
const STORAGE_ACTIONS = [
  "Admin",
  "Read",
  "Write",
  "List",
];

/** Starts isolated S3-compatible storage and sets its connection environment. */
export async function createSkillTestStorage() {
  const storageService = new GenericContainer("chrislusf/seaweedfs:4.48")
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
              actions: STORAGE_ACTIONS,
            },
          ],
        }),
      },
    ]);
  // An unauthenticated response confirms the S3 endpoint is ready.
  const readiness = Wait.forHttp("/", OBJECT_STORE_PORT).forStatusCode(
    UNAUTHENTICATED_STATUS,
  );
  const container = await storageService
    .withExposedPorts(OBJECT_STORE_PORT)
    .withWaitStrategy(readiness)
    .start();

  process.env.S3_ENDPOINT = `http://${container.getHost()}:${container.getMappedPort(OBJECT_STORE_PORT)}`;
  process.env.S3_BUCKET = "skill-tests";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_FORCE_PATH_STYLE = "true";
  process.env.AWS_ACCESS_KEY_ID = "test-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

  return container;
}
