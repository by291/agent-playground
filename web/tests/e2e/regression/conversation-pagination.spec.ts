import { expect, test, type Page } from "@playwright/test";

function historyPage(start: number, hasMore: boolean) {
  return {
    conversations: Array.from({ length: 30 }, (_, offset) => ({
      threadId: `history-${start + offset}`,
      title: `Discussion ${start + offset}: a long title to check the scrollbar spacing`,
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
    nextCursor: hasMore ? "older-history" : null,
  };
}

function navigation(page: Page) {
  return page.getByRole("complementary", { name: "Conversation navigation" });
}

test("compact history loads only at the bottom with an animated indicator and preserves scroll and focus", async ({
  page,
}, testInfo) => {
  let olderRequests = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(
    (url) => url.pathname === "/conversations",
    async (route) => {
      const older = new URL(route.request().url()).searchParams.has("cursor");

      if (older) {
        olderRequests += 1;
        await gate;
      }

      await route.fulfill({ json: historyPage(older ? 30 : 0, !older) });
    },
  );
  await page.goto("/");
  const sidebar = navigation(page);
  const scroller = sidebar.getByLabel("Conversation history");
  const rows = sidebar.getByRole("button", { name: /^Discussion \d+:/ });
  const message = page.getByRole("textbox", { name: "Message" });

  try {
    await expect(rows).toHaveCount(30);
    expect(olderRequests).toBe(0);
    await expect(
      sidebar.getByRole("button", { name: /Load more/ }),
    ).toHaveCount(0);
    const spacing = await sidebar
      .getByRole("button", { name: /^Actions for Discussion 0:/ })
      .evaluate((button) => {
        const root = button.closest<HTMLElement>(
          ".conversation-history-scroll",
        )!;

        return {
          gap:
            root.getBoundingClientRect().left +
            root.clientWidth -
            button.getBoundingClientRect().right,
          gutter: getComputedStyle(root).scrollbarGutter,
          padding: getComputedStyle(root).paddingInlineEnd,
          margin: getComputedStyle(root).marginInlineEnd,
        };
      });

    expect(spacing.gap).toBe(8);
    expect(spacing.gutter).toBe("auto");
    expect(spacing.padding).toBe("8px");
    expect(spacing.margin).toBe("-8px");
    expect((await rows.first().boundingBox())!.height).toBe(36);
    await message.fill("Keep this draft and focus");
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight - 80;
    });
    await page.waitForTimeout(200);
    expect(olderRequests).toBe(0);
    const scrollTop = await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;

      return element.scrollTop;
    });

    await expect(
      sidebar.getByRole("status", { name: "Loading older conversations" }),
    ).toBeVisible();
    expect(olderRequests).toBe(1);
    await expect(message).toBeFocused();
    const loading = sidebar.getByRole("status", {
      name: "Loading older conversations",
    });
    const loadingBounds = (await loading.boundingBox())!;
    const scrollerBounds = (await scroller.boundingBox())!;

    expect(loadingBounds.y).toBeGreaterThanOrEqual(scrollerBounds.y);
    expect(loadingBounds.y + loadingBounds.height).toBeLessThanOrEqual(
      scrollerBounds.y + scrollerBounds.height,
    );
    await expect(rows.last()).toBeInViewport();
    await expect(loading.locator("svg")).toHaveCSS("animation-name", "spin");
    await page.screenshot({
      path: testInfo.outputPath("history-pagination-loading.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(loading.locator("svg")).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    release();
    await expect(rows).toHaveCount(60);
    expect(olderRequests).toBe(1);
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(
      scrollTop,
      0,
    );
    await expect(message).toBeFocused();
    await expect(message).toHaveValue("Keep this draft and focus");
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(rows.last()).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("history-pagination-desktop.png"),
    });
  } finally {
    release();
  }
});

test("failed pagination retains history and retries only the failed page", async ({
  page,
}) => {
  let initialRequests = 0;
  let olderRequests = 0;
  let failOlder = true;

  await page.route(
    (url) => url.pathname === "/conversations",
    async (route) => {
      const older = new URL(route.request().url()).searchParams.has("cursor");

      if (older) {
        olderRequests += 1;
      } else {
        initialRequests += 1;
      }

      if (older && failOlder) {
        await route.fulfill({
          status: 503,
          json: { error: "History temporarily unavailable" },
        });

        return;
      }

      await route.fulfill({ json: historyPage(older ? 30 : 0, !older) });
    },
  );
  await page.goto("/");
  const sidebar = navigation(page);
  const scroller = sidebar.getByLabel("Conversation history");
  const rows = sidebar.getByRole("button", { name: /^Discussion \d+:/ });

  await expect(rows).toHaveCount(30);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(sidebar.getByRole("alert")).toHaveText(
    "Conversation history is unavailable",
  );
  expect(olderRequests).toBe(2);
  await expect(rows).toHaveCount(30);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  failOlder = false;
  await sidebar.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(rows).toHaveCount(60);
  expect(initialRequests).toBe(1);
  expect(olderRequests).toBe(3);
  await expect(sidebar.getByRole("alert")).toHaveCount(0);
});

test("mobile history loads while scrolling the drawer and a closed drawer does not load pages", async ({
  page,
}, testInfo) => {
  let olderRequests = 0;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    (url) => url.pathname === "/conversations",
    async (route) => {
      const older = new URL(route.request().url()).searchParams.has("cursor");

      if (older) {
        olderRequests += 1;
      }

      await route.fulfill({ json: historyPage(older ? 30 : 0, !older) });
    },
  );
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const sidebar = navigation(page);
  const rows = sidebar.getByRole("button", { name: /^Discussion \d+:/ });
  const scroller = sidebar.getByLabel("Conversation history");

  await expect(rows).toHaveCount(30);
  expect(olderRequests).toBe(0);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(rows).toHaveCount(60);
  expect(olderRequests).toBe(1);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(rows.last()).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("history-pagination-mobile.png"),
  });
});
