import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const privatePath = resolve(
  process.cwd(),
  process.argv[2] ?? "./runtime/keys/armorclaw-private.pem"
);
const publicPath = resolve(
  process.cwd(),
  process.argv[3] ?? "./runtime/keys/armorclaw-public.pem"
);

const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem"
  },
  publicKeyEncoding: {
    type: "spki",
    format: "pem"
  }
});

mkdirSync(dirname(privatePath), { recursive: true });
mkdirSync(dirname(publicPath), { recursive: true });

writeFileSync(privatePath, privateKey);
writeFileSync(publicPath, publicKey);

process.stdout.write(
  JSON.stringify(
    {
      private_key_path: privatePath,
      public_key_path: publicPath
    },
    null,
    2
  )
);
