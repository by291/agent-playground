import { capture, expect, test } from "../fixtures";
import type { ConversationSnapshot } from "../../../src/features/conversation/api/contracts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

async function galleryImages(page: import("@playwright/test").Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");

    canvas.width = 3600;
    canvas.height = 2400;
    const context = canvas.getContext("2d")!;

    return ["#265ed6", "#13816f"].map((color, index) => {
      canvas.width = index === 0 ? 2400 : 3600;
      canvas.height = index === 0 ? 3600 : 2400;
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#f4f6fa";
      context.fillRect(180, 180, canvas.width - 360, canvas.height - 360);
      context.fillStyle = color;
      context.font = "140px sans-serif";
      context.fillText(index === 0 ? "City map" : "Landscape", 320, 500);

      for (let y = 800; y < canvas.height - 300; y += 320) {
        context.fillRect(320, y, canvas.width - 640, 40);
      }

      return canvas.toDataURL("image/png").split(",")[1]!;
    });
  });

  await page.getByLabel("Choose files").setInputFiles(
    data.map((base64, index) => ({
      name: index === 0 ? "city-map.png" : "landscape.png",
      mimeType: "image/png",
      buffer: Buffer.from(base64, "base64"),
    })),
  );
}

async function touchGesture(
  page: import("@playwright/test").Page,
  frames: { x: number; y: number; id: number }[][],
) {
  const client = await page.context().newCDPSession(page);

  try {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: frames[0]!,
    });

    for (const points of frames.slice(1)) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points,
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }

    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach();
  }
}

async function pointerTimestamps(
  image: import("@playwright/test").Locator,
  timestamps: number[],
) {
  // Use native input events while controlling only the elapsed gesture timing.
  await image.evaluate((element, times) => {
    let index = 0;
    const timedPointer = (event: Event) => {
      Object.defineProperty(event, "timeStamp", { value: times[index] });
      index += 1;

      if (index === times.length) {
        element.removeEventListener("pointerdown", timedPointer, true);
      }
    };

    element.addEventListener("pointerdown", timedPointer, true);
  }, timestamps);
}

test.describe("touch image gallery", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("pinch and vertical pan stay in the image while swipes at fit scale change pages", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await galleryImages(page);
    await page.getByRole("button", { name: "Preview city-map.png" }).click();
    const dialog = page.getByRole("dialog");
    const image = dialog
      .locator(".yarl__slide_current")
      .getByRole("img", { name: "city-map.png" });

    await expect(image).toHaveJSProperty("naturalWidth", 2400);
    await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const fitted = (await image.boundingBox())!;

    // Two fingers start a pinch, then one finger pans within double-tap timing.
    await pointerTimestamps(image, [100, 120, 140, 160, 180]);
    await touchGesture(
      page,
      Array.from({ length: 5 }, (_, step) => [
        { x: 175 - step * 24, y: 400, id: 0 },
        { x: 215 + step * 24, y: 400, id: 1 },
      ]),
    );
    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBeGreaterThan(fitted.width * 2);
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    const magnified = (await image.boundingBox())!;
    const magnifiedZoom = await dialog
      .getByRole("button", { name: "Fit image to screen" })
      .textContent();

    await touchGesture(
      page,
      Array.from({ length: 9 }, (_, step) => [
        { x: 195, y: 400 + step * 8, id: 0 },
      ]),
    );
    await expect(
      dialog.getByRole("button", { name: "Fit image to screen" }),
    ).toHaveText(magnifiedZoom!);
    await expect
      .poll(async () => (await image.boundingBox())!.y)
      .toBeGreaterThan(magnified.y + 40);
    const firstPan = (await image.boundingBox())!;

    await touchGesture(
      page,
      Array.from({ length: 3 }, (_, step) => [
        { x: 195, y: 420 + step * 12, id: 0 },
      ]),
    );
    await expect(
      dialog.getByRole("button", { name: "Fit image to screen" }),
    ).toHaveText(magnifiedZoom!);
    await expect
      .poll(async () => (await image.boundingBox())!.y)
      .toBeGreaterThan(firstPan.y + 14);
    await expect(dialog.getByText("1 of 2")).toBeVisible();
    await dialog.getByRole("button", { name: "Fit image to screen" }).click();
    await touchGesture(
      page,
      Array.from({ length: 13 }, (_, step) => [
        { x: 300 - step * 18, y: 420, id: 0 },
      ]),
    );
    await expect(dialog.getByText("2 of 2")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Fit image to screen" }),
    ).toHaveText("Fit");
    const nextImage = dialog
      .locator(".yarl__slide_current")
      .getByRole("img", { name: "landscape.png" });

    await expect(nextImage).toHaveJSProperty("naturalWidth", 3600);
    // Settle the swipe so both native taps hit the current image's zoom wrapper.
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    const nextFitted = (await nextImage.boundingBox())!;

    await page.touchscreen.tap(195, 400);
    await page.touchscreen.tap(195, 400);
    await expect
      .poll(async () => (await nextImage.boundingBox())!.width)
      .toBeGreaterThan(nextFitted.width * 1.5);
    await dialog.getByRole("button", { name: "Fit image to screen" }).click();
    await expect
      .poll(async () => (await nextImage.boundingBox())!.width)
      .toBeCloseTo(nextFitted.width, 0);
    await capture(page, testInfo, "web-image-gallery-mobile.png");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});

