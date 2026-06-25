export interface GeneratedPlayerCode {
  eventCode4: string;
  playerId4: string;
  randomCode6: string;
  checksumAdjustCode4: string;
  userCode2: string;
  shiftCode2: string;
  baseCode: string;
  shiftedBaseCode: string;
  playerNameCode: string;
  playerCode: string;
}

export interface GeneratedAdminCode {
  eventCode4: string;
  adminSequence: number;
  adminId4: string;
  randomCode6: string;
  checksumAdjustCode4: string;
  userCode2: string;
  shiftCode2: string;
  baseCode: string;
  shiftedBaseCode: string;
  adminCode: string;
}

const FULL_WIDTH_DIGIT_OFFSET = "0".charCodeAt(0) - "０".charCodeAt(0);

function padNumber(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function normalizeAsciiDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + FULL_WIDTH_DIGIT_OFFSET)
  );
}

function findCodeCandidate(text: string): string {
  const normalized = normalizeAsciiDigits(text).trim();
  if (!normalized) return "";
  if (/^\d+$/.test(normalized)) return normalized;

  const joinedDigits = normalized.replace(/\D/g, "");
  if (joinedDigits.length >= 18) return joinedDigits;

  const digitRuns = normalized.match(/\d{18,}/g);
  if (digitRuns && digitRuns.length > 0) {
    return digitRuns.sort((a, b) => b.length - a.length)[0];
  }

  return "";
}

function hasExpectedEventPrefix(code: string, eventCode4?: string): boolean {
  if (!eventCode4) return true;
  return code.startsWith(normalizeEventCode(eventCode4));
}

export function extractUserCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const candidateKeys = ["playerCode", "adminCode", "userCode", "code", "qrPayload", "value"];
      for (const key of candidateKeys) {
        if (typeof record[key] === "string") {
          const candidate = findCodeCandidate(record[key]);
          if (candidate) return candidate;
        }
      }
    }
  } catch {
    // fall back to raw text handling
  }

  return findCodeCandidate(trimmed);
}

export function isValidPlayerCode(value: string, eventCode4?: string): boolean {
  const code = extractUserCode(value);
  if (!/^\d+$/.test(code)) return false;
  if (code.length !== 32) return false;
  return hasExpectedEventPrefix(code, eventCode4);
}

export function isValidAdminCode(value: string, eventCode4?: string): boolean {
  const code = extractUserCode(value);
  if (!/^\d{22}$/.test(code)) return false;
  return hasExpectedEventPrefix(code, eventCode4);
}

function randomDigits(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

function rotateRight(text: string, amount: number): string {
  if (!text) return text;
  const shift = amount % text.length;
  if (shift === 0) return text;
  return text.slice(-shift) + text.slice(0, text.length - shift);
}

// Prefix checksum used to derive the 4-digit adjustment code.
function prefixChecksum4(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    const digit = text.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) {
      throw new Error("コード計算対象に数字以外が含まれています");
    }
    sum += (i + 1) * digit;
  }
  return sum % 10000;
}

function findAdjustmentCode(basePrefix: string, targetPlayerId4: string): string {
  if (!/^\d+$/.test(basePrefix)) {
    throw new Error("コード計算対象に数字以外が含まれています");
  }
  if (!/^\d{4}$/.test(targetPlayerId4)) {
    throw new Error("ID4桁の形式が不正です");
  }
  const target = Number(targetPlayerId4);
  const prefix = prefixChecksum4(basePrefix);
  const adjustment = (target - prefix + 10000) % 10000;
  return padNumber(adjustment, 4);
}

export function normalizeEventCode(value: string): string {
  const digitsOnly = (value ?? "").replace(/\D/g, "");
  return digitsOnly.padStart(4, "0").slice(-4);
}

export function normalizeTournamentCode(value: string): string {
  const digitsOnly = (value ?? "").replace(/\D/g, "");
  return digitsOnly.padStart(4, "0").slice(-4);
}

function buildPlayerNameCode(playerName: string): string {
  const trimmed = playerName.trim();
  const length = trimmed.length;
  let namePart: string;
  
  if (length <= 4) {
    // If 4 characters or less, use the entire name
    namePart = trimmed.padEnd(4, "0").slice(0, 4);
  } else {
    // If more than 4 characters, use first 4 + last 4
    namePart = trimmed.slice(0, 4) + trimmed.slice(-4);
  }
  
  // Encode name part to digits: convert each character to its UTF-16 code point and take mod 10
  let encoded = "";
  for (let i = 0; i < namePart.length; i++) {
    const code = namePart.charCodeAt(i) % 10;
    encoded += code.toString();
  }
  
  // Prepend the length (2 digits)
  const lengthCode = padNumber(length, 2);
  return lengthCode + encoded;
}

export function buildPlayerCode(
  eventCode4: string,
  tournamentCode4: string,
  playerSequence: number,
  playerName: string
): GeneratedPlayerCode {
  const normalizedEventCode = normalizeEventCode(eventCode4);
  const normalizedTournamentCode = normalizeTournamentCode(tournamentCode4);
  const playerId4 = padNumber(playerSequence, 4).slice(-4);
  const randomCode6 = randomDigits(6);
  const basePrefix = normalizedTournamentCode + randomCode6;
  const checksumAdjustCode4 = findAdjustmentCode(basePrefix, playerId4);
  const baseCode = basePrefix + checksumAdjustCode4;

  // Right-circular shift by the random-code length (6 digits).
  const shiftedBaseCode = rotateRight(baseCode, randomCode6.length);
  const userCode2 = randomDigits(2);
  const shiftCode2 = randomDigits(2);
  const playerNameCode = buildPlayerNameCode(playerName);
  const playerCode = normalizedEventCode + userCode2 + shiftCode2 + shiftedBaseCode + playerNameCode;

  return {
    eventCode4: normalizedEventCode,
    playerId4,
    randomCode6,
    checksumAdjustCode4,
    userCode2,
    shiftCode2,
    baseCode,
    shiftedBaseCode,
    playerNameCode,
    playerCode,
  };
}

export function buildAdminCode(
  eventCode4: string,
  tournamentCode4: string,
  maxParticipants: number,
  adminSequence: number
): GeneratedAdminCode {
  const normalizedEventCode = normalizeEventCode(eventCode4);
  const normalizedTournamentCode = normalizeTournamentCode(tournamentCode4);
  const adminNumericId = maxParticipants + adminSequence;
  const adminId4 = padNumber(adminNumericId, 4).slice(-4);
  const randomCode6 = randomDigits(6);
  const basePrefix = normalizedTournamentCode + randomCode6;
  const checksumAdjustCode4 = findAdjustmentCode(basePrefix, adminId4);
  const baseCode = basePrefix + checksumAdjustCode4;
  const shiftedBaseCode = rotateRight(baseCode, randomCode6.length);
  const userCode2 = randomDigits(2);
  const shiftCode2 = randomDigits(2);
  const adminCode = normalizedEventCode + userCode2 + shiftCode2 + shiftedBaseCode;

  return {
    eventCode4: normalizedEventCode,
    adminSequence,
    adminId4,
    randomCode6,
    checksumAdjustCode4,
    userCode2,
    shiftCode2,
    baseCode,
    shiftedBaseCode,
    adminCode,
  };
}



