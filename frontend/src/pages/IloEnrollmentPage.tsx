import { ChangeEvent, useEffect, useMemo, useState } from 'react';
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
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import KeyIcon from '@mui/icons-material/Key';
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
  return values.find((value) => /^[A-Z0-9]{6,16}$/.test(value.replace(/\s+/g, ''))) ?? '';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  async function scanImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setError(null);
    setSuccess(null);
    try {
      const detectorType = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!detectorType) {
        setError('Barcode scan is not supported on this browser.');
        return;
      }

      const bitmap = await createImageBitmap(file);
      const detector = new detectorType({ formats: ['code_128', 'code_39', 'qr_code'] });
      const values = candidateValues((await detector.detect(bitmap)).map((barcode) => barcode.rawValue));
      setDetectedValues(values);
      const guessedPassword = guessPassword(values);
      if (guessedPassword && !password) setPassword(guessedPassword);
      const guessedDns = values.find((value) => value.toUpperCase().startsWith('ILO'));
      if (guessedDns && !dnsName) setDnsName(guessedDns);
      if (values.length === 0) setError('No barcode was detected.');
    } catch {
      setError('Barcode scan failed.');
    } finally {
      setScanning(false);
      event.target.value = '';
    }
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

          <Button component="label" variant="outlined" startIcon={<CameraAltIcon />} disabled={scanning || saving}>
            {scanning ? 'Scanning...' : 'Scan Barcode'}
            <input hidden accept="image/*" capture="environment" type="file" onChange={scanImage} />
          </Button>

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
