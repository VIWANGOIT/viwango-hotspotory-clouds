import { describe, expect, it } from "vitest";
import { normalizeMpesaPhone, parseCallback } from "@/lib/mpesa";

describe("M-Pesa helpers", () => {
  it("normalizes Tanzanian phone numbers", () => {
    expect(normalizeMpesaPhone("0712 345 678")).toBe("255712345678");
    expect(normalizeMpesaPhone("0755-123-456")).toBe("255755123456");
    expect(normalizeMpesaPhone("+255 712 345 678")).toBe("255712345678");
    expect(normalizeMpesaPhone("255712345678")).toBe("255712345678");
    expect(normalizeMpesaPhone("0712345678")).toBe("255712345678");
  });

  it("rejects numbers that are not Tanzanian mobile numbers", () => {
    expect(normalizeMpesaPhone("12345")).toBeNull();
    expect(normalizeMpesaPhone("254712345678")).toBeNull();
    expect(normalizeMpesaPhone("0812345678")).toBeNull();
  });

  it("parses a successful STK callback", () => {
    const parsed = parseCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: "ws_CO_123",
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 2000 },
              { Name: "MpesaReceiptNumber", Value: "QK12AB34CD" },
              { Name: "PhoneNumber", Value: 255712345678 },
            ],
          },
        },
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.checkoutRequestId).toBe("ws_CO_123");
    expect(parsed.receipt).toBe("QK12AB34CD");
    expect(parsed.amount).toBe(2000);
    expect(parsed.phone).toBe("255712345678");
  });

  it("parses a cancelled payment", () => {
    const parsed = parseCallback({
      Body: { stkCallback: { CheckoutRequestID: "ws_CO_9", ResultCode: 1032, ResultDesc: "Request cancelled by user" } },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.receipt).toBeNull();
    expect(parsed.description).toContain("cancelled");
  });
});