test("desktop image gallery supports zoom, drag, keyboard navigation and focus restoration", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await galleryImages(page);
  await page.getByRole("textbox", { name: "Message" }).fill("Keep my draft");
  const trigger = page.getByRole("button", { name: "Preview landscape.png" });

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "landscape.png" });
  const image = dialog
    .locator(".yarl__slide_current")
    .getByRole("img", { name: "landscape.png" });

  await expect(dialog.getByText("2 of 2")).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 3600);
  await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  expect(await dialog.boundingBox()).toMatchObject({
    x: 0,
    y: 0,
    width: 1280,
    height: 800,
  });
  const fitted = (await image.boundingBox())!;

  // A first double-click within 500 ms of page creation must zoom once.
  await pointerTimestamps(image, [100, 120]);
  await image.click();
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeCloseTo(fitted.width, 0);
  await image.click();
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(fitted.width * 1.5);

  await image.dblclick();
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeCloseTo(fitted.width, 0);
  await image.dblclick();
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(fitted.width * 1.5);
  const magnified = (await image.boundingBox())!;

  await page.mouse.move(640, 420);
  await page.mouse.down();
  await page.mouse.move(760, 470, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await image.boundingBox())!.x)
    .toBeGreaterThan(magnified.x + 80);
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByText("2 of 2")).toBeVisible();
  await dialog.getByRole("button", { name: "Fit image to screen" }).click();
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeCloseTo(fitted.width, 0);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog").getByText("1 of 2")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Previous image" }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Next image" })
    .click();
  await expect(page.getByRole("dialog").getByText("2 of 2")).toBeVisible();
  await capture(page, testInfo, "web-image-gallery.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep my draft",
  );
  await expect(
    page.getByRole("button", { name: "Preview city-map.png" }),
  ).toBeVisible();
});

