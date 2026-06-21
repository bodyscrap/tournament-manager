import QRCode from "qrcode";

export type ExportCardItem = {
  entityType: "participant" | "admin";
  id: string;
  name: string;
  userCode: string;
  eventCode: string;
  tournamentCode: string;
  tournamentName: string;
  qrPayload: string;
};

const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;
const SHEET_PADDING_RATIO = 0.05;
const SHEET_COLS = 2;
const SHEET_ROWS = 5;

function sanitizeFileName(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, "_");
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitName(name: string, maxLen = 24): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, Math.max(1, maxLen - 1))}…`;
}

async function toQrImage(payload: string, size: number): Promise<HTMLImageElement> {
  const url = await QRCode.toDataURL(payload, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("2次元バーコード画像の読み込みに失敗しました"));
    img.src = url;
  });
}

async function drawCard(
  ctx: CanvasRenderingContext2D,
  item: ExportCardItem,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const corner = Math.round(Math.min(w, h) * 0.04);

  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, corner);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = item.entityType === "admin" ? "#c2410c" : "#334155";
  ctx.stroke();
  ctx.restore();

  const pad = Math.round(w * 0.06);
  const leftX = x + pad;
  const topY = y + pad;

  if (item.entityType === "admin") {
    const badgeW = Math.round(w * 0.22);
    const badgeH = Math.round(h * 0.12);
    ctx.save();
    drawRoundedRect(ctx, x + w - badgeW - pad, topY, badgeW, badgeH, Math.round(badgeH * 0.25));
    ctx.fillStyle = "#b91c1c";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(badgeH * 0.42)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ADMIN", x + w - badgeW / 2 - pad, topY + badgeH / 2);
    ctx.restore();
  }

  ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(h * 0.11)}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fitName(item.name), leftX, topY);

  const labelY = topY + Math.round(h * 0.18);
  ctx.fillStyle = "#475569";
  ctx.font = `${Math.round(h * 0.06)}px sans-serif`;
  ctx.fillText("ユーザーコード", leftX, labelY);

  ctx.fillStyle = "#111827";
  ctx.font = `bold ${Math.round(h * 0.075)}px monospace`;
  ctx.fillText(item.userCode || "(未発行)", leftX, labelY + Math.round(h * 0.07));

  const tournamentInfoY = labelY + Math.round(h * 0.145);
  ctx.fillStyle = "#64748b";
  ctx.font = `${Math.round(h * 0.052)}px sans-serif`;
  ctx.fillText(`大会コード: ${item.tournamentCode}`, leftX, tournamentInfoY);
  ctx.fillText(`大会名: ${fitName(item.tournamentName, 20)}`, leftX, tournamentInfoY + Math.round(h * 0.055));

  const qrSize = Math.round(Math.min(w, h) * 0.5);
  const qrX = x + w - pad - qrSize;
  const qrY = y + h - pad - qrSize;
  const qrImage = await toQrImage(item.qrPayload, qrSize);
  ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(qrX, qrY, qrSize, qrSize);
}

export async function exportSingleCardImage(item: ExportCardItem) {
  const sheetAreaW = A4_WIDTH * (1 - SHEET_PADDING_RATIO * 2);
  const sheetAreaH = A4_HEIGHT * (1 - SHEET_PADDING_RATIO * 2);
  const cardW = Math.floor(sheetAreaW / SHEET_COLS);
  const cardH = Math.floor(sheetAreaH / SHEET_ROWS);

  const canvas = document.createElement("canvas");
  canvas.width = cardW;
  canvas.height = cardH;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像生成に必要なCanvasコンテキストが取得できません");

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, cardW, cardH);

  await drawCard(ctx, item, 0, 0, cardW, cardH);

  const filename = `${sanitizeFileName(item.eventCode)}_${sanitizeFileName(item.tournamentCode)}_${sanitizeFileName(item.tournamentName)}_${sanitizeFileName(item.name)}.png`;
  downloadDataUrl(canvas.toDataURL("image/png"), filename);
}

export async function exportA4SheetImages(items: ExportCardItem[], _tournamentName?: string) {
  if (items.length === 0) return;

  const head = items[0];

  const pageCapacity = SHEET_COLS * SHEET_ROWS;
  const totalPages = Math.ceil(items.length / pageCapacity);

  const outerPadX = Math.floor(A4_WIDTH * SHEET_PADDING_RATIO);
  const outerPadY = Math.floor(A4_HEIGHT * SHEET_PADDING_RATIO);
  const areaW = A4_WIDTH - outerPadX * 2;
  const areaH = A4_HEIGHT - outerPadY * 2;
  const cardW = Math.floor(areaW / SHEET_COLS);
  const cardH = Math.floor(areaH / SHEET_ROWS);

  for (let page = 0; page < totalPages; page += 1) {
    const start = page * pageCapacity;
    const pageItems = items.slice(start, start + pageCapacity);

    const canvas = document.createElement("canvas");
    canvas.width = A4_WIDTH;
    canvas.height = A4_HEIGHT;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像生成に必要なCanvasコンテキストが取得できません");

    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

    for (let i = 0; i < pageItems.length; i += 1) {
      const row = Math.floor(i / SHEET_COLS);
      const col = i % SHEET_COLS;
      const x = outerPadX + col * cardW;
      const y = outerPadY + row * cardH;
      // eslint-disable-next-line no-await-in-loop
      await drawCard(ctx, pageItems[i], x, y, cardW, cardH);
    }

    const filename = `${sanitizeFileName(head.eventCode)}_${sanitizeFileName(head.tournamentCode)}_${sanitizeFileName(head.tournamentName)}_sheet_${page + 1}_of_${totalPages}.png`;
    downloadDataUrl(canvas.toDataURL("image/png"), filename);
  }
}
