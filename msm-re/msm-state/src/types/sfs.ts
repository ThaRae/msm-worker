/**
 * Value model for the game's SmartFoxServer-style binary object format.
 *
 * Mirrors sfs::SFSBaseData from MSM_native.exe. Type tags are the byte the
 * client writes before each value (see sfs::SFSWriter::writeValue at
 * 0xE72C20 in the IDA database).
 */

/** Type tags observed in the client's serializer (sfs_SFSWriter_writeValue).
 *  Tags 2 and 3 follow the client's reader (sfs_SFSReader_readValue):
 *  2 = char/byte (1 byte), 3 = short (2 bytes big-endian). */
export const enum SfsTag {
  Bool = 1,
  Byte = 2,
  Short = 3,
  Int = 4,
  Long = 5,
  Float = 6,
  Double = 7,
  UtfString = 8,
  BoolArray = 9,
  ByteArray = 10,
  ShortArray = 11,
  IntArray = 12,
  LongArray = 13,
  FloatArray = 14,
  DoubleArray = 15,
  StringArray = 16,
  SfsArray = 17,
  SfsObject = 18,
}

/** A nested SFS object; entries serialize in sorted-key order (std::map). */
export type SfsObject = { readonly kind: 'object'; entries: Map<string, SfsValue> };

/** A nested SFS array (tag 17: heterogeneous, each item carries its own tag). */
export type SfsArray = { readonly kind: 'array'; items: SfsValue[] };

/**
 * Force short (tag 3) encoding for a small number, mirroring the client's
 * SFSData<short> which writes a u16 big-endian (writer case 3 at 0xE72C20).
 */
export type SfsShort = { readonly kind: 'short'; value: number };

export const newShort = (value: number): SfsShort => ({ kind: 'short', value });

/**
 * Force double (tag 7) encoding, mirroring SFSData<double>: whole values
 * like a scale of 1.0 must not collapse to the int tag the plain-number
 * encoder picks.
 */
export type SfsDouble = { readonly kind: 'double'; value: number };

export const newDouble = (value: number): SfsDouble => ({ kind: 'double', value });

/**
 * Force float (tag 6) encoding, mirroring SFSData<float> (volume fields).
 */
export type SfsFloat = { readonly kind: 'float'; value: number };

export const newFloat = (value: number): SfsFloat => ({ kind: 'float', value });

/**
 * Fixed-type int array (tag 12, "INTARRAY"), mirroring
 * SFSData<std::vector<int>>: u32 count followed by i32 values.
 */
export type SfsIntArray = { readonly kind: 'int-array'; values: number[] };

export const newIntArray = (values: number[]): SfsIntArray => ({ kind: 'int-array', values });

/**
 * A decoded or encodable SFS value. Fixed-type arrays (tags 9-16) surface
 * as plain JS arrays; heterogeneous arrays (tag 17) as SfsArray.
 */
export type SfsValue =
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | boolean[]
  | number[]
  | bigint[]
  | string[]
  | SfsValue[]
  | SfsShort
  | SfsDouble
  | SfsFloat
  | SfsIntArray
  | SfsArray
  | SfsObject
  | null;