test("image wheel zoom stays inside the viewer and resets when reopening", async ({
  page,
}) => {
  await page.goto("/");
  await galleryImages(page);
  const trigger = page.getByRole("button", { name: "Preview city-map.png" });

  await trigger.click();
  const dialog = page.getByRole("dialog");
  const image = dialog
    .locator(".yarl__slide_current")
    .getByRole("img", { name: "city-map.png" });

  await expect(image).toHaveJSProperty("naturalWidth", 2400);
  const fitted = (await image.boundingBox())!;

  await image.hover();
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(fitted.width * 1.1);
  expect(
    await dialog.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect(
    dialog.getByRole("button", { name: "Fit image to screen" }),
  ).toHaveText("Fit");
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeCloseTo(fitted.width, 0);
});

test.describe("small-image zoom", () => {
  test.use({ deviceScaleFactor: 2 });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 3840, height: 2160 },
  ]) {
    test(`images smaller than the ${viewport.width}px viewport remain zoomable`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const screenshot = await page.evaluate(() => {
        const canvas = document.createElement("canvas");

        canvas.width = 480;
        canvas.height = 448;
        const context = canvas.getContext("2d")!;

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#222222";
        context.font = "20px sans-serif";
        context.fillText("Small screenshots must remain zoomable", 20, 50);

        return canvas.toDataURL("image/png").split(",")[1]!;
      });

      await page.getByLabel("Choose files").setInputFiles({
        name: "small-screenshot.png",
        mimeType: "image/png",
        buffer: Buffer.from(screenshot, "base64"),
      });
      await page
        .getByRole("button", { name: "Preview small-screenshot.png" })
        .click();
      const dialog = page.getByRole("dialog");
      const image = dialog.getByRole("img", { name: "small-screenshot.png" });
      const fit = dialog.getByRole("button", { name: "Fit image to screen" });
      const zoomIn = dialog.getByRole("button", { name: "Zoom in" });

      await expect(image).toHaveJSProperty("naturalWidth", 480);
      await expect(zoomIn).toBeEnabled();
      const fitted = (await image.boundingBox())!;

      await zoomIn.click();
      await expect
        .poll(async () => (await image.boundingBox())!.width)
        .toBeGreaterThan(fitted.width * 1.5);
      await fit.click();
      await expect
        .poll(async () => (await image.boundingBox())!.width)
        .toBeCloseTo(fitted.width, 0);

      await image.hover();
      await page.mouse.wheel(0, -180);
      await expect
        .poll(async () => (await image.boundingBox())!.width)
        .toBeGreaterThan(fitted.width * 1.1);
      await fit.click();
      await expect
        .poll(async () => (await image.boundingBox())!.width)
        .toBeCloseTo(fitted.width, 0);

      await image.dblclick();
      await expect
        .poll(async () => (await image.boundingBox())!.width)
        .toBeGreaterThan(fitted.width * 1.5);
      await image.dblclick();
      await expect
        .poll(async () => (await image.boundingBox())!.width)
        .toBeCloseTo(fitted.width, 0);
    });
  }
});

