export interface ReadZipEntry {
  name: string;
  content: Buffer;
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MIN_EOCD_LENGTH = 22;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const searchStart = Math.max(0, buffer.length - MIN_EOCD_LENGTH - 0xffff);

  for (let offset = buffer.length - MIN_EOCD_LENGTH; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error('End of central directory record not found in zip buffer.');
}

/**
 * Reads stored (uncompressed) ZIP entries via the central directory, which
 * carries correct sizes even when file-based entries use a streaming data
 * descriptor (zeroed sizes in the local header). Avoids adding a zip-reading
 * dependency just for test assertions.
 */
export function readStoredZipEntries(buffer: Buffer): ReadZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries: ReadZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`Expected central directory entry signature at offset ${offset}.`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString('utf8', nameStart, nameStart + fileNameLength);

    if (compressionMethod !== 0) {
      throw new Error(`Unsupported compression method in test zip reader: ${compressionMethod} (${name})`);
    }

    entries.push({ name, content: readStoredEntryData(buffer, localHeaderOffset, compressedSize) });
    offset = nameStart + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

function readStoredEntryData(buffer: Buffer, localHeaderOffset: number, compressedSize: number): Buffer {
  if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`Expected local file header signature at offset ${localHeaderOffset}.`);
  }

  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;

  return Buffer.from(buffer.subarray(dataStart, dataStart + compressedSize));
}
