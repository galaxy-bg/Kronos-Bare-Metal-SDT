import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import KeyIcon from '@mui/icons-material/Key';
import SensorsIcon from '@mui/icons-material/Sensors';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useParams } from 'react-router-dom';
import { fetchIloEnrollment, submitIloEnrollment } from '../api/client';
import type { IloEnrollmentInfo } from '../types';

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};

function candidateValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function guessPassword(values: string[]) {
  for (const value of values) {
    const normalized = value.replace(/\s+/g, '').toUpperCase();
    if (/^[A-Z0-9]{6,16}$/.test(normalized) && !normalized.startsWith('ILO')) return normalized;

    const passwordMatch = normalized.match(/(?:PASSWORD|PASS|PWD)[:=-]?([A-Z0-9]{6,16})/);
    if (passwordMatch?.[1]) return passwordMatch[1];

    const tokenMatch = normalized.match(/\b(?!ILO)[A-Z0-9]{6,16}\b/);
    if (tokenMatch?.[0]) return tokenMatch[0];
  }
  return '';
}

function pickDnsName(values: string[]) {
  return values.find((value) => value.trim().toUpperCase().startsWith('ILO')) ?? '';
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be loaded.'));
    };
    image.src = url;
  });
}

function enhanceCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function makeCanvas(
  image: HTMLImageElement,
  crop?: { x: number; y: number; width: number; height: number },
  options?: { rotation?: 0 | 90 | 180 | 270; enhance?: boolean },
) {
  const source = crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const rotation = options?.rotation ?? 0;
  const rotated = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  canvas.width = rotated ? height : width;
  canvas.height = rotated ? width : height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  context.save();
  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, width, height);
  context.restore();

  return options?.enhance ? enhanceCanvas(canvas) : canvas;
}

function scanCrops(width: number, height: number): Array<{ x: number; y: number; width: number; height: number } | undefined> {
  return [
    undefined,
    { x: 0, y: 0, width, height: Math.round(height * 0.5) },
    { x: 0, y: Math.round(height * 0.25), width, height: Math.round(height * 0.5) },
    { x: 0, y: Math.round(height * 0.38), width, height: Math.round(height * 0.28) },
    { x: 0, y: Math.round(height * 0.48), width, height: Math.round(height * 0.24) },
    { x: 0, y: Math.round(height * 0.45), width, height: Math.round(height * 0.55) },
    { x: 0, y: Math.round(height * 0.62), width, height: Math.round(height * 0.38) },
    { x: Math.round(width * 0.05), y: Math.round(height * 0.05), width: Math.round(width * 0.9), height: Math.round(height * 0.9) },
  ];
}

async function detectWithNativeBarcodeDetector(file: File) {
  const detectorType = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!detectorType) return [];

  const image = await loadImage(file);
  const detector = new detectorType({
    formats: ['code_128', 'code_39', 'code_93', 'codabar', 'data_matrix', 'itf', 'qr_code'],
  });
  const values: string[] = [];
  const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 270, 180];

  for (const crop of scanCrops(image.naturalWidth, image.naturalHeight)) {
    for (const rotation of rotations) {
      for (const enhance of [false, true]) {
        try {
          const canvas = makeCanvas(image, crop, { rotation, enhance });
          values.push(...(await detector.detect(canvas)).map((barcode) => barcode.rawValue));
          if (guessPassword(values)) return values;
        } catch {
          // Try the next crop/rotation; Android support differs by device and browser build.
        }
      }
    }
  }

  return values;
}

async function detectWithZxing(file: File) {
  const image = await loadImage(file);
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.CODABAR,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ]);

  const reader = new BrowserMultiFormatReader(hints);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const crops = scanCrops(width, height);
  const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 270, 180];
  const values: string[] = [];

  for (const crop of crops) {
    for (const rotation of rotations) {
      for (const enhance of [false, true]) {
        try {
          values.push(reader.decodeFromCanvas(makeCanvas(image, crop, { rotation, enhance })).getText());
          if (guessPassword(values)) return values;
        } catch {
          // Keep trying other variants; tag photos often have glare, rotation, or two separated barcodes.
        }
      }
    }
  }

  return values;
}

