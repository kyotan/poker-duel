import { useEffect, useState } from "react";
import QRCode from "qrcode";

const DEFAULT_QR_SIZE = 256;

function normalizeQrSize(size: number): number {
  return Number.isFinite(size) ? Math.max(96, Math.round(size)) : DEFAULT_QR_SIZE;
}

export type QrInviteProps = {
  inviteUrl: string;
  ariaLabel: string;
  loadingLabel: string;
  errorLabel: string;
  className?: string;
  size?: number;
};

type QrState =
  | { status: "loading"; dataUrl: null }
  | { status: "ready"; dataUrl: string }
  | { status: "error"; dataUrl: null };

export async function createQrDataUrl(inviteUrl: string, size = DEFAULT_QR_SIZE): Promise<string> {
  const value = inviteUrl.trim();
  if (!value) {
    throw new Error("An invite URL is required to generate a QR code.");
  }

  return QRCode.toDataURL(value, {
    type: "image/png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: normalizeQrSize(size),
    color: {
      dark: "#111936ff",
      light: "#ffffffff",
    },
  });
}

export function QrInvite({
  inviteUrl,
  ariaLabel,
  loadingLabel,
  errorLabel,
  className,
  size = DEFAULT_QR_SIZE,
}: QrInviteProps) {
  const qrSize = normalizeQrSize(size);
  const [qr, setQr] = useState<QrState>({ status: "loading", dataUrl: null });

  useEffect(() => {
    let cancelled = false;
    setQr({ status: "loading", dataUrl: null });

    void createQrDataUrl(inviteUrl, qrSize).then(
      (dataUrl) => {
        if (!cancelled) setQr({ status: "ready", dataUrl });
      },
      () => {
        if (!cancelled) setQr({ status: "error", dataUrl: null });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [inviteUrl, qrSize]);

  return (
    <div className={className} data-testid="invite-qr">
      {qr.status === "ready" ? (
        <img
          src={qr.dataUrl}
          alt={ariaLabel}
          aria-label={ariaLabel}
          data-testid="invite-qr-image"
          width={qrSize}
          height={qrSize}
          draggable={false}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <span
          role="status"
          data-testid={qr.status === "loading" ? "invite-qr-loading" : "invite-qr-error"}
        >
          {qr.status === "loading" ? loadingLabel : errorLabel}
        </span>
      )}
    </div>
  );
}
