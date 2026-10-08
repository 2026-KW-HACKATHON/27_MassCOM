export default async function html2canvas(): Promise<HTMLCanvasElement> {
  return document.createElement('canvas');
}
