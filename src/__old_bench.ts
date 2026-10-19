import { unzip } from "fflate";
const audio = /\.(wav|mp3|ogg|m4a|aac|flac|aiff|aif)$/i;
export function oldZip(bytes: Uint8Array): Promise<File[]> {
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter: (e) => audio.test(e.name) && !e.name.includes("__MACOSX") }, (err, contents) => {
      if (err || !contents) { reject(err); return; }
      const files: File[] = [];
      for (const [p, data] of Object.entries(contents)) {
        const name = p.split("/").pop();
        if (name) files.push(new File([data as BlobPart], name, { type: "audio/wav" }));
      }
      resolve(files);
    });
  });
}
