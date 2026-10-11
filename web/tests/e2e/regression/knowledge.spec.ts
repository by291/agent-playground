import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  APIRequestContext,
  Locator,
  Page,
  Request,
} from "@playwright/test";
import {
  knowledgeDocumentSchema,
  knowledgeSearchSchema,
} from "../../../../shared/knowledge";
import { capture, expect, test as base } from "../fixtures";
import { createCompletedConversation } from "../conversations";

interface KnowledgeResources {
  request: APIRequestContext;
  documentIds: Set<string>;
}

async function releaseKnowledgeResources({
  request,
  documentIds,
}: KnowledgeResources) {
  try {
    const reset = request
      .post("/__e2e/embedding-failure", { data: { enabled: false } })
      .then((response) => {
        expect(response.ok()).toBe(true);
      });
    const deletions = [...documentIds].map(async (documentId) => {
      const deleted = await request.delete(
        `/api/knowledge/documents/${documentId}`,
      );

      expect([204, 404]).toContain(deleted.status());
    });

    // A failed reset or deletion must not prevent releasing the other documents.
    const cleanup = await Promise.allSettled([reset, ...deletions]);
    const failures: unknown[] = [];

    for (const result of cleanup) {
      if (result.status === "rejected") {
        failures.push(result.reason);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Knowledge resource cleanup failed");
    }
  } finally {
    await request.dispose();
  }
}

const test = base.extend<{ knowledge: KnowledgeResources }>({
  knowledge: [
    async ({ page, playwright }, runTest) => {
      const request = await playwright.request.newContext({
        baseURL: "http://127.0.0.1:4300",
        timeout: 5_000,
      });
      const documentIds = new Set<string>();

      function trackUpload(upload: Request) {
        const isDocumentUpload =
          upload.method() === "POST" &&
          new URL(upload.url()).pathname === "/api/knowledge/documents";

        if (!isDocumentUpload) {
          return;
        }

        const documentId = upload.headers()["x-document-id"];

        if (documentId) {
          documentIds.add(documentId);
        }
      }

      // Capture ownership before acknowledgement so interrupted uploads are cleaned up.
      page.on("request", trackUpload);

      try {
        await runTest({ request, documentIds });
      } finally {
        page.off("request", trackUpload);

        // This transport and teardown budget remain available after the test times out.
        await releaseKnowledgeResources({ request, documentIds });
      }
    },
    { timeout: 20_000 },
  ],
});

// Tests in this file share the controlled embedding-failure switch.
test.describe.configure({ mode: "default" });

const returnPolicyContent = [
  "# Returns",
  "Returns are allowed within 30 days. Keep the original receipt.",
  ...Array.from(
    { length: 24 },
    (_, index) => `Return note ${index + 1}: Keep the receipt.`,
  ),
].join("\n");

async function uploadReadyDocument(
  knowledge: KnowledgeResources,
  name: string,
  content: string,
): Promise<void> {
  const id = randomUUID();

  knowledge.documentIds.add(id);

  const uploaded = await knowledge.request.post("/api/knowledge/documents", {
    headers: { "X-Document-Id": id, "X-Filename": encodeURIComponent(name) },
    data: Buffer.from(content),
  });

  expect(uploaded.status()).toBe(201);
  expect(knowledgeDocumentSchema.parse(await uploaded.json()).id).toBe(id);

  await expect
    .poll(async () => {
      const response = await knowledge.request.get("/api/knowledge/documents");

      expect(response.ok()).toBe(true);

      return knowledgeDocumentSchema
        .array()
        .parse(await response.json())
        .find((entry) => entry.id === id)?.status;
    })
    .toBe("ready");
}

async function selectDocumentAction(page: Page, row: Locator, name: string) {
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("shared documents retry indexing failures and remove deleted knowledge", async ({
  page,
  knowledge,
}, testInfo) => {
  const filename = `policy-${randomUUID()}.md`;
  const content = returnPolicyContent;
  const { request } = knowledge;

  const failure = await request.post("/__e2e/embedding-failure", {
    data: { enabled: true },
  });

  expect(failure.ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("link", { name: "Knowledge", exact: true }).click();
  await page.getByLabel("Document file").setInputFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(content),
  });
  const row = page.getByRole("listitem").filter({ hasText: filename });

  await expect(row).toContainText("Embedding token rate limit reached");
  const recovered = await request.post("/__e2e/embedding-failure", {
    data: { enabled: false },
  });

  expect(recovered.ok()).toBe(true);
  await selectDocumentAction(page, row, "Retry indexing");
  await expect(row).toContainText("ready");
  const unusedCardHeight = await row.evaluate((element) => {
    const list = element.closest("ul")!;
    const card = list.closest('[data-slot="card"]')!;

    return (
      card.getBoundingClientRect().height - list.getBoundingClientRect().height
    );
  });

  expect(unusedCardHeight).toBeLessThanOrEqual(4);
  await capture(page, testInfo, "knowledge-ready.png");
  const documentUrl = await row
    .getByRole("link", { name: "Download", exact: true })
    .getAttribute("href");

  expect(documentUrl).toBeTruthy();

  const deleteTrigger = row.getByRole("button", {
    name: `Actions for ${filename}`,
  });

  await selectDocumentAction(page, row, "Delete");
  await page
    .getByRole("alertdialog", { name: "Delete document?" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(deleteTrigger).toBeFocused();
  await selectDocumentAction(page, row, "Delete");
  await page
    .getByRole("alertdialog", { name: "Delete document?" })
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Upload document", exact: true }),
  ).toBeFocused();
  expect(
    (await request.get(`http://127.0.0.1:4300${documentUrl}`)).status(),
  ).toBe(404);
  const threadId = await createCompletedConversation(
    request,
    "Deleted knowledge",
  );
  const result = await request.post(
    `http://127.0.0.1:4300/__e2e/knowledge-result/${threadId}`,
  );

  expect(await result.json()).toMatchObject({ sources: [] });
});

test("shared knowledge sources restore across conversations and provide an accessible reader", async ({
  page,
  knowledge,
}, testInfo) => {
  const filename = `policy-${randomUUID()}.md`;
  const content = returnPolicyContent;
  const { request } = knowledge;

  await uploadReadyDocument(knowledge, filename, content);

  const threadId = await createCompletedConversation(
    request,
    "Returns question",
  );
  const result = await request.post(
    `http://127.0.0.1:4300/__e2e/knowledge-result/${threadId}`,
  );

  expect(result.ok()).toBe(true);
  await page.goto(`/c/${threadId}`);
  await page.reload();
  const trigger = page.getByRole("button", {
    name: /Sources · 1 document/,
  });
  const sources = page.getByRole("dialog", {
    name: "Sources",
    exact: true,
  });

  await expect(trigger).toBeVisible();
  await expect(sources).toHaveCount(0);
  const citation = page.getByRole("button", {
    name: `Source 1: ${filename}`,
    exact: true,
  });

  await expect(citation).toHaveText("[1]");
  await citation.click();
  await expect(sources).toContainText("Source [1]");
  await expect(sources).toContainText("30 days");
  await page.keyboard.press("Escape");
  await expect(citation).toBeFocused();
  await trigger.click();
  await expect(sources).toContainText("30 days");
  await expect(sources.getByText(filename, { exact: true })).toBeVisible();
  await expect(sources.getByRole("combobox")).toHaveCount(0);
  await expect(sources).toContainText("Passage 1 of 1");
  await expect(
    sources.getByRole("button", { name: "Next passage" }),
  ).toBeDisabled();
  await capture(page, testInfo, "knowledge-sources-desktop.png");

  for (const dark of [false, true]) {
    await page.evaluate(
      (enabled) => document.documentElement.classList.toggle("dark", enabled),
      dark,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await sources.boundingBox();

    expect(box!.x).toBe(0);
    expect(box!.width).toBe(390);
    await expect(
      sources.getByRole("button", { name: "Close sources" }),
    ).toBeVisible();
    const passage = sources.locator("[data-slot=scroll-area-viewport]");

    await expect
      .poll(() =>
        passage.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    await passage.hover();
    await page.mouse.wheel(0, 240);
    await expect
      .poll(() => passage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      sources.getByRole("link", { name: "Download original" }),
    ).toBeVisible();
    await capture(
      page,
      testInfo,
      `knowledge-sources-mobile-${dark ? "dark" : "light"}.png`,
    );
  }

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.setViewportSize({ width: 1280, height: 720 });
  const download = page.waitForEvent("download");

  await sources.getByRole("link", { name: "Download original" }).click();
  const file = await download;

  expect(file.suggestedFilename()).toBe(filename);
  expect(await readFile(await file.path(), "utf8")).toBe(content);
  await page.keyboard.press("Escape");
  await expect(sources).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const sharedThread = await createCompletedConversation(
    request,
    "Another shared knowledge question",
  );
  const sharedResult = await request.post(
    `/__e2e/knowledge-result/${sharedThread}`,
  );

  expect(sharedResult.ok()).toBe(true);
  await page.goto(`/c/${sharedThread}`);
  await page.reload();
  const restoredCitation = page.getByRole("button", {
    name: `Source 1: ${filename}`,
    exact: true,
  });

  await expect(
    page.getByRole("button", { name: /Sources · 1 document/ }),
  ).toBeVisible();
  await expect(sources).toHaveCount(0);
  await expect(restoredCitation).toHaveText("[1]");
  await restoredCitation.click();
  await expect(sources).toContainText("Source [1]");
  await expect(sources).toContainText("30 days");
  await page.keyboard.press("Escape");
  await expect(restoredCitation).toBeFocused();
});

test("multiple knowledge documents preserve menu focus and restored citation identity", async ({
  page,
  knowledge,
}, testInfo) => {
  const filename = `policy-${randomUUID()}.md`;
  const courierFilename = `courier-return-policy-${randomUUID()}.md`;
  const { request } = knowledge;

  await uploadReadyDocument(knowledge, filename, returnPolicyContent);
  await uploadReadyDocument(
    knowledge,
    courierFilename,
    "# Returns\nFor courier returns, contact the delivery desk.",
  );

  const combinedThread = await createCompletedConversation(
    request,
    "Compare return policies",
  );
  const combined = await request.post(
    `http://127.0.0.1:4300/__e2e/knowledge-result/${combinedThread}`,
  );

  expect(combined.ok()).toBe(true);
  const retrieved = knowledgeSearchSchema.parse(await combined.json());
  const courierNumber =
    retrieved.sources.findIndex((source) => source.name === courierFilename) +
    1;

  expect(courierNumber).toBeGreaterThan(0);
  await page.goto(`/c/${combinedThread}`);
  await page.getByRole("button", { name: /Sources · 2 documents/ }).click();
  const reader = page.getByRole("dialog", { name: "Sources", exact: true });
  const selector = reader.getByRole("combobox", { name: "Document" });

  await selector.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await capture(page, testInfo, "knowledge-document-menu-desktop.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(reader).toBeVisible();
  await expect(selector).toBeFocused();
  await selector.click();
  await page
    .getByRole("option", { name: courierFilename, exact: true })
    .click();
  await expect(selector).toContainText(courierFilename);
  await expect(reader).toContainText("contact the delivery desk");
  await expect(reader).toContainText("Passage 1 of 1");

  for (const dark of [false, true]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      (enabled) => document.documentElement.classList.toggle("dark", enabled),
      dark,
    );
    await selector.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    const menu = await page.getByRole("listbox").boundingBox();

    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
    await capture(
      page,
      testInfo,
      `knowledge-document-menu-mobile-${dark ? "dark" : "light"}.png`,
    );
    await page.keyboard.press("Escape");
    await expect(reader).toBeVisible();
  }

  await selector.click();
  await page.getByRole("option", { name: filename, exact: true }).click();
  await expect(reader).toContainText("30 days");
  await reader.getByRole("button", { name: "Close sources" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  const citation = page.getByRole("button", {
    name: `Source ${courierNumber}: ${courierFilename}`,
    exact: true,
  });

  await expect(citation).toBeVisible();
  await capture(page, testInfo, "knowledge-answer-footnotes.png");
  await citation.click();
  await expect(reader).toContainText(`Source [${courierNumber}]`);
  await expect(reader).toContainText("contact the delivery desk");
  await capture(page, testInfo, "knowledge-inline-citation.png");
  await reader.getByRole("button", { name: "Close sources" }).click();
});

test("an encoding choice recovers ambiguous text, persists after reload and preserves original bytes", async ({
  page,
  knowledge,
}, testInfo) => {
  test.setTimeout(60_000);
  const filename = `legacy-${randomUUID()}.txt`;
  // GBK bytes for "Return 你好", independent of the application's detector.
  const original = Buffer.from([
    0x52, 0x65, 0x74, 0x75, 0x72, 0x6e, 0x20, 0xc4, 0xe3, 0xba, 0xc3,
  ]);
  const { request } = knowledge;

  await page.goto("/knowledge");
  await page.getByLabel("Document file").setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: original,
  });
  const row = page.getByRole("listitem").filter({ hasText: filename });

  await expect(row).toContainText("Choose Text encoding");
  const fileUrl = await row
    .getByRole("link", { name: "Download", exact: true })
    .getAttribute("href");

  expect(fileUrl).toBeTruthy();
  const documentId = fileUrl!.split("/").at(-2)!;

  await row.getByRole("button", { name: `Actions for ${filename}` }).click();
  await capture(page, testInfo, "knowledge-actions-menu.png");
  await page.getByRole("menuitem", { name: "Text encoding" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Text encoding",
    exact: true,
  });

  await dialog.getByRole("combobox", { name: "Text encoding" }).click();
  await page.getByRole("option", { name: "GBK", exact: true }).click();
  await capture(page, testInfo, "knowledge-encoding.png");
  await dialog.getByRole("button", { name: "Reindex document" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("status")).toHaveText("ready");
  await capture(page, testInfo, "knowledge-actions.png");
  const search = await request.post("http://127.0.0.1:4301/search", {
    data: { query: "return policy" },
  });
  const result = knowledgeSearchSchema.parse(await search.json());

  expect(
    result.sources.find((source) => source.documentId === documentId)?.excerpt,
  ).toBe("Return 你好");
  const downloaded = await request.get(`http://127.0.0.1:4300${fileUrl}`);

  expect(await downloaded.body()).toEqual(original);
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, testInfo, "knowledge-actions-mobile.png");
  const actions = row.getByRole("button", {
    name: `Actions for ${filename}`,
  });

  await actions.focus();
  await actions.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Reindex" })).toBeFocused();
  await capture(page, testInfo, "knowledge-actions-menu-mobile.png");
  await page.getByRole("menuitem", { name: "Text encoding" }).click();
  await expect(dialog.getByRole("combobox")).toHaveText("GBK");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
  await capture(page, testInfo, "knowledge-encoding-mobile.png");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(actions).toBeFocused();
  const acceptedReindex = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/knowledge/documents/${documentId}/reindex`,
  );

  await selectDocumentAction(page, row, "Reindex");
  expect((await acceptedReindex).ok()).toBe(true);

  // The row already displayed ready before this request. Check completion of
  // the accepted reindex in persistence before consulting its cached UI state.
  await expect
    .poll(async () => {
      const documents = await request.get(
        "http://127.0.0.1:4300/api/knowledge/documents",
      );

      return knowledgeDocumentSchema
        .array()
        .parse(await documents.json())
        .find((document) => document.id === documentId);
    })
    .toMatchObject({ textEncoding: "gbk", status: "ready" });
  await expect(row.getByRole("status")).toHaveText("ready");
});
