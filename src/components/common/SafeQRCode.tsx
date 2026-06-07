import ReactQRCode from "react-qr-code";
import type { ReactElement } from "react";

type QRCodeComponentLike = (props: { value: string; size?: number }) => ReactElement;

const QRCodeComponent =
  ((ReactQRCode as unknown as { default?: QRCodeComponentLike }).default ??
    (ReactQRCode as unknown as QRCodeComponentLike));

interface SafeQRCodeProps {
  value: string;
  size?: number;
}

export function SafeQRCode({ value, size }: SafeQRCodeProps) {
  return <QRCodeComponent value={value} size={size} />;
}
