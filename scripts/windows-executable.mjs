// IMAGE_OPTIONAL_HEADER32 and IMAGE_OPTIONAL_HEADER64 use the same offsets for
// CheckSum and Subsystem. See Microsoft's PE/COFF specification.
function optionalHeaderOffset(binary) {
  if (binary.length < 64 || binary.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("Expected a Windows PE executable (missing MZ header).");
  }
  const peOffset = binary.readUInt32LE(0x3c);
  if (peOffset + 24 > binary.length || binary.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error("Invalid Windows PE signature.");
  }
  const optionalOffset = peOffset + 24;
  const optionalSize = binary.readUInt16LE(peOffset + 20);
  if (optionalSize < 72 || optionalOffset + optionalSize > binary.length ||
      ![0x10b, 0x20b].includes(binary.readUInt16LE(optionalOffset))) {
    throw new Error("Unsupported Windows PE optional header.");
  }
  return optionalOffset;
}

export function getWindowsSubsystem(binary) {
  return binary.readUInt16LE(optionalHeaderOffset(binary) + 68);
}

export function setWindowsSubsystem(binary, subsystem) {
  if (subsystem !== 2 && subsystem !== 3) throw new Error("Expected GUI (2) or console (3) subsystem.");
  const offset = optionalHeaderOffset(binary);
  binary.writeUInt16LE(subsystem, offset + 68);
  // The SEA payload already changes the original image. Clear its old checksum.
  binary.writeUInt32LE(0, offset + 64);
}
