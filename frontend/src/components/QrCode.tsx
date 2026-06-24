import { Box } from '@mui/material';

type QrCodeProps = {
  value: string;
  size?: number;
};

const VERSION = 10;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 274;
const EC_CODEWORDS_PER_BLOCK = 18;
const ALIGNMENT_POSITIONS = [6, 28, 50];

type Cell = {
  dark: boolean;
  reserved: boolean;
};

function gfMul(a: number, b: number) {
  let result = 0;
  for (let i = 0; i < 8; i += 1) {
    if ((b & 1) !== 0) result ^= a;
    const carry = (a & 0x80) !== 0;
    a = (a << 1) & 0xff;
    if (carry) a ^= 0x1d;
    b >>>= 1;
  }
  return result;
}

function gfPow(value: number, power: number) {
  let result = 1;
  for (let i = 0; i < power; i += 1) result = gfMul(result, value);
  return result;
}

function reedSolomonGenerator(degree: number) {
  let result = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(result.length + 1).fill(0);
    const root = gfPow(2, i);
    result.forEach((coefficient, index) => {
      next[index] ^= gfMul(coefficient, root);
      next[index + 1] ^= coefficient;
    });
    result = next;
  }
  return result.slice(1);
}

function reedSolomonRemainder(data: number[], degree: number) {
  const generator = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);
  data.forEach((value) => {
    const factor = value ^ result.shift();
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] ^= gfMul(coefficient, factor);
    });
  });
  return result;
}

function appendBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function makeDataCodewords(value: string) {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > 271) throw new Error('QR value is too long');

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 16);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let pad = 0xec; codewords.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

function interleaveCodewords(data: number[]) {
  const blocks = [
    data.slice(0, 68),
    data.slice(68, 136),
    data.slice(136, 205),
    data.slice(205, 274),
  ];
  const ecBlocks = blocks.map((block) => reedSolomonRemainder(block, EC_CODEWORDS_PER_BLOCK));
  const result: number[] = [];

  for (let i = 0; i < 69; i += 1) {
    blocks.forEach((block) => {
      if (i < block.length) result.push(block[i]);
    });
  }
  for (let i = 0; i < EC_CODEWORDS_PER_BLOCK; i += 1) {
    ecBlocks.forEach((block) => result.push(block[i]));
  }
  return result;
}

function emptyMatrix() {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({ dark: false, reserved: false } as Cell)));
}

function setCell(matrix: Cell[][], x: number, y: number, dark: boolean, reserved = true) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  matrix[y][x] = { dark, reserved };
}

function drawFinder(matrix: Cell[][], x: number, y: number) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark = inFinder && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setCell(matrix, xx, yy, dark);
    }
  }
}

function drawAlignment(matrix: Cell[][], x: number, y: number) {
  if (matrix[y][x].reserved) return;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
      setCell(matrix, x + dx, y + dy, dark);
    }
  }
}

function bchRemainder(value: number, polynomial: number, degree: number) {
  let result = value << degree;
  for (let i = Math.floor(Math.log2(result)); i >= degree; i -= 1) {
    if (((result >>> i) & 1) !== 0) result ^= polynomial << (i - degree);
  }
  return result;
}

function drawFormat(matrix: Cell[][], mask: number) {
  const format = (((0b01 << 3) | mask) << 10 | bchRemainder((0b01 << 3) | mask, 0x537, 10)) ^ 0x5412;
  const positionsA = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ];
  const positionsB = [
    [SIZE - 1, 8], [SIZE - 2, 8], [SIZE - 3, 8], [SIZE - 4, 8], [SIZE - 5, 8], [SIZE - 6, 8], [SIZE - 7, 8],
    [8, SIZE - 8], [8, SIZE - 7], [8, SIZE - 6], [8, SIZE - 5], [8, SIZE - 4], [8, SIZE - 3], [8, SIZE - 2], [8, SIZE - 1],
  ];

  positionsA.forEach(([x, y], index) => setCell(matrix, x, y, ((format >>> index) & 1) !== 0));
  positionsB.forEach(([x, y], index) => setCell(matrix, x, y, ((format >>> index) & 1) !== 0));
  setCell(matrix, 8, SIZE - 8, true);
}

function drawVersion(matrix: Cell[][]) {
  const versionInfo = (VERSION << 12) | bchRemainder(VERSION, 0x1f25, 12);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((versionInfo >>> i) & 1) !== 0;
    const a = SIZE - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setCell(matrix, a, b, dark);
    setCell(matrix, b, a, dark);
  }
}

function drawPatterns(matrix: Cell[][]) {
  drawFinder(matrix, 0, 0);
  drawFinder(matrix, SIZE - 7, 0);
  drawFinder(matrix, 0, SIZE - 7);

  for (let i = 8; i < SIZE - 8; i += 1) {
    setCell(matrix, i, 6, i % 2 === 0);
    setCell(matrix, 6, i, i % 2 === 0);
  }
  ALIGNMENT_POSITIONS.forEach((x) => ALIGNMENT_POSITIONS.forEach((y) => drawAlignment(matrix, x, y)));
  drawVersion(matrix);
  drawFormat(matrix, 0);
}

function shouldMask(x: number, y: number) {
  return (x + y) % 2 === 0;
}

function drawData(matrix: Cell[][], codewords: number[]) {
  const bits = codewords.flatMap((codeword) => Array.from({ length: 8 }, (_, index) => (codeword >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;

  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (matrix[y][x].reserved) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
        matrix[y][x] = { dark: (bit === 1) !== shouldMask(x, y), reserved: false };
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function makeQrPath(value: string) {
  const matrix = emptyMatrix();
  drawPatterns(matrix);
  drawData(matrix, interleaveCodewords(makeDataCodewords(value)));

  const squares: string[] = [];
  matrix.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell.dark) squares.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return squares.join('');
}

export function QrCode({ value, size = 260 }: QrCodeProps) {
  if (!value) return null;

  try {
    return (
      <Box
        component="svg"
        viewBox={`0 0 ${SIZE + 8} ${SIZE + 8}`}
        width={size}
        height={size}
        role="img"
        aria-label="Mobile enrollment QR code"
        sx={{ display: 'block', bgcolor: '#fff', borderRadius: 1, border: '1px solid #d9ebe5' }}
      >
        <path fill="#fff" d={`M0 0h${SIZE + 8}v${SIZE + 8}H0z`} />
        <path fill="#111820" transform="translate(4 4)" d={makeQrPath(value)} />
      </Box>
    );
  } catch {
    return null;
  }
}