test.describe("wheel zoom motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("a mouse wheel notch passes through intermediate sizes instead of jumping", async ({
    page,
  }) => {
    await page.goto("/");
    await galleryImages(page);
    await page.getByRole("button", { name: "Preview city-map.png" }).click();
    const dialog = page.getByRole("dialog");
    const image = dialog
      .locator(".yarl__slide_current")
      .getByRole("img", { name: "city-map.png" });

    await expect(image).toHaveJSProperty("naturalWidth", 2400);
    await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    const fitted = (await image.boundingBox())!;

    await image.evaluate((element) => {
      element.closest('[role="dialog"]')!.addEventListener(
        "wheel",
        () => {
          const sizes: number[] = [];
          const sample = () => {
            sizes.push(element.getBoundingClientRect().width);
            element.setAttribute("data-wheel-sizes", JSON.stringify(sizes));

            if (sizes.length < 30) {
              requestAnimationFrame(sample);
            }
          };

          requestAnimationFrame(sample);
        },
        { once: true, capture: true },
      );
    });
    await image.hover();
    await page.mouse.wheel(0, -120);
    await expect
      .poll(async () => {
        const data = await image.getAttribute("data-wheel-sizes");
        const sizes = JSON.parse(data ?? "[]") as number[];

        return sizes.length;
      })
      .toBe(30);
    const sizes = JSON.parse(
      (await image.getAttribute("data-wheel-sizes"))!,
    ) as number[];
    const finalWidth = sizes.at(-1)!;
    const intermediate = sizes.filter(
      (width) => width > fitted.width + 1 && width < finalWidth - 1,
    );

    expect(finalWidth).toBeGreaterThan(fitted.width * 1.1);
    expect(finalWidth).toBeLessThan(fitted.width * 1.5);
    expect(
      new Set(intermediate.map((width) => Math.round(width))).size,
    ).toBeGreaterThan(5);

    for (let index = 1; index < sizes.length; index++) {
      expect(sizes[index]!).toBeGreaterThanOrEqual(sizes[index - 1]! - 0.5);
      expect(sizes[index]! - sizes[index - 1]!).toBeLessThan(
        fitted.width * 0.12,
      );
    }
  });

  test("reversing wheel direction responds immediately and direct controls cancel pending zoom", async ({
    page,
  }) => {
    await page.goto("/");
    await galleryImages(page);
    await page.getByRole("button", { name: "Preview city-map.png" }).click();
    const dialog = page.getByRole("dialog");
    const image = dialog
      .locator(".yarl__slide_current")
      .getByRole("img", { name: "city-map.png" });

    await expect(image).toHaveJSProperty("naturalWidth", 2400);
    await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    const fitted = (await image.boundingBox())!;

    await image.hover();
    await page.mouse.wheel(0, -120);
    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBeGreaterThan(fitted.width * 1.1);
    await image.evaluate((element) => {
      const recordReversal = (event: WheelEvent) => {
        if (event.deltaY > 0) {
          // Capture before the viewer handles reversal, even on a slow runner.
          element.setAttribute(
            "data-width-at-wheel-reversal",
            String(element.getBoundingClientRect().width),
          );
          element.ownerDocument.removeEventListener(
            "wheel",
            recordReversal,
            true,
          );
        }
      };

      element.ownerDocument.addEventListener("wheel", recordReversal, true);
    });

    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, 120);
    await expect(image).toHaveAttribute("data-width-at-wheel-reversal", /\d/);
    const beforeReverse = Number(
      await image.getAttribute("data-width-at-wheel-reversal"),
    );

    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBeLessThan(beforeReverse);

    await page.mouse.wheel(0, -120);
    await dialog.getByRole("button", { name: "Fit image to screen" }).click();
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    expect((await image.boundingBox())!.width).toBeCloseTo(fitted.width, 0);

    await image.hover();
    await page.mouse.wheel(0, -120);
    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBeGreaterThan(fitted.width * 1.02);
    // Assistive activation can emit click without pointer or keyboard events.
    await dialog
      .getByRole("button", { name: "Fit image to screen" })
      .evaluate((element) => (element as HTMLButtonElement).click());
    const settled = await image.evaluate(async (element) => {
      for (let frame = 0; frame < 20; frame++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }

      return element.getBoundingClientRect().width;
    });

    expect(settled).toBeCloseTo(fitted.width, 0);
    await image.hover();
    await page.mouse.wheel(0, -120);
    await dialog.getByRole("button", { name: "Next image" }).click();
    await expect(dialog.getByText("2 of 2")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Fit image to screen" }),
    ).toHaveText("Fit");
    const nextImage = dialog
      .locator(".yarl__slide_current")
      .getByRole("img", { name: "landscape.png" });

    await expect(nextImage).toHaveJSProperty("naturalWidth", 3600);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Preview city-map.png" }).click();
    await expect(
      dialog.getByRole("button", { name: "Fit image to screen" }),
    ).toHaveText("Fit");
  });
});