export function IloEnrollmentPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<IloEnrollmentInfo | null>(null);
  const [username, setUsername] = useState('Administrator');
  const [password, setPassword] = useState('');
  const [dnsName, setDnsName] = useState('');
  const [createManagedUser, setCreateManagedUser] = useState(true);
  const [detectedValues, setDetectedValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [liveScanning, setLiveScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);

  const title = useMemo(() => info?.hostname ?? info?.serial_number ?? 'iLO Enrollment', [info]);

  useEffect(() => {
    fetchIloEnrollment(token)
      .then((data) => {
        setInfo(data);
        setDnsName(data.hostname ?? '');
      })
      .catch(() => setError('Enrollment link is not valid.'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    return () => {
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, []);

  async function scanImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setError(null);
    setSuccess(null);
    try {
      const nativeValues = await detectWithNativeBarcodeDetector(file);
      const values = candidateValues(guessPassword(nativeValues) ? nativeValues : [...nativeValues, ...(await detectWithZxing(file))]);
      setDetectedValues(values);
      const guessedPassword = guessPassword(values);
      if (guessedPassword) {
        setPassword(guessedPassword);
        setSuccess('Password barcode detected.');
      }
      const guessedDns = pickDnsName(values);
      if (guessedDns && !dnsName) setDnsName(guessedDns);
      if (values.length === 0) setError('No barcode was detected. Try a closer, well-lit photo of the iLO tag.');
    } catch {
      setError('Barcode scan failed.');
    } finally {
      setScanning(false);
      event.target.value = '';
    }
  }

  function applyDetectedValues(values: string[]) {
    const detected = candidateValues(values);
    setDetectedValues((current) => candidateValues([...detected, ...current]).slice(0, 8));

    const guessedPassword = guessPassword(detected);
    if (guessedPassword) {
      setPassword(guessedPassword);
      setSuccess('Password barcode detected.');
      stopLiveScan();
      return true;
    }

    const guessedDns = pickDnsName(detected);
    if (guessedDns) setDnsName((current) => current || guessedDns);
    return false;
  }

  async function startLiveScan() {
    if (!videoRef.current) return;
    if (!window.isSecureContext) {
      setError('Live camera scanning requires HTTPS on mobile browsers. Open this page with https://192.168.88.240:3000 and accept the local certificate.');
      return;
    }
    setError(null);
    setSuccess(null);
    setDetectedValues([]);
    setLiveScanning(true);

    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.CODABAR,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE,
    ]);

    try {
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      scannerControlsRef.current = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoRef.current,
        (result) => {
          if (!result) return;
          applyDetectedValues([result.getText()]);
        },
      );
    } catch {
      setLiveScanning(false);
      setError('Camera scanner could not be started. Check camera permission and try again.');
    }
  }

  function stopLiveScan() {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    setLiveScanning(false);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await submitIloEnrollment(token, {
        username,
        password,
        dns_name: dnsName || null,
        create_managed_user: createManagedUser,
      });
      setSuccess('Credential verification task queued.');
    } catch {
      setError('Credential could not be submitted.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Stack sx={{ py: 8 }} alignItems="center">
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 620, mx: 'auto' }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderColor: 'divider' }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <KeyIcon color="primary" />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" sx={{ fontWeight: 900 }}>
                Scan iLO Tag
              </Typography>
              <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
                {title}
              </Typography>
            </Box>
          </Stack>

          {info && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={info.serial_number} />
              {info.model && <Chip size="small" label={info.model} />}
            </Stack>
          )}

          {error && <Alert severity="warning">{error}</Alert>}
          {success && (
            <Alert icon={<CheckCircleIcon />} severity="success">
              {success}
            </Alert>
          )}

          <Box
            sx={{
              display: liveScanning ? 'block' : 'none',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'common.black',
              aspectRatio: '4 / 3',
            }}
          >
            <Box
              component="video"
              ref={videoRef}
              muted
              playsInline
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <Box
              sx={{
                position: 'absolute',
                left: '8%',
                right: '8%',
                top: '42%',
                height: '16%',
                border: '2px solid',
                borderColor: 'primary.main',
                borderRadius: 1,
                boxShadow: '0 0 0 999px rgba(0,0,0,0.28)',
              }}
            />
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant={liveScanning ? 'contained' : 'outlined'}
              startIcon={liveScanning ? <CloseIcon /> : <SensorsIcon />}
              disabled={saving}
              onClick={liveScanning ? stopLiveScan : startLiveScan}
              fullWidth
            >
              {liveScanning ? 'Stop Live Scan' : 'Live Scan Barcode'}
            </Button>
            <Button component="label" variant="outlined" startIcon={<CameraAltIcon />} disabled={scanning || saving} fullWidth>
              {scanning ? 'Scanning...' : 'Scan Photo'}
              <input hidden accept="image/*" capture="environment" type="file" onChange={scanImage} />
            </Button>
          </Stack>

          {detectedValues.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {detectedValues.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  onClick={() => {
                    if (value.toUpperCase().startsWith('ILO')) setDnsName(value);
                    else setPassword(value.replace(/\s+/g, ''));
                  }}
                />
              ))}
            </Stack>
          )}

          <TextField label="Username" value={username} onChange={(event) => setUsername(event.target.value)} fullWidth />
          <TextField label="DNS / iLO Name" value={dnsName} onChange={(event) => setDnsName(event.target.value)} fullWidth />
          <TextField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            fullWidth
            autoComplete="off"
          />
          <FormControlLabel
            control={<Checkbox checked={createManagedUser} onChange={(event) => setCreateManagedUser(event.target.checked)} />}
            label="Create managed hpadmin account"
          />
          <Button variant="contained" onClick={submit} disabled={saving || !username.trim() || !password.trim()}>
            {saving ? 'Submitting...' : 'Verify & Enroll'}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
