import { describe, expect, it } from "vitest";
import { createQrDataUrl } from "./QrInvite";

describe("createQrDataUrl", () => {
  it("creates a PNG data URL for a LAN invite", async () => {
    const result = await createQrDataUrl("http://192.168.11.3:5173/?room=ABC123", 160);

    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(result.split(",")[1], "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  it("creates different QR images for different room links", async () => {
    const first = await createQrDataUrl("http://192.168.11.3:5173/?room=ABC123");
    const second = await createQrDataUrl("http://192.168.11.3:5173/?room=XYZ789");

    expect(first).not.toBe(second);
  });

  it("rejects an empty invite URL", async () => {
    await expect(createQrDataUrl("   ")).rejects.toThrow("invite URL");
  });
});