test.describe("image viewer motion", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`preview remains centered throughout entrance and exit at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.getByLabel("Choose files").setInputFiles({
        name: "motion.png",
        mimeType: "image/png",
        buffer: png,
      });
      const trigger = page.getByRole("button", { name: "Preview motion.png" });
      const centers = await trigger.evaluate(async (element) => {
        (element as HTMLElement).focus();
        (element as HTMLElement).click();

        for (let frame = 0; frame < 60; frame++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          const dialog = document.querySelector<HTMLElement>(
            '[data-slot="dialog-content"]',
          );
          const animation = dialog?.getAnimations()[0];

          if (!dialog || !animation?.effect) {
            continue;
          }

          animation.pause();
          const duration = Number(animation.effect.getTiming().duration);
          const samples = [0, duration / 2, duration - 0.1].map((time) => {
            animation.currentTime = time;
            const bounds = dialog.getBoundingClientRect();

            return {
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height / 2,
            };
          });

          animation.finish();

          return samples;
        }

        throw new Error("Image preview entrance animation did not start");
      });

      for (const center of centers) {
        expect(center.x).toBeCloseTo(viewport.width / 2, 0);
        expect(center.y).toBeCloseTo(viewport.height / 2, 0);
      }

      const exitCenters = await page
        .getByRole("button", { name: "Close dialog" })
        .evaluate(async (element) => {
          const dialog = element.closest<HTMLElement>(
            '[data-slot="dialog-content"]',
          );

          if (!dialog) {
            throw new Error("Image preview is missing");
          }

          (element as HTMLElement).click();

          for (let frame = 0; frame < 60; frame++) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            const animation = dialog.getAnimations()[0];

            if (dialog.dataset.state !== "closed" || !animation?.effect) {
              continue;
            }

            animation.pause();
            const duration = Number(animation.effect.getTiming().duration);
            const samples = [0, duration / 2, duration - 0.1].map((time) => {
              animation.currentTime = time;
              const bounds = dialog.getBoundingClientRect();

              return {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
              };
            });

            animation.finish();

            return samples;
          }

          throw new Error("Image preview exit animation did not start");
        });

      for (const center of exitCenters) {
        expect(center.x).toBeCloseTo(viewport.width / 2, 0);
        expect(center.y).toBeCloseTo(viewport.height / 2, 0);
      }

      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.getByText("motion.png", { exact: true })).toBeVisible();
    });
  }
});

test("image pixels reach the model through S3 and remain available after reload and follow-up", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Choose files").setInputFiles({
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "Preview screenshot.png" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("img", { name: "screenshot.png" }),
  ).toHaveJSProperty("naturalWidth", 1);
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Describe this image.");
  const submission = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("The uploaded PNG pixel data reached the model.", {
      exact: true,
    }),
  ).toBeVisible();
  const input = (await submission).postDataJSON() as {
    threadId: string;
    messages: { content: string }[];
  };

  expect(input.messages.at(-1)?.content).toContain(
    '"screenshot.png" — File ID:',
  );
  expect(JSON.stringify(input)).not.toContain("base64");
  const messages = page.getByRole("region", { name: "Messages" });

  await expect(messages.getByText(/Uploaded files:|File ID:/)).toHaveCount(0);
  await expect(
    messages.getByRole("img", { name: "screenshot.png" }),
  ).toHaveJSProperty("naturalWidth", 1);
  await messages
    .getByRole("button", { name: "Preview screenshot.png" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("img", { name: "screenshot.png" }),
  ).toHaveJSProperty("naturalWidth", 1);
  await page.keyboard.press("Escape");
  const saved = await request.get(
    `http://127.0.0.1:4300/conversations/${input.threadId}`,
  );

  expect(JSON.stringify(await saved.json())).not.toContain(
    png.toString("base64"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Describe this image.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The uploaded PNG pixel data reached the model.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await expect(
    messages.getByRole("img", { name: "screenshot.png" }),
  ).toHaveJSProperty("naturalWidth", 1);
  await capture(page, testInfo, "image-attachments.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await messages
    .getByRole("button", { name: "Preview screenshot.png" })
    .click();
  const dialog = page.getByRole("dialog");
  const bounds = await dialog.boundingBox();

  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds?.width).toBeLessThanOrEqual(390);
  await capture(page, testInfo, "image-preview-mobile.png");
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Is the previous image still available?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("The previous image is still in model history.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("invalid image submission retains the prompt and attachment without starting a run", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const composer = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Message" }),
  });

  await page.getByLabel("Choose files").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a PNG"),
  });
  await page.getByRole("textbox", { name: "Message" }).fill("Read this image.");
  const rejection = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/agent",
  );

  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const response = await rejection;

  expect(response.status()).toBe(400);
  // Recovery also reports admission failures; verify the retained composer draft.
  await expect(composer.getByRole("alert")).toContainText(
    "Attach a valid JPEG, PNG, GIF or WebP image",
  );
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Read this image.",
  );
  await expect(composer.getByText("broken.png", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  const input = response.request().postDataJSON() as { threadId: string };
  const stored = await request.get(
    `http://127.0.0.1:4300/__e2e/stored-conversation/${input.threadId}`,
  );

  expect(stored.ok()).toBe(true);
  const snapshot = (await stored.json()) as ConversationSnapshot | null;

  expect(snapshot?.runs ?? []).toHaveLength(0);
});
