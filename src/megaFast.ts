/**
 * Descifrado de archivos de MEGA con el motor nativo del teléfono (WebCrypto).
 * La librería megajs lo hace en JavaScript y además verifica la integridad: en un celular es lo que más tarda.
 * Los archivos de MEGA usan AES-128-CTR: la clave es la mitad 1 XOR la mitad 2 de la clave del archivo,
 * y el contador empieza con 8 bytes de nonce + 8 bytes de número de bloque.
 */
const PART = 16 * 1024 * 1024; // múltiplo de 16

export const canDecryptNative = (key: unknown): key is Uint8Array =>
  typeof crypto !== "undefined" && !!crypto.subtle && key instanceof Uint8Array && key.length === 32;

export async function decryptMega(
  data: Uint8Array,
  key: Uint8Array,
  onProgress?: (done: number, total: number) => void,
  partSize = PART
): Promise<Uint8Array> {
  const raw = new Uint8Array(16);
  for (let i = 0; i < 16; i++) raw[i] = key[i] ^ key[16 + i];
  const aes = await crypto.subtle.importKey("raw", raw, "AES-CTR", false, ["decrypt"]);
  const counter = new Uint8Array(16);
  counter.set(key.subarray(16, 24), 0);
  const view = new DataView(counter.buffer);
  for (let offset = 0; offset < data.length; offset += partSize) {
    view.setBigUint64(8, BigInt(offset / 16));
    const part = data.subarray(offset, Math.min(data.length, offset + partSize));
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, aes, part as BufferSource);
    data.set(new Uint8Array(plain), offset); // se escribe sobre el mismo arreglo para no duplicar memoria
    onProgress?.(Math.min(data.length, offset + partSize), data.length);
  }
  return data;
}
