import { test, expect } from "@playwright/test";

test("push config and same-origin subscription lifecycle use the versioned API", async ({ request }) => {
  const config = await request.get("/api/v1/push/config");
  expect(config.ok()).toBeTruthy();
  expect(await config.json()).toEqual(expect.objectContaining({ enabled: expect.any(Boolean) }));

  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/subscription-test", expirationTime: null,
    keys: { p256dh: "abcdefgh", auth: "ijklmnop" } };
  const added = await request.post("/api/v1/push/subscriptions", { data: subscription, headers: { Origin: "http://127.0.0.1:8787" } });
  expect(added.ok()).toBeTruthy();
  expect(await added.json()).toEqual({ subscribed: true });
  const removed = await request.delete("/api/v1/push/subscriptions", { data: { endpoint: subscription.endpoint }, headers: { Origin: "http://127.0.0.1:8787" } });
  expect(removed.ok()).toBeTruthy();
  expect(await removed.json()).toEqual({ subscribed: false });
});
