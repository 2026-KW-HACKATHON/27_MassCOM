import { createRequire } from 'node:module';

const qrCode = createRequire(import.meta.url)('qrcode') as {
  toString(value: string, options: { type: 'svg'; margin: number }): Promise<string>;
};

export async function renderClaimQr(token: string, render = qrCode.toString): Promise<
  { qrSvgDataUrl: string } | { qrRenderFailed: true }
> {
  try {
    const svg = await render(token, { type: 'svg', margin: 2 });
    return { qrSvgDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
  } catch { return { qrRenderFailed: true }; }
}
