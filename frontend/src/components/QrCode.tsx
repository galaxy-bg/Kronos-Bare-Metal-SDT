import { Box } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';

type QrCodeProps = {
  value: string;
  size?: number;
};

export function QrCode({ value, size = 300 }: QrCodeProps) {
  if (!value) return null;

  return (
    <Box
      sx={{
        bgcolor: '#fff',
        border: '1px solid #d9ebe5',
        borderRadius: 1,
        display: 'inline-flex',
        p: 1.5,
      }}
    >
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        includeMargin
        bgColor="#ffffff"
        fgColor="#111820"
        aria-label="Mobile enrollment QR code"
      />
    </Box>
  );
}
