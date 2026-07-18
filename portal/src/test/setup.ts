import { beforeEach } from "vitest";

// Fresh localStorage per test — unread-dot + mock-pending state live there.
beforeEach(() => {
  localStorage.clear();
});
