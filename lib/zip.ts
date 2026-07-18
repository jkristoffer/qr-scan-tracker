interface ZipEntry {
  name: string;
  data: Blob;
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function crc32(data: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function header(size: number) {
  return new Uint8Array(size);
}

function writeUint16(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer).setUint16(offset, value, true);
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer).setUint32(offset, value, true);
}

/** Creates a standards-compliant, uncompressed ZIP without adding a client dependency. */
export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const files = await Promise.all(entries.map(async entry => {
    const name = encoder.encode(entry.name);
    const data = new Uint8Array(await entry.data.arrayBuffer());
    return { name, data, crc: crc32(data) };
  }));
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const local = header(30 + file.name.length);
    writeUint32(local, 0, 0x04034b50); writeUint16(local, 4, 20); writeUint16(local, 6, 0x0800);
    writeUint32(local, 14, file.crc); writeUint32(local, 18, file.data.length); writeUint32(local, 22, file.data.length);
    writeUint16(local, 26, file.name.length); local.set(file.name, 30);
    parts.push(local, file.data);
    const central = header(46 + file.name.length);
    writeUint32(central, 0, 0x02014b50); writeUint16(central, 4, 20); writeUint16(central, 6, 20); writeUint16(central, 8, 0x0800);
    writeUint32(central, 16, file.crc); writeUint32(central, 20, file.data.length); writeUint32(central, 24, file.data.length);
    writeUint16(central, 28, file.name.length); writeUint32(central, 42, offset); central.set(file.name, 46);
    directory.push(central); offset += local.length + file.data.length;
  }
  const directorySize = directory.reduce((total, entry) => total + entry.length, 0);
  const end = header(22); writeUint32(end, 0, 0x06054b50); writeUint16(end, 8, files.length); writeUint16(end, 10, files.length); writeUint32(end, 12, directorySize); writeUint32(end, 16, offset);
  const blobParts = [...parts, ...directory, end].map(bytes =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return new Blob(blobParts, { type: 'application/zip' });
}
