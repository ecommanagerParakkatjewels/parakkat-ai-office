import type { ConnectionOptions } from "node:tls";
export function sslFor(url: string): ConnectionOptions | undefined;
